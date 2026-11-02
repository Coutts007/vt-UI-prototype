"""Inputs found by fuzzing (M12): NUL characters and an overflowing page are refused, never a 500."""

from httpx import AsyncClient


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
