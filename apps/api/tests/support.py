from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DEMO_PASSWORD = "vt-demo-2026"


async def owner_execute(url: str, *statements: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        for statement in statements:
            await connection.execute(text(statement))
    await engine.dispose()


async def sign_in(client: AsyncClient, email: str, password: str = DEMO_PASSWORD) -> str:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
