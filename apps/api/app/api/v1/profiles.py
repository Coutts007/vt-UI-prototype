"""Public, proof-of-possession endpoints for a client's own data (backend-spec 8)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse

from app.schemas import (
    AccessRequestInput,
    ClientDataExport,
    DeletionRequestInput,
    DeletionRequestReceipt,
    MeasurementProfilePayload,
    ProfileAccepted,
)
from app.security.deps import Session
from app.services.data_requests import request_access, request_deletion
from app.services.ingest import HOUR, ingest, invalid
from app.services.ratelimit import limit_by_network

router = APIRouter(tags=["profiles"])


@router.post(
    "/profiles",
    operation_id="syncProfile",
    status_code=201,
    response_model=ProfileAccepted,
    dependencies=[Depends(limit_by_network("profile-network", 30, HOUR))],
)
async def sync_profile(
    body: MeasurementProfilePayload,
    request: Request,
    session: Session,
    idempotency_key: Annotated[uuid.UUID, Header()],
) -> JSONResponse:
    if idempotency_key != body.profile_id:
        raise invalid("Idempotency-Key", "idempotency_key_mismatch")
    return await ingest(request, session, await request.json(), body)


@router.post(
    "/deletion-requests",
    operation_id="requestDeletion",
    status_code=202,
    response_model=DeletionRequestReceipt,
    dependencies=[Depends(limit_by_network("deletion-request", 5, HOUR))],
)
async def deletion_request(
    body: DeletionRequestInput, request: Request, session: Session
) -> DeletionRequestReceipt:
    return DeletionRequestReceipt(**await request_deletion(request, session, body))


@router.post(
    "/data-requests/access",
    operation_id="requestDataAccess",
    response_model=ClientDataExport,
    dependencies=[Depends(limit_by_network("access-request", 5, HOUR))],
)
async def data_access(body: AccessRequestInput, request: Request, session: Session) -> JSONResponse:
    # Sent as built: the contract leaves optional fields out, and a model would fill them with null.
    export = await request_access(request, session, body.client_code, body.profile_ids)
    return JSONResponse(export)
