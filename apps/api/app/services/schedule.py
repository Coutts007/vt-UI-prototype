"""When the nightly job next runs: 02:00 in Nairobi (backend-spec 14.6). Nairobi has no DST."""

from datetime import datetime, timedelta, timezone

NAIROBI = timezone(timedelta(hours=3), "Africa/Nairobi")
RUN_AT_HOUR = 2


def seconds_until_next(now: datetime) -> float:
    local = now.astimezone(NAIROBI)
    target = local.replace(hour=RUN_AT_HOUR, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return (target - local).total_seconds()
