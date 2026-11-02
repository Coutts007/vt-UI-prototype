"""Signed sheet links (backend-spec 8, 13): HMAC-SHA256 over the file name and expiry."""

import hashlib
import hmac
import time

TTL_SECONDS = 600


def _signature(secret: str, file_name: str, expires: int) -> str:
    message = f"{file_name}\n{expires}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign(secret: str, file_name: str, now: float | None = None) -> tuple[int, str]:
    expires = int(now if now is not None else time.time()) + TTL_SECONDS
    return expires, _signature(secret, file_name, expires)


def valid(
    secret: str, file_name: str, expires: int, signature: str, now: float | None = None
) -> bool:
    """False for a tampered link, an expired one or one dated too far ahead."""
    current = now if now is not None else time.time()
    if not current <= expires <= current + TTL_SECONDS:
        return False
    return hmac.compare_digest(_signature(secret, file_name, expires), signature)
