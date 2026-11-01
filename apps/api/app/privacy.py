"""The image-content guard (backend-spec 9.2): photos must not reach the server in any form.

It reads every key and value before any schema does, so a picture is named as a picture
wherever it hides, even in a field that would have been refused anyway.
"""

import html
import json
import re
import unicodedata
from typing import Any
from urllib.parse import unquote

MAX_STRING = 2048
MAX_BASE64_RUN = 1024
# Matches each whole run once and moves on, so the cost is linear in the text's length.
BASE64_RUN = re.compile(r"[A-Za-z0-9+/_-]+")
# Enough for any honest text. A string is at most 2048 characters, so this stays cheap.
ENCODED_LAYERS = 8
HIDDEN_CATEGORIES = {"Cf", "Cc", "Cs", "Co", "Cn", "Mn", "Me", "Mc"}
# Letters and symbols by category, yet blank on screen: Hangul fillers, Braille blank, Khmer vowels.
BLANK_MARKS = frozenset("\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0")


def _visible(text: str) -> str:
    """Compatibility forms become plain, accents come off, and what nobody can see goes."""
    folded = unicodedata.normalize("NFKD", text)
    return "".join(
        c
        for c in folded
        if unicodedata.category(c) not in HIDDEN_CATEGORIES and c not in BLANK_MARKS
    )


def _normalised(text: str) -> str:
    if text.isascii() and "%" not in text and "&" not in text and text.isprintable():
        return text
    plain = _visible(text)
    for _ in range(ENCODED_LAYERS):
        decoded = html.unescape(unquote(plain))
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
