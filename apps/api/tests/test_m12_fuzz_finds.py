"""Inputs and replies found by fuzzing (M12): never a 500, and replies match the contract."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import jsonschema
import yaml
from app.models import DeletionRequest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

CONTRACT = yaml.safe_load(
    (Path(__file__).parents[3] / "packages/contracts/openapi.yaml").read_text()
)


async def test_nul_in_a_query_is_refused(client: AsyncClient) -> None:
    reply = await client.get("/api/v1/tailors", params={"search": "a\x00b"})
    assert reply.status_code == 422
    assert reply.json()["code"] == "validation_failed"


async def test_nul_in_a_path_is_refused(client: AsyncClient) -> None:
    reply = await client.get("/api/v1/client-codes/AB%0001")
    assert reply.status_code == 422


async def test_nul_in_a_json_string_is_refused(client: AsyncClient) -> None:
    reply = await client.post(
        "/api/v1/auth/login",
        content=b'{"email": "a\\u0000@vt.test", "password": "x"}',
        headers={"content-type": "application/json"},
    )
    assert reply.status_code == 422
    assert reply.json()["code"] == "validation_failed"


async def test_an_escaped_backslash_before_u0000_is_ordinary_text(client: AsyncClient) -> None:
    reply = await client.post(
        "/api/v1/auth/login",
        content=b'{"email": "a\\\\u0000@vt.test", "password": "not-the-password"}',
        headers={"content-type": "application/json"},
    )
    assert reply.status_code == 401


async def test_a_page_past_the_limit_is_refused_not_a_server_error(client: AsyncClient) -> None:
    reply = await client.get("/api/v1/tailors", params={"page": 2**63})
    assert reply.status_code == 422
    assert reply.json()["code"] == "validation_failed"


def fits(schema: str, value: Any) -> None:
    document = {"$ref": f"#/components/schemas/{schema}", "components": CONTRACT["components"]}
    jsonschema.Draft202012Validator(document).validate(value)


async def test_conflicts_match_the_contract(client: AsyncClient) -> None:
    headers = bearer(await sign_in(client, "wanjiru@vt.test"))
    reply = await client.get("/api/v1/conflicts", headers=headers)
    assert reply.status_code == 200 and reply.json()
    for conflict in reply.json():
        fits("Conflict", conflict)


async def test_deletion_requests_match_the_contract(
    client: AsyncClient, session: AsyncSession
) -> None:
    # One finished request without a note and one held request with one.
    now = datetime.now(UTC)
    session.add(
        DeletionRequest(
            client_code_hash="0" * 64,
            reason="delete",
            status="done",
            received_at=now,
            completed_at=now,
        )
    )
    session.add(
        DeletionRequest(
            client_code_hash="1" * 64, reason="delete", status="received", received_at=now, note="x"
        )
    )
    await session.commit()
    headers = bearer(await sign_in(client, "admin@vt.test"))
    reply = await client.get("/api/v1/admin/deletion-requests", headers=headers)
    assert reply.status_code == 200 and reply.json()
    for request in reply.json():
        fits("DeletionRequest", request)
