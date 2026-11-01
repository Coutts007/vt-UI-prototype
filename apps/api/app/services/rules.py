"""Rules artifacts: the files in packages/rules, then anything registered in the database."""

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import RulesVersion

RULES_DIR = Path(__file__).parents[4] / "packages/rules"


def checksum_of(artifact: Mapping[str, Any]) -> str:
    body = {key: value for key, value in artifact.items() if key != "checksum"}
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


async def lookup_rules(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, version: str
) -> dict[str, Any] | None:
    if version in files:
        return files[version]
    row = await session.get(RulesVersion, version)
    return row.artifact if row else None


async def find_rules(
    files: Mapping[str, dict[str, Any]], session: AsyncSession, version: str
) -> dict[str, Any]:
    artifact = await lookup_rules(files, session, version)
    if artifact is None:
        raise ApiError("rules_version_unknown")
    return artifact
