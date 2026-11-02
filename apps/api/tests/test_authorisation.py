"""The role matrix. It reads the contract, so each endpoint added later is covered automatically."""

import re
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml
from app.config import Settings
from app.errors import ApiError
from app.main import create_app
from app.models import Client, UserAccount
from app.security.deps import CurrentPrincipal, Session, owned_client, require_role
from fastapi import Depends, FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import DEMO_PASSWORD, bearer, sign_in

CONTRACT = yaml.safe_load(
    (Path(__file__).parents[3] / "packages/contracts/openapi.yaml").read_text()
)
ACCOUNTS = {"tailor": "wanjiru@vt.test", "admin": "admin@vt.test", "measurer": "measurer-a@vt.test"}
PREFIX = "/api/v1"


def implemented() -> list[tuple[str, str, dict[str, Any] | None, dict[str, Any]]]:
    app = create_app(Settings(_env_file=None))  # type: ignore[call-arg]
    found = []
    for prefixed, item in app.openapi()["paths"].items():
        path = prefixed.removeprefix(PREFIX)
        for method, generated in item.items():
            found.append((method, path, CONTRACT["paths"].get(path, {}).get(method), generated))
    return found


OPERATIONS = implemented()
SECURED = [(m, p, op) for m, p, op, _ in OPERATIONS if op and op.get("security")]
IDS = [f"{m} {p}" for m, p, _ in SECURED]


def fill(path: str) -> str:
    return PREFIX + re.sub(r"\{\w+\}", "00000000-0000-5000-8000-000000000001", path)


def test_the_matrix_sees_the_endpoints() -> None:
    """Guards the harness itself: an empty list would make every check below pass."""
    assert len(OPERATIONS) >= 9
    assert len(SECURED) >= 4


def test_every_route_is_in_the_contract() -> None:
    assert [f"{m} {p}" for m, p, op, _ in OPERATIONS if op is None] == []


@pytest.mark.parametrize(("method", "path", "operation"), SECURED, ids=IDS)
async def test_signed_out_callers_are_refused(
    client: AsyncClient, method: str, path: str, operation: dict[str, Any]
) -> None:
    response = await client.request(method, fill(path))
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.parametrize(("method", "path", "operation"), SECURED, ids=IDS)
async def test_roles_outside_the_contract_are_refused(
    client: AsyncClient, method: str, path: str, operation: dict[str, Any]
) -> None:
    for role, email in ACCOUNTS.items():
        if role in operation["x-roles"]:
            continue
        token = await sign_in(client, email)
        response = await client.request(method, fill(path), headers=bearer(token), json={})
        assert response.status_code == 403, role


def test_operation_ids_and_response_codes_match_the_contract() -> None:
    for _, _, operation, generated in OPERATIONS:
        assert operation
        assert generated["operationId"] == operation["operationId"]
        success = [code for code in generated["responses"] if code.startswith("2")]
        assert success and all(code in operation["responses"] for code in success)


SCHEMA_PAIRS = {
    "register": ("RegisterInput", "RegisterResult"),
    "login": ("LoginInput", "LoginResult"),
    "getMe": (None, "User"),
    "updateMe": ("UserUpdate", "User"),
    "changePassword": ("PasswordChange", None),
    "getPublicSettings": (None, "PublicSettings"),
    "getHealth": (None, "Status"),
    "verifyClientCode": (None, "ClientCodeCheck"),
    "listTailors": (None, "TailorListingPage"),
    "issueDirectoryCode": (None, "DirectoryCodeIssued"),
    "listDirectoryClients": (None, "DirectoryClientPage"),
    "removeUnusedDirectoryClients": (None, "DirectoryClientsRemoved"),
    "getCurrentRules": (None, "RulesArtifact"),
    "syncProfile": ("MeasurementProfilePayload", "ProfileAccepted"),
    "requestDeletion": ("DeletionRequestInput", "DeletionRequestReceipt"),
    "requestDataAccess": ("AccessRequestInput", "ClientDataExport"),
    "listClients": (None, "ClientPage"),
    "createClient": ("ClientInput", "ClientCreated"),
    "getClient": (None, "ClientDetail"),
    "rotateClientCode": (None, "ClientCodeRotated"),
    "summaries": ("ClientSummary", "ProfileSummary"),
    "getClientClaim": (None, "ClientClaim"),
    "reviewClientClaim": ("ClaimReviewInput", "ClientClaim"),
    "claimRows": ("ClaimProfile", "ClaimWithdrawal"),
    "claimRequests": ("ClaimDeletionRequest", None),
    "listConflicts": ("ConflictSide", "Conflict"),
    "resolveConflict": ("ConflictResolution", "Conflict"),
    "listOrders": (None, "OrderPage"),
    "createOrder": ("OrderInput", "Order"),
    "updateOrder": ("OrderUpdate", "Order"),
    "orderRows": ("OrderItemInput", "OrderItem"),
    "orderSummary": ("OrderSummary", None),
    "ease": ("EasePreset", "EaseSuggestion"),
    "listAudit": (None, "AuditPage"),
    "auditRows": ("AuditEntry", None),
    "flags": ("FlagCounts", None),
    "landmark": ("Landmark", "MarkerObs"),
    "silhouettes": ("SilhouetteFront", "SilhouetteSide"),
    "session": ("CaptureSession", "StudyBlock"),
    "rows": ("Measurement", "ServerCheck"),
    "records": ("ConsentRecord", "Covariates"),
}


@pytest.mark.parametrize(("operation_id", "names"), SCHEMA_PAIRS.items())
def test_field_names_match_the_contract(
    app: FastAPI, operation_id: str, names: tuple[str | None, str | None]
) -> None:
    generated = app.openapi()["components"]["schemas"]
    for name in names:
        if name:
            declared = CONTRACT["components"]["schemas"][name]["properties"].keys()
            assert set(generated[name]["properties"]) == set(declared), name


def _contract_operations() -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (path, method): operation
        for path, item in CONTRACT["paths"].items()
        for method, operation in item.items()
        if method in {"get", "post", "put", "patch", "delete"}
    }


def _parameters(operation: dict[str, Any]) -> dict[str, Any]:
    named = {}
    for parameter in operation.get("parameters", []):
        if "$ref" in parameter:
            parameter = CONTRACT["components"]["parameters"][parameter["$ref"].rsplit("/", 1)[1]]
        named[parameter["name"]] = parameter
    return named


def _max_length(schema: dict[str, Any]) -> int | None:
    found = [schema.get("maxLength")] + [o.get("maxLength") for o in schema.get("anyOf", [])]
    return next((length for length in found if length is not None), None)


def test_generated_paths_responses_and_headers_match_the_contract(app: FastAPI) -> None:
    generated = {
        (path.removeprefix("/api/v1"), method): operation
        for path, item in app.openapi()["paths"].items()
        for method, operation in item.items()
    }
    contract = _contract_operations()
    # The contract is written first, so it may hold routes that later milestones build.
    assert set(generated) <= set(contract), set(generated) - set(contract)
    for place, operation in generated.items():
        declared = contract[place]
        assert operation["operationId"] == declared["operationId"], place
        assert set(operation["responses"]) - {"422"} <= set(declared["responses"]), place
        ours, theirs = _parameters(operation), _parameters(declared)
        for name in ours.keys() & theirs.keys():
            if ours[name]["in"] != "header":
                continue
            assert _max_length(ours[name]["schema"]) == _max_length(theirs[name]["schema"]), name


async def test_a_tailor_reaches_only_their_own_clients(session: AsyncSession) -> None:
    wanjiru = await session.scalar(
        select(UserAccount).where(UserAccount.email == ACCOUNTS["tailor"])
    )
    otieno = await session.scalar(select(UserAccount).where(UserAccount.email == "otieno@vt.test"))
    assert wanjiru and otieno
    theirs = await session.scalar(select(Client).where(Client.tailor_id == otieno.user_id).limit(1))
    mine = await session.scalar(select(Client).where(Client.tailor_id == wanjiru.user_id).limit(1))
    assert theirs and mine
    assert (await owned_client(session, wanjiru, mine.client_id)).client_id == mine.client_id
    with pytest.raises(ApiError) as refused:
        await owned_client(session, wanjiru, theirs.client_id)
    assert refused.value.code == "forbidden"


def fits_contract(schema: str, value: Any) -> None:
    document = {"$ref": f"#/components/schemas/{schema}", "components": CONTRACT["components"]}
    jsonschema.Draft202012Validator(document).validate(value)


@pytest.mark.parametrize("email", ACCOUNTS.values())
async def test_real_replies_fit_the_contract(client: AsyncClient, email: str) -> None:
    reply = await client.post(
        f"{PREFIX}/auth/login", json={"email": email, "password": DEMO_PASSWORD}
    )
    fits_contract("LoginResult", reply.json())
    me = await client.get(f"{PREFIX}/me", headers=bearer(reply.json()["access_token"]))
    fits_contract("User", me.json())


@pytest.fixture
def guarded(app: FastAPI) -> FastAPI:
    """Probe routes, because no contract endpoint has a partial role list until M8."""

    @app.get("/probe/admin", dependencies=[Depends(require_role("admin"))])
    async def admin_only() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/probe/clients/{client_id}")
    async def one_client(
        client_id: uuid.UUID, principal: CurrentPrincipal, session: Session
    ) -> dict[str, bool]:
        await owned_client(session, principal.user, client_id)
        return {"ok": True}

    return app


@pytest.mark.parametrize(("role", "status"), [("admin", 200), ("tailor", 403), ("measurer", 403)])
async def test_require_role_refuses_other_roles(
    guarded: FastAPI, client: AsyncClient, role: str, status: int
) -> None:
    token = await sign_in(client, ACCOUNTS[role])
    response = await client.get("/probe/admin", headers=bearer(token))
    assert response.status_code == status


async def test_ownership_through_a_route(
    guarded: FastAPI, client: AsyncClient, session: AsyncSession
) -> None:
    otieno = await session.scalar(select(UserAccount).where(UserAccount.email == "otieno@vt.test"))
    wanjiru = await session.scalar(
        select(UserAccount).where(UserAccount.email == ACCOUNTS["tailor"])
    )
    assert otieno and wanjiru
    theirs = await session.scalar(select(Client).where(Client.tailor_id == otieno.user_id).limit(1))
    mine = await session.scalar(select(Client).where(Client.tailor_id == wanjiru.user_id).limit(1))
    assert theirs and mine
    token = await sign_in(client, ACCOUNTS["tailor"])
    expected = {mine.client_id: 200, theirs.client_id: 403, uuid.uuid4(): 404}
    for client_id, status in expected.items():
        response = await client.get(f"/probe/clients/{client_id}", headers=bearer(token))
        assert response.status_code == status
    admin = await sign_in(client, ACCOUNTS["admin"])
    response = await client.get(f"/probe/clients/{mine.client_id}", headers=bearer(admin))
    assert response.status_code == 403
