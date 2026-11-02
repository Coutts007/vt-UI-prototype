"""Seeded cohort allocation, balanced by sex (backend-spec 11.1).

Each sex has its own sequence of blocks of eight: one pilot, two calibration and five test
places in an order drawn from the seed. About 100 people then give roughly 12 pilot,
25 calibration and 63 test, the proportions the study plans for. The same seed and the
same enrolment order always give the same cohorts.
"""

import hashlib
import random

BLOCK = ("pilot", "calibration", "calibration", "test", "test", "test", "test", "test")


def _block(seed: int, sex: str, number: int) -> list[str]:
    key = hashlib.sha256(f"{seed}:{sex}:{number}".encode()).digest()
    order = list(BLOCK)
    random.Random(int.from_bytes(key[:8], "big")).shuffle(order)
    return order


def cohort_for(seed: int, sex: str, index: int) -> str:
    """The cohort of the `index`-th person (from 0) of this sex to enrol."""
    number, place = divmod(index, len(BLOCK))
    return _block(seed, sex, number)[place]
