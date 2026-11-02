"""Synthetic volume for the load test (backend-spec 16.4): one tailor, many clients and profiles.

Every row is a copy of a seed profile with new ids, so nothing here is a real person's. Refused in
production, like the demo seed.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    CaptureSession,
    Client,
    Consent,
    Measurement,
    MeasurementProfile,
    ServerCheck,
    Tailor,
    UserAccount,
)
from app.security.passwords import hash_password
from app.seed import PACKAGES, SeedRefused, profile_rows

LOAD_EMAIL = "load@vt.test"
CODE_PREFIX = "LD"
BATCH = 500


async def load_volume(
    session: AsyncSession, settings: Settings, clients: int, filled: int, per_client: int
) -> bool:
    """Returns False if the volume is already there. Clients past `filled` have no profile."""
    if settings.env == "production":
        raise SeedRefused("Load-test data cannot be loaded in production")
    if not 0 < filled <= clients <= 10_000:
        raise SeedRefused("Need 0 < filled <= clients <= 10000")
    if await session.scalar(select(UserAccount).where(UserAccount.email == LOAD_EMAIL)):
        return False
    seed = json.loads((PACKAGES / "seed/seed.json").read_text())
    template = next(p for p in seed["profiles"] if p["status"] == "final" and p["version"] == 1)
    now = datetime.now(UTC)
    tailor_id = uuid.uuid4()
    session.add(
        UserAccount(
            user_id=tailor_id,
            email=LOAD_EMAIL,
            password_hash=hash_password(seed["demo_password"]),
            role="tailor",
            status="active",
            locale="en",
            unit_pref="cm",
            created_at=now,
        )
    )
    await session.flush()
    session.add(
        Tailor(
            tailor_id=tailor_id,
            user_id=tailor_id,
            business_name="Load test tailor",
            phone_e164="+254700000000",
            area="Synthetic",
            created_at=now,
        )
    )
    await session.flush()
    client_rows = [
        {
            "client_id": uuid.uuid4(),
            "client_code": f"{CODE_PREFIX}{n:04d}",
            "tailor_id": tailor_id,
            "display_name": f"Load {n:04d}",
            "created_at": now,
            "source": "tailor",
        }
        for n in range(clients)
    ]
    for start in range(0, clients, BATCH):
        await session.execute(insert(Client), client_rows[start : start + BATCH])
    tables: dict[Any, list[dict[str, Any]]] = {
        CaptureSession: [],
        MeasurementProfile: [],
        Measurement: [],
        ServerCheck: [],
        Consent: [],
    }

    async def flush() -> None:
        for model, rows in tables.items():
            for start in range(0, len(rows), BATCH):
                await session.execute(insert(model), rows[start : start + BATCH])
            rows.clear()

    for client in client_rows[:filled]:
        for version in range(1, per_client + 1):
            row = json.loads(json.dumps(template))
            row["client_id"] = str(client["client_id"])
            row["profile_id"] = str(uuid.uuid4())
            row["session"]["session_id"] = str(uuid.uuid4())
            row["session"].pop("study", None)
            row["version"] = version
            row["status"] = "final" if version == per_client else "superseded"
            capture, profile, measurements, checks, consent = profile_rows(row, {})
            tables[CaptureSession].append(capture)
            tables[MeasurementProfile].append(profile)
            tables[Measurement].extend(measurements)
            tables[ServerCheck].extend(checks)
            if version == 1:
                tables[Consent].append(consent)
        if len(tables[MeasurementProfile]) >= 2_000:
            await flush()
    await flush()
    return True
