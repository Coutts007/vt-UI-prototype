import json

import pytest
import structlog
from fastapi import FastAPI
from httpx import AsyncClient
from support import DEMO_PASSWORD, bearer, sign_in

LOGIN = "/api/v1/auth/login"


async def test_oversized_body_is_refused(client: AsyncClient) -> None:
    response = await client.post(
        LOGIN, content=b"x" * (256 * 1024 + 1), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413 and response.json()["code"] == "payload_too_large"


async def test_oversized_body_without_a_length_header_is_refused(client: AsyncClient) -> None:
    async def chunks():  # type: ignore[no-untyped-def]
        for _ in range(4):
            yield b"x" * (100 * 1024)

    response = await client.post(
        LOGIN, content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


@pytest.mark.parametrize(
    "content_type", ["multipart/form-data; boundary=x", "application/octet-stream", "image/png"]
)
async def test_only_json_is_accepted(client: AsyncClient, content_type: str) -> None:
    response = await client.post(LOGIN, content=b"abc", headers={"Content-Type": content_type})
    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_media_type"


async def test_malformed_json_is_a_problem(client: AsyncClient) -> None:
    response = await client.post(
        LOGIN, content=b"{bad", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422


async def test_logs_carry_no_personal_data(client: AsyncClient) -> None:
    with structlog.testing.capture_logs() as logs:
        token = await sign_in(client, "wanjiru@vt.test")
        await client.post(LOGIN, json={"email": "wanjiru@vt.test", "password": "wrong-password"})
        await client.get("/api/v1/me", headers=bearer(token))
        await client.get("/api/v1/client-codes/AB1001")
    assert logs and logs[0]["route"] == "/auth/login"
    text = json.dumps(logs)
    for secret in ("wanjiru", DEMO_PASSWORD, "wrong-password", token, "AB1001", "Mama"):
        assert secret not in text
    assert {"route", "method", "status", "ms", "correlation_id"} <= logs[0].keys()


async def test_a_crash_keeps_the_headers_and_logs_no_details(
    app: FastAPI, client: AsyncClient, capsys: pytest.CaptureFixture[str]
) -> None:
    @app.get("/probe/crash")
    async def crash() -> None:
        raise RuntimeError("secret-person@vt.test")

    response = await client.get("/probe/crash")
    assert response.status_code == 500
    assert response.json()["code"] == "server_error"
    assert "secret-person" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-correlation-id"]
    captured = capsys.readouterr()
    assert "secret-person" not in captured.out + captured.err
    assert "RuntimeError" in captured.out + captured.err


def test_database_errors_hide_their_values(app: FastAPI) -> None:
    assert app.state.engine.sync_engine.hide_parameters is True
