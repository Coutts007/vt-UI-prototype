"""Load test for backend-spec 16.4. Run through `make load` (scripts/load.sh), never on a real site.

Users:
- ClientUploader: `POST /profiles`, one fresh synthetic profile per empty load code (LD2000 on),
  each a copy of a seed profile with new ids.
- TailorReader: the load tailor's lists (5,000 clients, 20,000 profiles) and profile pages.
- SheetMaker: sheet generation on the demo tailor's orders.
Shape and rates come from the LOAD_SCENARIO environment variable (see scripts/load.sh).
"""

import copy
import itertools
import json
import os
import random
import secrets
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from locust import HttpUser, between, constant_throughput, task

ROOT = Path(__file__).resolve().parents[2]
SEED = json.loads((ROOT / "packages/seed/seed.json").read_text())
TEMPLATE = next(p for p in SEED["profiles"] if p["status"] == "final" and p["version"] == 1)
PASSWORD = SEED["demo_password"]
SCENARIO = os.environ.get("LOAD_SCENARIO", "mixed")
FIRST_EMPTY = int(os.environ.get("LOAD_FIRST_EMPTY", "2000"))
LAST_CODE = int(os.environ.get("LOAD_LAST_CODE", "4999"))
_codes = itertools.count(FIRST_EMPTY)
_lock = threading.Lock()


def next_code() -> str | None:
    with _lock:
        n = next(_codes)
    return f"LD{n:04d}" if n <= LAST_CODE else None


def profile_body(code: str) -> dict[str, Any]:
    body = copy.deepcopy(TEMPLATE)
    for key in ("client_id", "received_at", "server_checks"):
        body.pop(key, None)
    now = datetime.now(UTC).isoformat()
    body["profile_id"] = str(uuid.uuid4())
    body["session"]["session_id"] = str(uuid.uuid4())
    body["session"].pop("study", None)
    body["session"]["started_at"] = now
    body["client_code"] = code
    body["version"] = 1
    body["captured_at"] = now
    body["consent"].pop("withdrawn_at", None)
    body["consent"]["given_at"] = now
    return body


def sign_in(user: HttpUser, email: str) -> dict[str, str]:
    reply = user.client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}, name="sign-in"
    )
    reply.raise_for_status()
    return {"Authorization": f"Bearer {reply.json()['access_token']}"}


class ClientUploader(HttpUser):
    """20 requests a second in total when 20 of these run (one each second)."""

    weight = 0 if SCENARIO == "lists" else 1
    wait_time = constant_throughput(1)

    @task
    def upload(self) -> None:
        code = next_code()
        if code is None:
            self.environment.runner.quit()
            return
        body = profile_body(code)
        self.client.post(
            "/api/v1/profiles",
            json=body,
            headers={
                "Idempotency-Key": body["profile_id"],
                "X-Client-Secret": secrets.token_hex(32),
            },
            name="POST /profiles",
        )


class TailorReader(HttpUser):
    weight = 0 if SCENARIO == "ingest" else 3
    wait_time = between(0.5, 1.5)

    def on_start(self) -> None:
        self.auth = sign_in(self, "load@vt.test")
        page = self.client.get(
            "/api/v1/clients", params={"page_size": 100}, headers=self.auth, name="GET /clients"
        ).json()
        self.client_ids = [row["client_id"] for row in page["items"]] or [None]

    @task(4)
    def client_list(self) -> None:
        self.client.get(
            "/api/v1/clients",
            params={"page": random.randint(1, 200), "page_size": 25},
            headers=self.auth,
            name="GET /clients",
        )

    @task(2)
    def client_search(self) -> None:
        self.client.get(
            "/api/v1/clients",
            params={"search": f"Load {random.randint(0, 4999):04d}"},
            headers=self.auth,
            name="GET /clients?search",
        )

    @task(2)
    def client_profiles(self) -> None:
        client_id = random.choice(self.client_ids)
        if client_id:
            self.client.get(
                f"/api/v1/clients/{client_id}/profiles",
                headers=self.auth,
                name="GET /clients/{id}/profiles",
            )

    @task(1)
    def orders(self) -> None:
        self.client.get("/api/v1/orders", headers=self.auth, name="GET /orders")


class SheetMaker(HttpUser):
    weight = 1 if SCENARIO in ("mixed", "sheets") else 0
    wait_time = between(2, 4)

    def on_start(self) -> None:
        self.auth = sign_in(self, "wanjiru@vt.test")
        orders = self.client.get("/api/v1/orders", headers=self.auth, name="GET /orders").json()
        self.orders = [row["order_id"] for row in orders["items"]]

    @task
    def sheet(self) -> None:
        if self.orders:
            self.client.post(
                f"/api/v1/orders/{random.choice(self.orders)}/sheets",
                json={"include_name": False},
                headers=self.auth,
                name="POST /orders/{id}/sheets",
            )
