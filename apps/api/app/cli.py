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
cli.add_typer(db, name="db")
cli.add_typer(seed, name="seed")


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


def main() -> None:
    cli()
