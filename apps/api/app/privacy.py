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
# Enough for any honest text.
ENCODED_LAYERS = 8
# Normalising runs before any rate limit, and one character can expand eighteenfold on every layer.
# Each body may have this many characters normalised; honest text with accents or a % is far below
# it. Past it the body is refused, so the worst case stays near 30 ms.
MAX_NORMALISED = 64_000
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


class _Budget:
    def __init__(self) -> None:
        self.left = MAX_NORMALISED

    def spend(self, text: str) -> bool:
        self.left -= len(text)
        return self.left >= 0


def _normalised(text: str, budget: _Budget) -> str | None:
    """The text as a reader sees it, or None once the body has used up its budget."""
    if text.isascii() and "%" not in text and "&" not in text and text.isprintable():
        return text
    if not budget.spend(text):
        return None
    plain = _visible(text)
    for _ in range(ENCODED_LAYERS):
        if not budget.spend(plain):
            return None
        decoded = html.unescape(unquote(plain))
        if decoded == plain:
            break
        plain = _visible(decoded)
    return plain


def _looks_like_image(text: str, budget: _Budget) -> bool:
    if len(text) > MAX_STRING:
        return True
    plain = _normalised(text, budget)
    if plain is None:
        return True
    return plain.lstrip().lower().startswith("data:") or any(
        match.end() - match.start() > MAX_BASE64_RUN for match in BASE64_RUN.finditer(plain)
    )


def _scan(value: Any) -> bool:
    # A stack, so a deeply nested body cannot exhaust the interpreter here.
    stack = [value]
    budget = _Budget()
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if _looks_like_image(item, budget):
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
