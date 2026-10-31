"""Tests run on real PostgreSQL (backend-spec 17.1) and connect as the application role."""

from collections.abc import AsyncIterator, Iterator

import pytest
from app.config import Settings
from app.db.session import make_sessions
from app.main import create_app
from app.migrate import upgrade
from app.models import Base
from app.seed import load_demo
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from support import owner_execute
from testcontainers.postgres import PostgresContainer

APP_PASSWORD = "vt-app-test"


@pytest.fixture(scope="session")
def owner_url() -> Iterator[str]:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def app_url(owner_url: str) -> str:
    import asyncio

    upgrade(owner_url)
    asyncio.run(owner_execute(owner_url, f"ALTER ROLE vt_app PASSWORD '{APP_PASSWORD}'"))
    host = owner_url.split("@", 1)[1]
    return f"postgresql+asyncpg://vt_app:{APP_PASSWORD}@{host}"


@pytest.fixture
def settings(app_url: str) -> Settings:
    return Settings(env="staging", database_url=app_url, _env_file=None)  # type: ignore[call-arg]


@pytest.fixture
async def app(settings: Settings, owner_url: str) -> AsyncIterator[FastAPI]:
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    await owner_execute(owner_url, f"TRUNCATE {tables} CASCADE")
    application = create_app(settings)
    async with make_sessions(application.state.engine)() as session:
        await load_demo(session, settings)
    yield application
    await application.state.engine.dispose()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest.fixture
async def session(app: FastAPI) -> AsyncIterator[AsyncSession]:
    async with app.state.sessions() as db:
        yield db
