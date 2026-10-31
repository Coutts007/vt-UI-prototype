import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.errors import ApiError


def create_token(
    user_id: uuid.UUID, role: str, version: int, secret: str, hours: int
) -> tuple[str, datetime]:
    issued = datetime.now(UTC)
    expires = issued + timedelta(hours=hours)
    claims = {
        "sub": str(user_id),
        "role": role,
        "tv": version,
        "jti": str(uuid.uuid4()),
        "iat": issued,
        "exp": expires,
    }
    return jwt.encode(claims, secret, algorithm="HS256"), expires


def read_token(token: str, secret: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "role", "tv", "jti", "exp", "iat"]},
        )
    except jwt.ExpiredSignatureError as error:
        raise ApiError("token_expired") from error
    except jwt.InvalidTokenError as error:
        raise ApiError("unauthorized") from error
