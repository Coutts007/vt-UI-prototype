"""The image-content guard (backend-spec 9.2): photos must not reach the server in any form.

It reads every key and value before any schema does, so a picture is named as a picture
wherever it hides, even in a field that would have been refused anyway.
"""

import json
import re
from typing import Any

MAX_STRING = 2048
BASE64_RUN = re.compile(r"[A-Za-z0-9+/_-]{1025,}")


def _looks_like_image(text: str) -> bool:
    return (
        len(text) > MAX_STRING
        or text.lstrip().lower().startswith("data:")
        or BASE64_RUN.search(text) is not None
    )


def _scan(value: Any) -> bool:
    # A stack, so a deeply nested body cannot exhaust the interpreter here.
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if _looks_like_image(item):
                return True
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
    return False


def has_image_content(body: bytes) -> bool:
    try:
        parsed = json.loads(body)
    except (ValueError, RecursionError):
        return False  # Not JSON: the schema step refuses it with the right error.
    return _scan(parsed)
