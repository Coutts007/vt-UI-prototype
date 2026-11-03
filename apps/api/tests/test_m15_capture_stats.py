"""Completion per capture mode (NFR-07, M15): counts only, admin only."""

from app.models import CaptureSession
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

API = "/api/v1"


async def test_counts_per_mode_follow_the_stored_sessions(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = bearer(await sign_in(client, "admin@vt.test"))
    before = (await client.get(f"{API}/admin/capture-stats", headers=admin)).json()
    assert before["sessions"] == 12
    by_mode = {
        (m["capture_mode"], m["camera_facing"], m["guidance_mode"]): m for m in before["modes"]
    }
    assert by_mode[("self", "environment", "voice")]["sessions"] == 11
    assert by_mode[("assisted", "environment", "visual")]["sessions"] == 1
    assert all(m["within_three_attempts_pct"] == 100.0 for m in before["modes"])

    # Two self captures needed a third attempt, and one came from the front camera (A4).
    ordered = select(CaptureSession.session_id).order_by(CaptureSession.started_at)
    ids = (await session.scalars(ordered)).all()
    await session.execute(
        update(CaptureSession).where(CaptureSession.session_id.in_(ids[:2])).values(retake_count=3)
    )
    await session.execute(
        update(CaptureSession)
        .where(CaptureSession.session_id == ids[2])
        .values(camera_facing="user", guidance_mode="visual", level_unchecked=True)
    )
    await session.commit()

    after = (await client.get(f"{API}/admin/capture-stats", headers=admin)).json()
    assert after["sessions"] == 12
    rows = {(m["capture_mode"], m["camera_facing"], m["guidance_mode"]): m for m in after["modes"]}
    voice = rows[("self", "environment", "voice")]
    assert voice["sessions"] == 10
    assert voice["within_three_attempts"] == 8
    assert voice["within_three_attempts_pct"] == 80.0
    assert voice["mean_retake_count"] == 0.6
    front = rows[("self", "user", "visual")]
    assert front == {
        "capture_mode": "self",
        "camera_facing": "user",
        "guidance_mode": "visual",
        "sessions": 1,
        "within_three_attempts": 1,
        "within_three_attempts_pct": 100.0,
        "mean_retake_count": 0.0,
        "level_unchecked": 1,
        "capture_fallback": 0,
    }
    # Nothing in the reply names a client, code or value.
    text = (await client.get(f"{API}/admin/capture-stats", headers=admin)).text
    assert "client" not in text and "AB10" not in text and "_mm" not in text


async def test_only_the_admin_reads_it(client: AsyncClient) -> None:
    tailor = bearer(await sign_in(client, "wanjiru@vt.test"))
    assert (await client.get(f"{API}/admin/capture-stats", headers=tailor)).status_code == 403
    assert (await client.get(f"{API}/admin/capture-stats")).status_code == 401
