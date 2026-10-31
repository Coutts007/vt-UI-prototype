"""RFC 9457 problem responses, driven by packages/contracts/error-codes.json."""

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

CODES: dict[str, dict[str, Any]] = json.loads(
    (Path(__file__).parents[3] / "packages/contracts/error-codes.json").read_text()
)
STATUS_CODES = {400: "validation_failed", 401: "unauthorized", 403: "forbidden", 404: "not_found"}
STATUS_CODES |= {405: "not_found", 413: "payload_too_large", 415: "unsupported_media_type"}


def problem_body(code: str, detail: str | None = None) -> dict[str, Any]:
    entry = CODES[code]
    body: dict[str, Any] = {
        "type": f"https://vt.invalid/problems/{code}",
        "title": entry["title"],
        "status": entry["status"],
        "code": code,
    }
    if detail:
        body["detail"] = detail
    return body


def problem_response(
    code: str, headers: dict[str, str] | None = None, **extra: Any
) -> JSONResponse:
    return JSONResponse(
        {**problem_body(code), **extra},
        status_code=CODES[code]["status"],
        media_type="application/problem+json",
        headers=headers,
    )


class ApiError(Exception):
    def __init__(self, code: str, headers: dict[str, str] | None = None, **extra: Any) -> None:
        super().__init__(code)
        self.code = code
        self.headers = headers
        self.extra = extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, error: ApiError) -> JSONResponse:
        return problem_response(error.code, error.headers, **error.extra)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, error: RequestValidationError) -> JSONResponse:
        # Field names and error types only: the rejected values never come back or reach a log.
        errors = [
            {
                "field": ".".join(str(part) for part in item["loc"][1:])[:256] or "body",
                "code": str(item["type"])[:64],
            }
            for item in error.errors()
        ]
        return problem_response("validation_failed", errors=errors)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return problem_response(STATUS_CODES.get(error.status_code, "server_error"))

    @app.exception_handler(Exception)
    async def unexpected(_: Request, error: Exception) -> JSONResponse:
        return problem_response("server_error")
