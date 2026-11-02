"""The client list after the load-test changes (M12): same answers, served from the new index."""

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

API = "/api/v1"


async def test_a_final_profile_wins_over_a_newer_conflict(client: AsyncClient) -> None:
    headers = bearer(await sign_in(client, "wanjiru@vt.test"))
    page = await client.get(f"{API}/clients", params={"search": "AB1006"}, headers=headers)
    (row,) = page.json()["items"]
    # Seed: AB1006 has a final v3 captured on 26 October and a conflict on 27 October.
    assert row["last_capture_at"].startswith("2026-10-26")


async def test_the_total_without_a_filter_counts_every_live_client(client: AsyncClient) -> None:
    headers = bearer(await sign_in(client, "wanjiru@vt.test"))
    page = await client.get(f"{API}/clients", params={"page_size": 100}, headers=headers)
    body = page.json()
    assert body["total"] == len(body["items"]) > 0
    empty = await client.get(
        f"{API}/clients", params={"filter": "no_profiles", "page_size": 100}, headers=headers
    )
    assert empty.json()["total"] == len(empty.json()["items"]) < body["total"]


async def test_the_current_profile_index_exists(session: AsyncSession) -> None:
    definition = await session.scalar(
        text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_profile_current'")
    )
    assert definition is not None
    assert "WHERE ((status)::text <> 'superseded'::text)" in definition
