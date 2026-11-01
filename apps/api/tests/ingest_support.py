"""A valid profile payload, built from the seed so it stays in step with the contract."""

import copy
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SEED = json.loads((Path(__file__).parents[3] / "packages/seed/seed.json").read_text())
FREE_CODE = "AB1008"
ROUTE = "/api/v1/profiles"
SECRET = "ab" * 32
OTHER_SECRET = "cd" * 32
_TEMPLATE = next(p for p in SEED["profiles"] if p["status"] == "final" and p["version"] == 1)


def payload(code: str = FREE_CODE, version: int = 1, **changes: Any) -> dict[str, Any]:
    body = copy.deepcopy(_TEMPLATE)
    for key in ("client_id", "received_at", "server_checks"):
        del body[key]
    now = datetime.now(UTC).isoformat()
    body["profile_id"] = str(uuid.uuid4())
    body["session"]["session_id"] = str(uuid.uuid4())
    body["session"].pop("study", None)
    body["session"]["started_at"] = now
    body["client_code"] = code
    body["version"] = version
    body["captured_at"] = now
    body["consent"].pop("withdrawn_at", None)
    body["consent"]["given_at"] = now
    return {**body, **changes}


def proof(secret: str = SECRET) -> dict[str, str]:
    return {"X-Client-Secret": secret}


def key(body: dict[str, Any], secret: str = SECRET) -> dict[str, str]:
    return {"Idempotency-Key": str(body["profile_id"]), **proof(secret)}
