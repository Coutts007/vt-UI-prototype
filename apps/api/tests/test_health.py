from httpx import AsyncClient


async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_checks_the_database(client: AsyncClient) -> None:
    response = await client.get("/api/v1/ready")
    assert response.status_code == 200 and response.json() == {"status": "ok"}


async def test_public_settings_come_from_the_seed(client: AsyncClient) -> None:
    body = (await client.get("/api/v1/settings/public")).json()
    assert body["study_mode"] is True
    assert body["current_rules_version"] == "0.1-uncalibrated"


async def test_security_headers(client: AsyncClient) -> None:
    headers = (await client.get("/api/v1/health")).headers
    assert headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["cache-control"] == "no-store"
    assert headers["x-correlation-id"]


async def test_unknown_path_is_a_problem(client: AsyncClient) -> None:
    response = await client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "not_found"
