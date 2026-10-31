import math
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.errors import ApiError
from app.models import Measurer, RevokedToken, Tailor, UserAccount
from app.schemas import (
    LoginInput,
    LoginResult,
    PasswordChange,
    RegisterInput,
    RegisterResult,
    User,
    UserUpdate,
)
from app.security.deps import CurrentPrincipal, Session
from app.security.ip_hash import ip_hash, keyed_hash
from app.security.passwords import burn_time, hash_password, verify_password
from app.security.tokens import create_token
from app.services import audit
from app.services.ratelimit import limit_by_ip

router = APIRouter(tags=["auth"])

MAX_FAILURES = 5
LOCK_MINUTES = 15
LOCK_SECONDS = LOCK_MINUTES * 60
PASSWORD_ATTEMPTS = 5


def to_e164(phone: str) -> str:
    return f"+254{phone[1:]}" if phone.startswith("0") else phone


async def user_view(session: AsyncSession, user: UserAccount) -> User:
    view = User(
        user_id=str(user.user_id),
        email=user.email,
        role=user.role,  # type: ignore[arg-type]
        status=user.status,  # type: ignore[arg-type]
        locale=user.locale,  # type: ignore[arg-type]
        unit_pref=user.unit_pref,  # type: ignore[arg-type]
    )
    if user.role == "tailor":
        tailor = await session.scalar(select(Tailor).where(Tailor.user_id == user.user_id))
        if tailor:
            view.business_name = tailor.business_name
            view.phone = tailor.phone_e164
            view.area = tailor.area
    if user.role == "measurer":
        view.measurer_code = await session.scalar(
            select(Measurer.measurer_code).where(Measurer.user_id == user.user_id)
        )
    return view


@router.post(
    "/auth/register",
    operation_id="register",
    status_code=201,
    response_model=RegisterResult,
    dependencies=[Depends(limit_by_ip("register", 5, 3600))],
)
async def register(body: RegisterInput, request: Request, session: Session) -> RegisterResult:
    # The reply is the same for a taken email, so this cannot be used to find accounts.
    password_hash = await run_in_threadpool(hash_password, body.password)
    if await session.scalar(select(UserAccount).where(UserAccount.email == body.email)):
        return RegisterResult(status="pending")
    user = UserAccount(
        email=body.email,
        password_hash=password_hash,
        role="tailor",
        status="pending",
        locale=body.locale,
    )
    session.add(user)
    try:
        await session.flush()
        session.add(
            Tailor(
                user_id=user.user_id,
                business_name=body.business_name,
                phone_e164=to_e164(body.phone),
                area=body.area,
            )
        )
        audit.record(
            session,
            actor_type="user",
            action="register",
            entity_type="user",
            entity_id=user.user_id,
            user_id=user.user_id,
            ip_hash=ip_hash(request),
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
    return RegisterResult(status="pending")


@router.post(
    "/auth/login",
    operation_id="login",
    response_model=LoginResult,
    response_model_exclude_none=True,
    dependencies=[Depends(limit_by_ip("login", 20, 60))],
)
async def login(body: LoginInput, request: Request, session: Session) -> LoginResult:
    user = await session.scalar(
        select(UserAccount).where(UserAccount.email == body.email).with_for_update()
    )
    hashed_ip = ip_hash(request)
    if not user:
        await run_in_threadpool(burn_time, body.password)
        # An unknown email locks the same way as a real one, so a lockout reveals no account.
        email_key = keyed_hash(request, body.email)
        try:
            request.app.state.limiter.hit(
                "login-unknown", email_key, MAX_FAILURES - 1, LOCK_SECONDS
            )
        except ApiError as error:
            raise ApiError("account_locked", headers=error.headers) from error
        raise ApiError("invalid_credentials")
    now = datetime.now(UTC)
    if user.locked_until and user.locked_until > now:
        await run_in_threadpool(burn_time, body.password)
        wait = math.ceil((user.locked_until - now).total_seconds())
        audit.record(
            session,
            actor_type="user",
            action="login_failed",
            entity_type="user",
            entity_id=user.user_id,
            user_id=user.user_id,
            ip_hash=hashed_ip,
            detail={"locked": True, "while_locked": True},
        )
        await session.commit()
        raise ApiError("account_locked", headers={"Retry-After": str(wait)})
    if not await run_in_threadpool(verify_password, user.password_hash, body.password):
        user.failed_logins += 1
        locked = user.failed_logins >= MAX_FAILURES
        if locked:
            user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
            user.failed_logins = 0
        audit.record(
            session,
            actor_type="user",
            action="login_failed",
            entity_type="user",
            entity_id=user.user_id,
            user_id=user.user_id,
            ip_hash=hashed_ip,
            detail={"locked": locked},
        )
        await session.commit()
        if locked:
            raise ApiError("account_locked", headers={"Retry-After": str(LOCK_SECONDS)})
        raise ApiError("invalid_credentials")
    if user.status != "active":
        code = f"account_{user.status}"
        await session.rollback()
        raise ApiError(code)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    settings = request.app.state.settings
    token, expires = create_token(
        user.user_id, user.role, user.token_version, settings.jwt_secret, settings.token_hours
    )
    audit.record(
        session,
        actor_type="user",
        action="login",
        entity_type="user",
        entity_id=user.user_id,
        user_id=user.user_id,
        ip_hash=hashed_ip,
    )
    await session.commit()
    return LoginResult(access_token=token, expires_at=expires, user=await user_view(session, user))


@router.post("/auth/logout", operation_id="logout", status_code=204)
async def logout(principal: CurrentPrincipal, request: Request, session: Session) -> Response:
    session.add(
        RevokedToken(
            jti=principal.claims["jti"],
            expires_at=datetime.fromtimestamp(principal.claims["exp"], UTC),
        )
    )
    audit.record(
        session,
        actor_type="user",
        action="logout",
        entity_type="user",
        entity_id=principal.user.user_id,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
    )
    await session.commit()
    return Response(status_code=204)


@router.get("/me", operation_id="getMe", response_model=User, response_model_exclude_none=True)
async def get_me(principal: CurrentPrincipal, session: Session) -> User:
    return await user_view(session, principal.user)


@router.patch("/me", operation_id="updateMe", response_model=User, response_model_exclude_none=True)
async def update_me(
    body: UserUpdate, principal: CurrentPrincipal, request: Request, session: Session
) -> User:
    user = principal.user
    changes = body.model_dump(exclude_none=True)
    if "locale" in changes:
        user.locale = changes["locale"]
    if "unit_pref" in changes:
        user.unit_pref = changes["unit_pref"]
    if {"business_name", "phone", "area"} & changes.keys():
        tailor = await session.scalar(select(Tailor).where(Tailor.user_id == user.user_id))
        if not tailor:
            raise ApiError("validation_failed")
        tailor.business_name = changes.get("business_name", tailor.business_name)
        tailor.area = changes.get("area", tailor.area)
        if "phone" in changes:
            tailor.phone_e164 = to_e164(changes["phone"])
    audit.record(
        session,
        actor_type="user",
        action="settings_change",
        entity_type="user",
        entity_id=user.user_id,
        user_id=user.user_id,
        ip_hash=ip_hash(request),
        detail={"fields": sorted(changes)},
    )
    await session.commit()
    return await user_view(session, user)


@router.post("/me/password", operation_id="changePassword", status_code=204)
async def change_password(
    body: PasswordChange, principal: CurrentPrincipal, request: Request, session: Session
) -> Response:
    user = principal.user
    # A stolen session must not be able to guess the password behind it.
    limiter = request.app.state.limiter
    limiter.hit("password", str(user.user_id), PASSWORD_ATTEMPTS, LOCK_SECONDS)
    if not await run_in_threadpool(verify_password, user.password_hash, body.current_password):
        audit.record(
            session,
            actor_type="user",
            action="login_failed",
            entity_type="user",
            entity_id=user.user_id,
            user_id=user.user_id,
            ip_hash=ip_hash(request),
            detail={"via": "password_change"},
        )
        await session.commit()
        raise ApiError("invalid_credentials")
    user.password_hash = await run_in_threadpool(hash_password, body.new_password)
    user.token_version += 1
    audit.record(
        session,
        actor_type="user",
        action="settings_change",
        entity_type="user",
        entity_id=user.user_id,
        user_id=user.user_id,
        ip_hash=ip_hash(request),
        detail={"fields": ["password"]},
    )
    await session.commit()
    return Response(status_code=204)
