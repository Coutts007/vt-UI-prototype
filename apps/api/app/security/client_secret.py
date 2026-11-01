"""The phone's secret for a client code (D45): the proof of possession for a client's data."""

import hashlib
import hmac
import re

SECRET = re.compile(r"[0-9a-f]{64}")
# Compared against when there is nothing to compare, so a refusal costs the same either way.
NO_HASH = "0" * 64


def hash_secret(secret: str) -> str:
    # 256 random bits need no slow hash: there is nothing to guess.
    return hashlib.sha256(secret.encode()).hexdigest()


def well_formed(secret: str | None) -> bool:
    return secret is not None and SECRET.fullmatch(secret) is not None


def matches(secret: str | None, stored: str | None) -> bool:
    candidate = hash_secret(secret) if secret is not None and well_formed(secret) else "x" * 64
    same = hmac.compare_digest(candidate, stored or NO_HASH)
    return same and stored is not None
