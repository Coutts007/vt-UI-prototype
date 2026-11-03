import asyncio
import uuid

import typer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings
from app.db.session import make_engine, make_sessions
from app.migrate import upgrade
from app.seed import SeedRefused, load_demo

cli = typer.Typer(no_args_is_help=True)
db = typer.Typer(no_args_is_help=True)
seed = typer.Typer(no_args_is_help=True)
jobs = typer.Typer(no_args_is_help=True)
study = typer.Typer(no_args_is_help=True)
cli.add_typer(db, name="db")
cli.add_typer(study, name="study")
cli.add_typer(seed, name="seed")
users = typer.Typer(no_args_is_help=True)
cli.add_typer(users, name="users")
cli.add_typer(jobs, name="jobs")


@db.command("upgrade")
def db_upgrade() -> None:
    """Applies migrations as the database owner, then sets the application role's password."""
    settings = Settings()
    if not settings.migration_database_url:
        raise typer.BadParameter("MIGRATION_DATABASE_URL is required")
    upgrade(settings.migration_database_url)

    async def set_password() -> None:
        engine = create_async_engine(settings.migration_database_url or "")
        async with engine.begin() as connection:
            quoted = settings.vt_app_db_password.replace("'", "''")
            await connection.execute(text(f"ALTER ROLE vt_app PASSWORD '{quoted}'"))
            quoted = settings.vt_retention_db_password.replace("'", "''")
            await connection.execute(text(f"ALTER ROLE vt_retention PASSWORD '{quoted}'"))
        await engine.dispose()

    asyncio.run(set_password())
    typer.echo("Database is up to date")


@seed.command("demo")
def seed_demo() -> None:
    """Loads the synthetic demo data. Refused in production."""
    settings = Settings()

    async def run() -> bool:
        engine = make_engine(settings.database_url)
        try:
            async with make_sessions(engine)() as session:
                return await load_demo(session, settings)
        finally:
            await engine.dispose()

    try:
        loaded = asyncio.run(run())
    except SeedRefused as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error
    typer.echo("Demo data loaded" if loaded else "Demo data is already there")


@seed.command("volume")
def seed_volume(
    clients: int = typer.Option(5000, "--clients"),
    filled: int = typer.Option(2000, "--filled"),
    per_client: int = typer.Option(10, "--per-client", min=1, max=50),
) -> None:
    """Synthetic volume for the load test: one tailor, many clients and profiles. Not production."""
    from app.volume import load_volume

    settings = Settings()

    async def run() -> bool:
        engine = make_engine(settings.database_url)
        try:
            async with make_sessions(engine)() as session:
                loaded = await load_volume(session, settings, clients, filled, per_client)
                await session.commit()
                return loaded
        finally:
            await engine.dispose()

    try:
        loaded = asyncio.run(run())
    except SeedRefused as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error
    typer.echo("Volume loaded" if loaded else "Volume is already there")


async def create_admin(settings: Settings, email: str, password: str) -> str:
    """The first administrator of a fresh database, such as the study laptop (M12)."""
    from app.models import UserAccount
    from app.security.passwords import hash_password
    from app.services import audit

    if not 10 <= len(password) <= 256:
        return "refused: the password needs 10 to 256 characters"
    engine = make_engine(settings.database_url)
    try:
        async with make_sessions(engine)() as session:
            if await session.scalar(select(UserAccount).where(UserAccount.role == "admin")):
                return "refused: an administrator already exists; add others from the admin screens"
            user_id = uuid.uuid4()
            session.add(
                UserAccount(
                    user_id=user_id,
                    email=email.strip().lower(),
                    password_hash=hash_password(password),
                    role="admin",
                    status="active",
                    locale="en",
                    unit_pref="cm",
                )
            )
            await session.flush()
            audit.record(
                session,
                actor_type="system",
                action="account_create",
                entity_type="user_account",
                entity_id=user_id,
                detail={"role": "admin", "via": "cli"},
            )
            await session.commit()
            return "administrator created"
    finally:
        await engine.dispose()


@users.command("create-admin")
def users_create_admin(
    email: str = typer.Option(..., "--email"),
    password: str = typer.Option(
        ...,
        "--password",
        prompt=True,
        hide_input=True,
        confirmation_prompt=True,
        envvar="VT_ADMIN_PASSWORD",
    ),
) -> None:
    """Creates the first administrator. Refused once one exists."""
    outcome = asyncio.run(create_admin(Settings(), email, password))
    typer.echo(outcome, err=outcome.startswith("refused"))
    if outcome.startswith("refused"):
        raise typer.Exit(1)


@jobs.command("clean-sheets")
def jobs_clean_sheets() -> None:
    """Deletes sheet files older than 30 days and files no sheet names. Prints counts only."""
    from pathlib import Path

    from app.services.sheet_cleanup import clean_sheets

    settings = Settings()

    async def run() -> str:
        engine = make_engine(settings.database_url)
        try:
            async with make_sessions(engine)() as session:
                report = await clean_sheets(session, Path(settings.sheets_dir))
        finally:
            await engine.dispose()
        return f"expired files removed: {report.expired_files}, orphans: {report.orphan_files}"

    typer.echo(asyncio.run(run()))


@jobs.command("retention")
def jobs_retention(dry_run: bool = typer.Option(False, "--dry-run")) -> None:
    """Applies the retention periods (backend-spec 14.6) as vt_retention. Prints counts only."""
    typer.echo(asyncio.run(_retention(Settings(), dry_run)))


async def _retention(settings: Settings, dry_run: bool) -> str:
    from pathlib import Path

    from app.services.retention import run_retention

    engine = make_engine(settings.retention_database_url)
    try:
        async with make_sessions(engine)() as session:
            report = await run_retention(
                session,
                sheets_dir=Path(settings.sheets_dir),
                reports_dir=Path(settings.reports_dir),
                dry_run=dry_run,
            )
    finally:
        await engine.dispose()
    return ", ".join(f"{key}: {value}" for key, value in report.counts().items())


@jobs.command("nightly")
def jobs_nightly() -> None:
    """Runs the retention job every night at 02:00 Africa/Nairobi, until stopped."""
    import time
    from datetime import UTC, datetime

    from app.services.schedule import seconds_until_next

    settings = Settings()
    while True:
        time.sleep(seconds_until_next(datetime.now(UTC)))
        try:
            typer.echo(asyncio.run(_retention(settings, dry_run=False)))
        except Exception as error:  # noqa: BLE001 - one failed night must not stop the next
            # The type only: a message could carry personal data.
            typer.echo(f"retention failed: {type(error).__name__}", err=True)


@study.command("allocate")
def study_allocate(seed: int = typer.Option(..., "--seed", min=0, max=2**31 - 1)) -> None:
    """Sets the cohort allocation seed once, before the first enrolment, and logs it."""
    settings = Settings()

    async def run() -> str:
        from sqlalchemy import func, select

        from app.models import AuditLog, Participant
        from app.services.settings import read_settings, write_setting

        engine = make_engine(settings.database_url)
        try:
            async with make_sessions(engine)() as session:
                values = await read_settings(session)
                if isinstance(values.get("allocation_seed"), int):
                    return "refused: the seed is already set"
                enrolled = await session.scalar(select(func.count()).select_from(Participant))
                await write_setting(session, "allocation_seed", seed, None)
                session.add(
                    AuditLog(
                        actor_type="system",
                        action="settings_change",
                        entity_type="app_setting",
                        entity_id="allocation_seed",
                        detail={"allocation_seed": seed, "enrolled_before": enrolled or 0},
                    )
                )
                await session.commit()
                return f"allocation seed set: {seed}"
        finally:
            await engine.dispose()

    message = asyncio.run(run())
    typer.echo(message, err=message.startswith("refused"))
    if message.startswith("refused"):
        raise typer.Exit(1)


@study.command("export-calibration")
def study_export_calibration(
    out: str = typer.Option(..., "--out", help="Where to write the calibration bundle (JSON)"),
) -> None:
    """Writes the calibration cohort's numbers and tape readings for vt-ml calibrate (11.1, 11.3).

    Calibration participants only, by participant code: no names, contacts or client codes.
    Pilot and test rows never leave the database through this command.
    """
    import json
    import os
    from pathlib import Path

    from app.services.calibration_export import calibration_bundle

    path = Path(out)
    if "frozen" in path.resolve().parts:
        raise typer.BadParameter("A bundle never goes into a frozen folder.")
    settings = Settings()

    async def run() -> dict[str, int]:
        engine = make_engine(settings.database_url)
        try:
            async with make_sessions(engine)() as session:
                bundle = await calibration_bundle(session)
        finally:
            await engine.dispose()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Owner-readable only: the bundle is person-level study data on the study laptop.
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
            handle.write(json.dumps(bundle, ensure_ascii=False) + "\n")
        people = bundle["participants"]
        return {
            "participants": len(people),
            "capture_sets": sum(len(p["sets"]) for p in people),
            "readings": sum(len(p["readings"]) for p in people),
        }

    counts = asyncio.run(run())
    typer.echo(", ".join(f"{key}: {value}" for key, value in counts.items()))


def main() -> None:
    cli()
