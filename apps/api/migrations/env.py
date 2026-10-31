import asyncio

from alembic import context
from app.models import Base
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine


def run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def main() -> None:
    engine = create_async_engine(context.config.get_main_option("sqlalchemy.url") or "")
    async with engine.connect() as connection:
        await connection.run_sync(run)
        await connection.commit()
    await engine.dispose()


asyncio.run(main())
