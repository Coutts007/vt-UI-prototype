from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher(memory_cost=65536, time_cost=3, parallelism=1)
# Checked when an email is unknown, so timing does not reveal which accounts exist.
_DUMMY_HASH = _hasher.hash("vt-no-such-account")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    try:
        ok = _hasher.verify(stored or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return ok and stored is not None


def burn_time(password: str) -> None:
    verify_password(None, password)
