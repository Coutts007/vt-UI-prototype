"""Compute or write the checksum of a rules artifact: python checksum.py <file> [--write]."""

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def rules_checksum(artifact: dict[str, Any]) -> str:
    body = {k: v for k, v in artifact.items() if k != "checksum"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


if __name__ == "__main__":
    path = Path(sys.argv[1])
    artifact = json.loads(path.read_text())
    checksum = rules_checksum(artifact)
    if "--write" in sys.argv:
        artifact["checksum"] = checksum
        path.write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + "\n")
    print(checksum)
