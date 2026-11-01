"""The image-content guard (backend-spec 9.2): photos must not reach the server in any form.

It reads every key and value before any schema does, so a picture is named as a picture
wherever it hides, even in a field that would have been refused anyway.
"""

import json
import re
import unicodedata
from typing import Any
from urllib.parse import unquote

MAX_STRING = 2048
MAX_BASE64_RUN = 1024
# Matches each whole run once and moves on, so the cost is linear in the text's length.
BASE64_RUN = re.compile(r"[A-Za-z0-9+/_-]+")
PERCENT_LAYERS = 3


def _visible(text: str) -> str:
    """Fullwidth forms become plain, and characters nobody can see (zero-width, BOM) go."""
    folded = unicodedata.normalize("NFKC", text)
    return "".join(c for c in folded if unicodedata.category(c) not in {"Cf", "Cc"})


def _normalised(text: str) -> str:
    if text.isascii() and "%" not in text and text.isprintable():
        return text
    plain = _visible(text)
    for _ in range(PERCENT_LAYERS):
        decoded = unquote(plain)
        if decoded == plain:
            break
        plain = _visible(decoded)
    return plain


def _looks_like_image(text: str) -> bool:
    if len(text) > MAX_STRING:
        return True
    plain = _normalised(text)
    return plain.lstrip().lower().startswith("data:") or any(
        match.end() - match.start() > MAX_BASE64_RUN for match in BASE64_RUN.finditer(plain)
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
