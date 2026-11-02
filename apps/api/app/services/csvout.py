"""CSV files for the admin. A cell that a spreadsheet would run as a formula is quoted first."""

import csv
import io
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import Response

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if isinstance(value, str) and text.startswith(FORMULA_START):
        return "'" + text
    return text


def to_csv(header: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([_cell(value) for value in row])
    return out.getvalue()


def csv_response(body: str, name: str) -> Response:
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )
