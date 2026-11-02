import asyncio

import typer
from sqlalchemy import text
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


def main() -> None:
    cli()
