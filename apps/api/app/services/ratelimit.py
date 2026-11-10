"""Fixed-window limiter with its counts in PostgreSQL (backend-spec 5, 14.2; M16).

Until M16 the counts lived in the process, so a second API worker allowed its own sign-in
attempts (M12-13). One row per bucket and key now holds the window, and every worker reads
and bumps it in one statement, outside the request's own transaction: a refused sign-in
still counts even though the request that carried it fails.
"""

import math
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.errors import ApiError
from app.models import RateLimitWindow
from app.security.ip_hash import ip_hash, network_hash

# A window that has ended starts again at one; an open one bumps its count, capped just over
# the limit so a flood cannot grow the integer. `now()` is the statement's clock on the server,
# so every worker agrees on when a window ends.
HIT = text(
    "INSERT INTO rate_limit_window (bucket, bucket_key, ends_at, count) "
    "VALUES (:bucket, :key, now() + make_interval(secs => :seconds), 1) "
    "ON CONFLICT (bucket, bucket_key) DO UPDATE SET "
    "count = CASE WHEN rate_limit_window.ends_at <= now() THEN 1 "
    "ELSE LEAST(rate_limit_window.count + 1, :cap) END, "
    "ends_at = CASE WHEN rate_limit_window.ends_at <= now() "
    "THEN now() + make_interval(secs => :seconds) ELSE rate_limit_window.ends_at END "
    "RETURNING count, ends_at, now()"
)


class RateLimiter:
    def __init__(
        self, sessions: async_sessionmaker[AsyncSession] | None, off: bool = False
    ) -> None:
        self.sessions = sessions
        self.off = off

    async def hit(self, bucket: str, key: str, limit: int, seconds: int) -> None:
        if self.off or self.sessions is None:
            return
        async with self.sessions() as session:
            row = (
                await session.execute(
                    HIT,
                    {"bucket": bucket, "key": key, "seconds": seconds, "cap": limit + 1},
                )
            ).one()
            await session.commit()
        count, ends, now = row
        if count > limit:
            wait = str(max(1, math.ceil((ends - now).total_seconds())))
            raise ApiError("rate_limited", headers={"Retry-After": wait})

    async def reset(self, bucket: str, key: str | None = None) -> None:
        """Forgets a bucket, or one key in it. Tests use it; the API never does."""
        if self.sessions is None:
            return
        statement = delete(RateLimitWindow).where(RateLimitWindow.bucket == bucket)
        if key is not None:
            statement = statement.where(RateLimitWindow.bucket_key == key)
        async with self.sessions() as session:
            await session.execute(statement)
            await session.commit()


async def purge_ended(session: AsyncSession, now: datetime | None = None) -> int:
    """Removes windows that have ended. The nightly job runs it as vt_retention."""
    moment = now or datetime.now(UTC)
    result = await session.execute(
        delete(RateLimitWindow)
        .where(RateLimitWindow.ends_at <= moment)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0  # type: ignore[attr-defined]


def limit_by_ip(bucket: str, limit: int, seconds: int) -> Callable[[Request], Awaitable[None]]:
    async def check(request: Request) -> None:
        await request.app.state.limiter.hit(bucket, ip_hash(request), limit, seconds)

    return check


def limit_by_network(bucket: str, limit: int, seconds: int) -> Callable[[Request], Awaitable[None]]:
    """Like limit_by_ip, with one bucket for each IPv6 /64."""

    async def check(request: Request) -> None:
        await request.app.state.limiter.hit(bucket, network_hash(request), limit, seconds)

    return check
