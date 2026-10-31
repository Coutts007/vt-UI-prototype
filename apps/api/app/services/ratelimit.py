"""Fixed-window limiter in memory, for the single API instance (backend-spec 5, 14.2)."""

import math
import time
from collections.abc import Awaitable, Callable

from fastapi import Request

from app.errors import ApiError
from app.security.ip_hash import ip_hash


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.windows: dict[tuple[str, str], tuple[float, int]] = {}

    def hit(self, bucket: str, key: str, limit: int, seconds: int) -> None:
        now = self.clock()
        if len(self.windows) > 100_000:
            self.windows = {k: v for k, v in self.windows.items() if v[0] > now}
        ends, count = self.windows.get((bucket, key), (now + seconds, 0))
        if ends <= now:
            ends, count = now + seconds, 0
        if count >= limit:
            wait = str(math.ceil(ends - now))
            raise ApiError("rate_limited", headers={"Retry-After": wait})
        self.windows[(bucket, key)] = (ends, count + 1)


def limit_by_ip(bucket: str, limit: int, seconds: int) -> Callable[[Request], Awaitable[None]]:
    async def check(request: Request) -> None:
        request.app.state.limiter.hit(bucket, ip_hash(request), limit, seconds)

    return check
