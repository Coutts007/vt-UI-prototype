"""M16: rate-limit windows shared by every worker, and the sheet re-check (review of M12)."""

import asyncio
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from app.config import Settings
from app.errors import ApiError
from app.main import create_app
from app.models import Client, RateLimitWindow, SpecSheet
from app.services import sheets
from app.services.ratelimit import purge_ended
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from test_sheets import ORDER, make_sheet, tailor

API = "/api/v1"


async def test_limits_are_shared_between_api_workers(app: FastAPI, settings: Settings) -> None:
    # Two app instances on one database stand for two Uvicorn workers (M12-13).
    first = app.state.limiter
    await first.hit("m16", "same-key", 2, 60)
    await first.hit("m16", "same-key", 2, 60)
    second = create_app(settings)
    try:
        with pytest.raises(ApiError) as refused:
            await second.state.limiter.hit("m16", "same-key", 2, 60)
    finally:
        await second.state.engine.dispose()
    assert refused.value.code == "rate_limited"
    assert 1 <= int(refused.value.headers["Retry-After"]) <= 60


async def test_an_ended_window_starts_again(app: FastAPI, session: AsyncSession) -> None:
    limiter = app.state.limiter
    for _ in range(3):
        await limiter.hit("m16", "ends", 3, 60)
    with pytest.raises(ApiError):
        await limiter.hit("m16", "ends", 3, 60)
    await session.execute(
        update(RateLimitWindow)
        .where(RateLimitWindow.bucket == "m16")
        .values(ends_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await session.commit()
    await limiter.hit("m16", "ends", 3, 60)
    row = await session.scalar(select(RateLimitWindow).where(RateLimitWindow.bucket == "m16"))
    assert row is not None and row.count == 1 and row.ends_at > datetime.now(UTC)


async def test_a_flood_cannot_grow_the_count_past_the_limit(
    app: FastAPI, session: AsyncSession
) -> None:
    for _ in range(10):
        try:
            await app.state.limiter.hit("m16", "flood", 2, 60)
        except ApiError:
            pass
    row = await session.scalar(select(RateLimitWindow).where(RateLimitWindow.bucket == "m16"))
    assert row is not None and row.count == 3


async def test_the_nightly_job_removes_ended_windows_only(
    app: FastAPI, session: AsyncSession
) -> None:
    await app.state.limiter.hit("m16", "open", 5, 3600)
    session.add(
        RateLimitWindow(
            bucket="m16", bucket_key="old", ends_at=datetime.now(UTC) - timedelta(days=1), count=1
        )
    )
    await session.commit()
    assert await purge_ended(session) == 1
    await session.commit()
    keys = list(
        await session.scalars(
            select(RateLimitWindow.bucket_key).where(RateLimitWindow.bucket == "m16")
        )
    )
    assert keys == ["open"]


async def test_limiter_keys_hold_no_address_or_email_in_clear(
    client: AsyncClient, session: AsyncSession
) -> None:
    await client.post(f"{API}/auth/login", json={"email": "nobody@vt.test", "password": "x" * 10})
    keys = list(await session.scalars(select(RateLimitWindow.bucket_key)))
    assert keys and all("@" not in key and "." not in key for key in keys)
    codes = set(await session.scalars(select(Client.client_code)))
    assert not codes & set(keys)


async def test_a_signed_in_user_is_limited_through_the_database(
    client: AsyncClient, app: FastAPI, session: AsyncSession
) -> None:
    headers = await tailor(client)
    me = (await client.get(f"{API}/me", headers=headers)).json()
    count = await session.scalar(
        select(RateLimitWindow.count).where(
            RateLimitWindow.bucket == "user", RateLimitWindow.bucket_key == me["user_id"]
        )
    )
    assert count == 1  # /auth/login does not count; the one /me did


class _Pause:
    """Holds the render in its thread until the test has changed the database."""

    def __init__(self) -> None:
        self.rendering = threading.Event()
        self.resume = threading.Event()
        self.original = sheets.render

    def render(self, data: Any) -> Any:
        self.rendering.set()
        self.resume.wait(10)
        return self.original(data)


async def _sheet_while_paused(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, headers: dict[str, str]
) -> tuple[asyncio.Task[Any], _Pause]:
    pause = _Pause()
    monkeypatch.setattr(sheets, "render", pause.render)
    task = asyncio.create_task(make_sheet(client, headers))
    await asyncio.get_running_loop().run_in_executor(None, pause.rendering.wait, 10)
    return task, pause


async def test_an_order_deleted_while_rendering_gets_no_sheet(
    client: AsyncClient, settings: Settings, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await tailor(client)
    task, pause = await _sheet_while_paused(client, monkeypatch, headers)
    gone = await client.delete(f"{API}/orders/{ORDER['order_id']}", headers=headers)
    assert gone.status_code == 204, gone.text
    pause.resume.set()
    reply = await task
    assert reply.status_code == 404 and reply.json()["code"] == "not_found", reply.text
    assert list(Path(settings.sheets_dir).glob("*")) == []
    assert await session.scalar(select(func.count()).select_from(SpecSheet)) == 0


async def test_a_client_deleted_while_rendering_gets_no_sheet(
    client: AsyncClient, settings: Settings, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await tailor(client)
    task, pause = await _sheet_while_paused(client, monkeypatch, headers)
    await session.execute(
        update(Client)
        .where(Client.client_code == ORDER["client_code"])
        .values(deleted_at=datetime.now(UTC))
    )
    await session.commit()
    pause.resume.set()
    reply = await task
    assert reply.status_code == 404 and reply.json()["code"] == "not_found", reply.text
    assert list(Path(settings.sheets_dir).glob("*")) == []
    assert await session.scalar(select(func.count()).select_from(SpecSheet)) == 0


async def test_the_profile_limit_keeps_no_client_code_in_clear(
    client: AsyncClient, session: AsyncSession
) -> None:
    # Privacy review of M16: the window row outlives the request and goes into every backup.
    from ingest_support import FREE_CODE, ROUTE, key, payload

    body = payload()
    reply = await client.post(ROUTE, json=body, headers=key(body))
    assert reply.status_code in (200, 201), reply.text
    keys = list(
        await session.scalars(
            select(RateLimitWindow.bucket_key).where(RateLimitWindow.bucket == "profile-code")
        )
    )
    assert len(keys) == 1 and FREE_CODE not in keys[0]
