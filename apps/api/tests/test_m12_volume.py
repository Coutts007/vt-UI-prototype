"""The load test's synthetic volume (backend-spec 16.4)."""

import pytest
from app.config import Settings
from app.models import Client, MeasurementProfile
from app.seed import SeedRefused
from app.volume import LOAD_EMAIL, load_volume
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def test_volume_writes_clients_and_profiles_a_tailor_can_list(
    session: AsyncSession, settings: Settings, client: AsyncClient
) -> None:
    assert await load_volume(session, settings, clients=12, filled=4, per_client=3)
    await session.commit()
    assert not await load_volume(session, settings, clients=12, filled=4, per_client=3)
    codes = select(Client.client_id).where(Client.client_code.like("LD%"))
    assert await session.scalar(select(func.count()).select_from(codes.subquery())) == 12
    profiles = await session.scalar(
        select(func.count()).where(MeasurementProfile.client_id.in_(codes))
    )
    assert profiles == 12
    login = await client.post(
        "/api/v1/auth/login", json={"email": LOAD_EMAIL, "password": "vt-demo-2026"}
    )
    token = login.json()["access_token"]
    listed = await client.get(
        "/api/v1/clients", headers={"Authorization": f"Bearer {token}"}, params={"page_size": 100}
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 12


async def test_volume_is_refused_in_production(session: AsyncSession, settings: Settings) -> None:
    with pytest.raises(SeedRefused):
        await load_volume(session, settings.model_copy(update={"env": "production"}), 10, 2, 2)
