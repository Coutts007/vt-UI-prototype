"""Rules artifacts: the files in packages/rules, then anything registered in the database.

The registry is authoritative for status (backend-spec 10.6, 11.7): a draft is registered, the
owner freezes it through the admin API, and a frozen row never changes (a database trigger refuses).
Every artifact's checksum is checked when it is loaded, from a file or from the database, and the
server refuses to compute with one that does not match.
"""

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime
from functools import cache
from pathlib import Path
from typing import Any

import structlog
from jsonschema import Draft202012Validator, FormatChecker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import RulesVersion

RULES_DIR = Path(__file__).parents[4] / "packages/rules"
log = structlog.get_logger()


def checksum_of(artifact: Mapping[str, Any]) -> str:
    """Every field but `checksum` and `status`: the registry owns the status (10.6, M13-1)."""
    body = {key: value for key, value in artifact.items() if key not in ("checksum", "status")}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def load_rules(folder: Path = RULES_DIR) -> dict[str, dict[str, Any]]:
    """Refuses to start on an artifact whose checksum is wrong (A2)."""
    found: dict[str, dict[str, Any]] = {}
    for path in [*sorted(folder.glob("rules-*.json")), *sorted(folder.glob("frozen/*.json"))]:
        artifact = json.loads(path.read_text())
        if artifact.get("checksum") != checksum_of(artifact):
            raise ValueError(f"Rules checksum does not match: {path.name}")
        found[artifact["rules_version"]] = artifact
    return found


@cache
def _validator() -> Draft202012Validator:
    schema = json.loads((RULES_DIR / "schema.json").read_text())
    return Draft202012Validator(schema, format_checker=FormatChecker())


def schema_problems(artifact: Mapping[str, Any]) -> list[str]:
    """Where an artifact breaks packages/rules/schema.json: field paths only, never values."""
    return sorted(
        "/".join(str(part) for part in error.absolute_path) or "artifact"
        for error in _validator().iter_errors(artifact)
    )


async def lookup_rules(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, version: str
) -> dict[str, Any] | None:
    """The artifact, with the registry's status when the registry knows the version."""
    row = await session.get(RulesVersion, version)
    if version in files:
        artifact = files[version]
        if row is None:
            return artifact
        # The registry recorded what was frozen; a shipped file that no longer matches is refused.
        if artifact["checksum"] != row.checksum:
            log.error("rules_checksum_mismatch")
            return None
        return {**artifact, "status": row.status}
    if row is None:
        return None
    if not row_intact(row):
        log.error("rules_checksum_mismatch")
        return None
    return {**row.artifact, "status": row.status}


def row_intact(row: RulesVersion) -> bool:
    """The registry row's artifact still produces the checksum the row recorded."""
    return bool(
        row.checksum == checksum_of(row.artifact) and row.artifact.get("checksum") == row.checksum
    )


async def find_rules(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, version: str
) -> dict[str, Any]:
    artifact = await lookup_rules(files, session, version)
    if artifact is None:
        raise ApiError("rules_version_unknown")
    return artifact


async def rules_status(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, version: str
) -> str | None:
    """The registry's status for a version; a file that was never registered keeps its own."""
    row = await session.get(RulesVersion, version)
    if row is not None:
        return str(row.status)
    artifact = files.get(version)
    return None if artifact is None else str(artifact["status"])


def registration_problems(artifact: Mapping[str, Any], known: set[str]) -> list[dict[str, str]]:
    """Why a draft cannot be registered: field and code only, never a value (M13)."""
    found = [{"field": path, "code": "schema"} for path in schema_problems(artifact)[:20]]
    if found:
        return found
    if artifact["status"] != "draft":
        found.append({"field": "status", "code": "must_be_draft"})
    if artifact["checksum"] != checksum_of(artifact):
        found.append({"field": "checksum", "code": "mismatch"})
    if artifact["rules_version"] in known:
        found.append({"field": "rules_version", "code": "exists"})
    parent = artifact.get("parent")
    if parent is not None and parent not in known:
        found.append({"field": "parent", "code": "unknown"})
    return found


async def known_versions(files: Mapping[str, dict[str, Any]], session: AsyncSession) -> set[str]:
    rows = await session.scalars(select(RulesVersion.rules_version))
    return set(files) | set(rows)


def freeze_row(row: RulesVersion, moment: datetime) -> None:
    """The registry's one-way step. The artifact's status follows, with the checksum unchanged."""
    row.artifact = {**row.artifact, "status": "frozen"}
    row.status = "frozen"
    row.frozen_at = moment


def summary(
    version: str, status: str, checksum: str, parent: str | None,
    frozen_at: datetime | None, created_at: datetime | str, current: str,
) -> dict[str, Any]:  # fmt: skip
    return {
        "rules_version": version,
        "status": status,
        "checksum": checksum,
        "parent": parent,
        "frozen_at": frozen_at,
        "created_at": created_at,
        "is_current": version == current,
    }


async def all_rules(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, current: str
) -> list[dict[str, Any]]:
    rows = {row.rules_version: row for row in await session.scalars(select(RulesVersion))}
    out = []
    for version, artifact in files.items():
        if version not in rows:
            out.append(
                summary(
                    version,
                    artifact["status"],
                    artifact["checksum"],
                    artifact["parent"],
                    None,
                    artifact["created_at"],
                    current,
                )  # fmt: skip
            )
    for row in rows.values():
        out.append(summary(row.rules_version, row.status, row.checksum, row.parent, row.frozen_at,
                           row.created_at, current))  # fmt: skip
    return sorted(out, key=lambda item: item["rules_version"])
