from datetime import UTC, datetime, timedelta

import pytest
from app.config import Settings
from app.models import AuditLog, UserAccount
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import DEMO_PASSWORD, bearer, sign_in

WANJIRU = "wanjiru@vt.test"
LOGIN = "/api/v1/auth/login"


async def audit_count(session: AsyncSession, action: str) -> int:
    count = await session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == action)
    )
    return count or 0


async def test_login_returns_the_user_and_writes_audit(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = await audit_count(session, "login")
    response = await client.post(LOGIN, json={"email": WANJIRU, "password": DEMO_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["business_name"] == "Mama Wanjiru Tailors"
    assert body["user"]["phone"] == "+254700000001"
    assert await audit_count(session, "login") == before + 1


async def test_email_case_does_not_matter(client: AsyncClient) -> None:
    await sign_in(client, "WANJIRU@VT.TEST")


async def test_wrong_password_and_unknown_email_look_the_same(client: AsyncClient) -> None:
    wrong = await client.post(LOGIN, json={"email": WANJIRU, "password": "wrong-password"})
    unknown = await client.post(LOGIN, json={"email": "no@vt.test", "password": "wrong-password"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_five_failures_lock_the_account_even_for_the_right_password(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = await audit_count(session, "login_failed")
    for attempt in range(5):
        response = await client.post(LOGIN, json={"email": WANJIRU, "password": "wrong-password"})
        assert response.status_code == (429 if attempt == 4 else 401)
    assert response.json()["code"] == "account_locked"
    assert int(response.headers["retry-after"]) == 900
    assert await audit_count(session, "login_failed") == before + 5
    right = await client.post(LOGIN, json={"email": WANJIRU, "password": DEMO_PASSWORD})
    assert right.status_code == 429


async def test_lock_ends_after_its_time(client: AsyncClient, session: AsyncSession) -> None:
    user = await session.scalar(select(UserAccount).where(UserAccount.email == WANJIRU))
    assert user
    user.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    await sign_in(client, WANJIRU)


async def test_pending_account_gets_no_token(client: AsyncClient) -> None:
    response = await client.post(
        LOGIN, json={"email": "pending@vt.test", "password": DEMO_PASSWORD}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "account_pending"
    assert "access_token" not in response.json()


async def test_disabling_ends_a_live_session(client: AsyncClient, session: AsyncSession) -> None:
    token = await sign_in(client, WANJIRU)
    user = await session.scalar(select(UserAccount).where(UserAccount.email == WANJIRU))
    assert user
    user.status = "disabled"
    await session.commit()
    response = await client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 403
    assert response.json()["code"] == "account_disabled"


async def test_logout_revokes_the_token(client: AsyncClient, session: AsyncSession) -> None:
    token = await sign_in(client, WANJIRU)
    before = await audit_count(session, "logout")
    assert (await client.post("/api/v1/auth/logout", headers=bearer(token))).status_code == 204
    response = await client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 401 and response.json()["code"] == "token_expired"
    assert await audit_count(session, "logout") == before + 1


async def test_password_change_revokes_all_sessions(client: AsyncClient) -> None:
    first = await sign_in(client, WANJIRU)
    second = await sign_in(client, WANJIRU)
    response = await client.post(
        "/api/v1/me/password",
        headers=bearer(first),
        json={"current_password": DEMO_PASSWORD, "new_password": "a-brand-new-password"},
    )
    assert response.status_code == 204
    for token in (first, second):
        assert (await client.get("/api/v1/me", headers=bearer(token))).status_code == 401
    await sign_in(client, WANJIRU, "a-brand-new-password")


async def test_wrong_current_password_changes_nothing(client: AsyncClient) -> None:
    token = await sign_in(client, WANJIRU)
    response = await client.post(
        "/api/v1/me/password",
        headers=bearer(token),
        json={"current_password": "wrong-password", "new_password": "a-brand-new-password"},
    )
    assert response.status_code == 401 and response.json()["code"] == "invalid_credentials"
    assert (await client.get("/api/v1/me", headers=bearer(token))).status_code == 200


async def test_tampered_and_wrongly_signed_tokens_are_refused(
    client: AsyncClient, settings: Settings
) -> None:
    token = await sign_in(client, WANJIRU)
    assert (await client.get("/api/v1/me", headers=bearer(token + "x"))).status_code == 401
    import jwt

    claims = jwt.decode(token, options={"verify_signature": False})
    forged = jwt.encode(claims, "x" * 40, algorithm="HS256")
    assert (await client.get("/api/v1/me", headers=bearer(forged))).status_code == 401
    unsigned = jwt.encode(claims, "", algorithm="none")
    assert (await client.get("/api/v1/me", headers=bearer(unsigned))).status_code == 401


async def test_expired_token(client: AsyncClient, settings: Settings) -> None:
    from uuid import uuid4

    import jwt

    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(uuid4()),
            "role": "tailor",
            "tv": 0,
            "jti": str(uuid4()),
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    response = await client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 401 and response.json()["code"] == "token_expired"


async def test_register_creates_a_pending_tailor(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = {
        "email": "New@vt.test",
        "password": "long-enough-1",
        "business_name": "New",
        "phone": "0712345678",
        "area": "CBD",
        "locale": "sw",
    }
    response = await client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 201 and response.json() == {"status": "pending"}
    user = await session.scalar(select(UserAccount).where(UserAccount.email == "new@vt.test"))
    assert user and user.status == "pending" and user.locale == "sw" and user.role == "tailor"
    assert user.password_hash.startswith("$argon2id$")
    assert await audit_count(session, "register") == 1


async def test_register_does_not_reveal_a_taken_email(client: AsyncClient) -> None:
    body = {
        "email": WANJIRU,
        "password": "long-enough-1",
        "business_name": "Other",
        "phone": "0712345678",
        "area": "CBD",
        "locale": "en",
    }
    response = await client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 201
    await sign_in(client, WANJIRU)


@pytest.mark.parametrize(
    "change",
    [
        {"password": "abc1"},
        {"phone": "12345"},
        {"role": "admin"},
        {"email": "not-an-email"},
        {"business_name": "x" * 121},
    ],
)
async def test_register_validation_names_fields_but_never_echoes_values(
    client: AsyncClient, change: dict[str, str]
) -> None:
    body = {
        "email": "a@vt.test",
        "password": "long-enough-1",
        "business_name": "New",
        "phone": "0712345678",
        "area": "CBD",
        "locale": "en",
        **change,
    }
    response = await client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"
    for value in change.values():
        assert value not in response.text


async def test_update_me(client: AsyncClient, session: AsyncSession) -> None:
    token = await sign_in(client, WANJIRU)
    before = await audit_count(session, "settings_change")
    response = await client.patch(
        "/api/v1/me", headers=bearer(token), json={"area": "Ngara", "unit_pref": "in"}
    )
    assert response.status_code == 200
    assert response.json()["area"] == "Ngara" and response.json()["unit_pref"] == "in"
    assert await audit_count(session, "settings_change") == before + 1
    refused = await client.patch("/api/v1/me", headers=bearer(token), json={"role": "admin"})
    assert refused.status_code == 422


async def test_login_rate_limit_says_when_to_retry(client: AsyncClient, app: FastAPI) -> None:
    for _ in range(20):
        await client.post(LOGIN, json={"email": "no@vt.test", "password": "x"})
    response = await client.post(LOGIN, json={"email": "no@vt.test", "password": "x"})
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["retry-after"]) > 0


async def test_a_lockout_does_not_reveal_whether_an_account_exists(client: AsyncClient) -> None:
    for email in (WANJIRU, "no-such-person@vt.test"):
        replies = [
            await client.post(LOGIN, json={"email": email, "password": "wrong-password"})
            for _ in range(6)
        ]
        assert [reply.status_code for reply in replies] == [401, 401, 401, 401, 429, 429]
        assert replies[-1].json()["code"] == "account_locked"
        assert int(replies[-1].headers["retry-after"]) > 0


async def test_attempts_on_a_locked_account_are_audited(
    client: AsyncClient, session: AsyncSession
) -> None:
    for _ in range(5):
        await client.post(LOGIN, json={"email": WANJIRU, "password": "wrong-password"})
    before = await audit_count(session, "login_failed")
    await client.post(LOGIN, json={"email": WANJIRU, "password": DEMO_PASSWORD})
    assert await audit_count(session, "login_failed") == before + 1


async def test_guessing_the_current_password_is_limited_and_audited(
    client: AsyncClient, session: AsyncSession
) -> None:
    token = await sign_in(client, WANJIRU)
    before = await audit_count(session, "login_failed")
    change = {"current_password": "wrong-password", "new_password": "a-new-password-1"}
    codes = [
        (await client.post("/api/v1/me/password", headers=bearer(token), json=change)).status_code
        for _ in range(6)
    ]
    assert codes == [401, 401, 401, 401, 401, 429]
    assert await audit_count(session, "login_failed") == before + 5


async def test_a_password_change_is_audited(client: AsyncClient, session: AsyncSession) -> None:
    token = await sign_in(client, WANJIRU)
    before = await audit_count(session, "settings_change")
    change = {"current_password": DEMO_PASSWORD, "new_password": "a-new-password-1"}
    response = await client.post("/api/v1/me/password", headers=bearer(token), json=change)
    assert response.status_code == 204
    assert await audit_count(session, "settings_change") == before + 1


async def test_a_user_is_limited_to_300_requests_a_minute(
    client: AsyncClient, app: FastAPI
) -> None:
    token = await sign_in(client, WANJIRU)
    user_id = (await client.get("/api/v1/me", headers=bearer(token))).json()["user_id"]
    app.state.limiter.windows.pop(("user", user_id))
    for _ in range(300):
        app.state.limiter.hit("user", user_id, 300, 60)
    response = await client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"


async def test_register_is_limited_to_five_an_hour(client: AsyncClient) -> None:
    def form(number: int) -> dict[str, str]:
        return {
            "email": f"new{number}@vt.test",
            "password": "a-long-password",
            "business_name": "New shop",
            "phone": "0712345678",
            "area": "Ngara",
            "locale": "en",
        }

    for number in range(5):
        assert (await client.post("/api/v1/auth/register", json=form(number))).status_code == 201
    assert (await client.post("/api/v1/auth/register", json=form(9))).status_code == 429


@pytest.mark.parametrize("field", ["email", "password"])
async def test_nul_characters_are_refused_without_a_server_error(
    client: AsyncClient, field: str
) -> None:
    body = {"email": "a@vt.test", "password": "long-enough-1"} | {field: "a\u0000@vt.test"}
    response = await client.post(LOGIN, json=body)
    assert response.status_code == 422
    assert "vt.test" not in response.text
