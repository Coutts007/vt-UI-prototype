"""The tailor directory and code verification (D27). Public replies carry published fields only."""

import secrets
import string
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy import ColumnElement, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.errors import ApiError
from app.models import Client, MeasurementProfile, Order, Participant, Tailor, UserAccount
from app.schemas import (
    ClientCodeCheck,
    DirectoryClient,
    DirectoryClientPage,
    DirectoryClientsRemoved,
    DirectoryCodeIssued,
    Specialty,
    TailorListing,
    TailorListingPage,
)
from app.security.deps import CurrentPrincipal, Session, require_role, tailor_of
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services.ratelimit import limit_by_network

router = APIRouter()

# backend-spec 7: letters without I and O, plus four digits.
CODE_LETTERS = "".join(c for c in string.ascii_uppercase if c not in "IO")
CODE_ATTEMPTS = 8
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


def new_code() -> str:
    letters = "".join(secrets.choice(CODE_LETTERS) for _ in range(2))
    digits = "".join(secrets.choice(string.digits) for _ in range(4))
    return letters + digits


DAY = 86400


def directory_on(request: Request) -> None:
    """Switched off, the directory looks as if it was never there (D27)."""
    if not request.app.state.settings.directory_enabled:
        raise ApiError("not_found")


LISTED: tuple[ColumnElement[bool], ...] = (
    Tailor.directory_listed.is_(True),
    UserAccount.status == "active",
)


@router.get(
    "/client-codes/{code}",
    operation_id="verifyClientCode",
    response_model=ClientCodeCheck,
    tags=["public"],
    dependencies=[
        Depends(limit_by_network("code-check-minute", 10, 60)),
        Depends(limit_by_network("code-check-day", 100, 86400)),
    ],
)
async def verify_client_code(
    code: Annotated[str, Path(pattern=r"^[A-Z]{2}[0-9]{4}$")], session: Session
) -> ClientCodeCheck:
    row = (
        await session.execute(
            select(Client.height_mm, Tailor.business_name)
            .join(Tailor, Tailor.tailor_id == Client.tailor_id)
            .where(Client.client_code == code, Client.deleted_at.is_(None))
        )
    ).first()
    if not row:
        raise ApiError("code_not_found")
    return ClientCodeCheck(
        valid=True, tailor_business_name=row.business_name, height_mm=row.height_mm
    )


@router.get(
    "/tailors",
    operation_id="listTailors",
    response_model=TailorListingPage,
    tags=["public"],
    dependencies=[Depends(directory_on), Depends(limit_by_network("directory-list", 60, 60))],
)
async def list_tailors(
    session: Session,
    search: Annotated[str | None, Query(max_length=60)] = None,
    area: Annotated[str | None, Query(max_length=120)] = None,
    specialty: Specialty | None = None,
    page: Page = 1,
    page_size: PageSize = 25,
) -> TailorListingPage:
    listed = select(Tailor).join(UserAccount, UserAccount.user_id == Tailor.user_id).where(*LISTED)
    areas = await session.scalars(
        select(Tailor.area)
        .join(UserAccount, UserAccount.user_id == Tailor.user_id)
        .where(*LISTED, Tailor.area != "")
        .distinct()
        .order_by(Tailor.area)
    )
    query = listed
    words = (search or "").strip()
    if words:
        query = query.where(
            or_(
                Tailor.business_name.icontains(words, autoescape=True),
                Tailor.area.icontains(words, autoescape=True),
                Tailor.directory_description.icontains(words, autoescape=True),
            )
        )
    if area:
        query = query.where(func.lower(Tailor.area) == area.strip().lower())
    if specialty:
        query = query.where(Tailor.directory_specialties.contains([specialty]))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = await session.scalars(
        query.order_by(Tailor.business_name, Tailor.listing_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return TailorListingPage(
        items=[
            TailorListing(
                listing_id=str(row.listing_id),
                business_name=row.business_name,
                area=row.area,
                specialties=row.directory_specialties,  # type: ignore[arg-type]
                description=row.directory_description,
                phone=row.phone_e164 if row.directory_show_phone else None,
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
        areas=list(areas),
    )


@router.post(
    "/tailors/{listing_id}/codes",
    operation_id="issueDirectoryCode",
    status_code=201,
    response_model=DirectoryCodeIssued,
    tags=["public"],
    dependencies=[
        Depends(directory_on),
        Depends(limit_by_network("directory-code-hour", 10, 3600)),
        Depends(limit_by_network("directory-code-day", 30, DAY)),
    ],
)
async def issue_directory_code(
    listing_id: uuid.UUID, request: Request, session: Session
) -> DirectoryCodeIssued:
    tailor = await session.scalar(
        select(Tailor)
        .join(UserAccount, UserAccount.user_id == Tailor.user_id)
        .where(Tailor.listing_id == listing_id, *LISTED)
    )
    if not tailor:
        raise ApiError("not_found")
    owner, business_name = tailor.tailor_id, tailor.business_name
    # The tailor first: taps at a tailor already refused must not use up everyone's allowance.
    settings = request.app.state.settings
    limiter = request.app.state.limiter
    limiter.hit("directory-code-tailor", str(owner), settings.directory_codes_per_tailor_day, DAY)
    limiter.hit("directory-code-global", "all", settings.directory_codes_global_day, DAY)
    for _ in range(CODE_ATTEMPTS):
        client = Client(client_code=new_code(), tailor_id=owner, source="directory")
        try:
            async with session.begin_nested():
                session.add(client)
                await session.flush()
        except IntegrityError:
            continue
        break
    else:
        raise ApiError("server_error")
    audit.record(
        session,
        actor_type="client",
        action="code_issue",
        entity_type="client",
        entity_id=client.client_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail={"source": "directory"},
    )
    code = client.client_code
    await session.commit()
    return DirectoryCodeIssued(client_code=code, tailor_business_name=business_name)


def own_directory_clients(tailor_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    return (
        Client.tailor_id == tailor_id,
        Client.source == "directory",
        Client.deleted_at.is_(None),
    )


# Nothing has been done with these codes, so removing one loses nothing.
UNUSED: tuple[ColumnElement[bool], ...] = (
    ~exists().where(MeasurementProfile.client_id == Client.client_id),
    ~exists().where(Order.client_id == Client.client_id),
    ~exists().where(Participant.client_id == Client.client_id),
)


@router.get(
    "/me/directory-clients",
    operation_id="listDirectoryClients",
    response_model=DirectoryClientPage,
    tags=["clients"],
    dependencies=[Depends(require_role("tailor"))],
)
async def list_directory_clients(
    principal: CurrentPrincipal, session: Session, page: Page = 1, page_size: PageSize = 25
) -> DirectoryClientPage:
    tailor = await tailor_of(session, principal.user)
    mine = own_directory_clients(tailor.tailor_id)
    total = await session.scalar(select(func.count()).select_from(Client).where(*mine))
    unused = await session.scalar(select(func.count()).select_from(Client).where(*mine, *UNUSED))
    has_profile = exists().where(MeasurementProfile.client_id == Client.client_id)
    rows = await session.execute(
        select(Client.client_id, Client.client_code, Client.created_at, has_profile.label("used"))
        .where(*mine)
        .order_by(Client.created_at.desc(), Client.client_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return DirectoryClientPage(
        items=[
            DirectoryClient(
                client_id=str(row.client_id),
                client_code=row.client_code,
                created_at=row.created_at,
                has_profile=row.used,
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
        unused_total=unused or 0,
    )


@router.post(
    "/me/directory-clients/remove-unused",
    operation_id="removeUnusedDirectoryClients",
    response_model=DirectoryClientsRemoved,
    tags=["clients"],
    dependencies=[Depends(require_role("tailor"))],
)
async def remove_unused_directory_clients(
    principal: CurrentPrincipal, request: Request, session: Session
) -> DirectoryClientsRemoved:
    tailor = await tailor_of(session, principal.user)
    # One statement, so the check and the change cannot drift apart.
    result = await session.execute(
        update(Client)
        .where(*own_directory_clients(tailor.tailor_id), *UNUSED)
        .values(deleted_at=datetime.now(UTC))
        .returning(Client.client_id)
        .execution_options(synchronize_session=False)
    )
    removed = len(result.all())
    if removed:
        audit.record(
            session,
            actor_type="user",
            action="deletion",
            entity_type="tailor",
            entity_id=tailor.tailor_id,
            user_id=principal.user.user_id,
            ip_hash=ip_hash(request),
            detail={"source": "directory", "count": removed},
        )
    await session.commit()
    return DirectoryClientsRemoved(removed=removed)


@router.delete(
    "/clients/{client_id}",
    operation_id="deleteClient",
    status_code=204,
    tags=["clients"],
    dependencies=[Depends(require_role("tailor", "admin"))],
)
async def delete_client(
    client_id: uuid.UUID, principal: CurrentPrincipal, request: Request, session: Session
) -> Response:
    client = await session.get(Client, client_id)
    if not client or client.deleted_at is not None:
        raise ApiError("not_found")
    if principal.user.role == "tailor":
        tailor = await tailor_of(session, principal.user)
        if client.tailor_id != tailor.tailor_id:
            raise ApiError("forbidden")
    active = await session.scalar(
        select(exists().where(Order.client_id == client_id, Order.status != "collected"))
    )
    if active:
        raise ApiError("client_has_orders")
    # Collected orders and study records leave only through the retention job (backend-spec 14.6).
    retained = await session.scalar(
        select(
            exists().where(Order.client_id == client_id)
            | exists().where(Participant.client_id == client_id)
        )
    )
    if retained:
        raise ApiError("client_records_retained")
    client.deleted_at = datetime.now(UTC)
    audit.record(
        session,
        actor_type="user",
        action="deletion",
        entity_type="client",
        entity_id=client_id,
        user_id=principal.user.user_id,
        client_id=client_id,
        ip_hash=ip_hash(request),
        detail={"source": client.source},
    )
    await session.commit()
    return Response(status_code=204)
