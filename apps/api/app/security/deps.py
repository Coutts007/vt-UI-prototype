import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.errors import ApiError
from app.models import Client, RevokedToken, Tailor, UserAccount
from app.security.tokens import read_token

Session = Annotated[AsyncSession, Depends(get_session)]


@dataclass
class Principal:
    user: UserAccount
    claims: dict[str, Any]


async def current_principal(request: Request, session: Session) -> Principal:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError("unauthorized")
    claims = read_token(token, request.app.state.settings.jwt_secret)
    try:
        user_id = uuid.UUID(claims["sub"])
    except ValueError as error:
        raise ApiError("unauthorized") from error
    if await session.get(RevokedToken, claims["jti"]):
        raise ApiError("token_expired")
    user = await session.get(UserAccount, user_id)
    if not user or user.token_version != claims["tv"]:
        raise ApiError("token_expired")
    if user.status != "active":
        raise ApiError(f"account_{user.status}")
    request.app.state.limiter.hit("user", str(user.user_id), 300, 60)
    return Principal(user, claims)


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def require_role(*roles: str) -> Callable[[Principal], Awaitable[Principal]]:
    async def check(principal: CurrentPrincipal) -> Principal:
        if principal.user.role not in roles:
            raise ApiError("forbidden")
        return principal

    return check


async def tailor_of(session: AsyncSession, user: UserAccount) -> Tailor:
    tailor = await session.scalar(select(Tailor).where(Tailor.user_id == user.user_id))
    if not tailor:
        raise ApiError("forbidden")
    return tailor


async def owned_client(session: AsyncSession, user: UserAccount, client_id: uuid.UUID) -> Client:
    """A tailor reaches only their own clients. Admins and measurers never pass here."""
    tailor = await tailor_of(session, user)
    client = await session.get(Client, client_id)
    if not client or client.deleted_at is not None:
        raise ApiError("not_found")
    if client.tailor_id != tailor.tailor_id:
        raise ApiError("forbidden")
    return client
