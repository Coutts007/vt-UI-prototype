"""Correlation id, body limit, JSON only, security headers and safe request logs."""

import json
import time
import uuid

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import problem_body

MAX_BODY = 256 * 1024
log = structlog.get_logger()
HEADERS = {
    b"content-security-policy": b"default-src 'none'; frame-ancestors 'none'",
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"no-referrer",
    b"cache-control": b"no-store",
}


class ApiMiddleware:
    def __init__(self, app: ASGIApp, docs_prefix: str | None = None) -> None:
        self.app = app
        self.docs_prefix = docs_prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        correlation = str(uuid.uuid4())
        status = {"code": 500}
        started_response = {"sent": False}
        path: str = scope["path"]
        is_docs = bool(self.docs_prefix) and path.startswith(self.docs_prefix or "")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                started_response["sent"] = True
                status["code"] = message["status"]
                headers = dict(message.get("headers", []))
                for name, value in HEADERS.items():
                    if not (is_docs and name == b"content-security-policy"):
                        headers[name] = value
                headers[b"x-correlation-id"] = correlation.encode()
                message["headers"] = list(headers.items())
            await send(message)

        async def refuse(code: str, http_status: int) -> None:
            body = json.dumps(problem_body(code)).encode()
            await send_with_headers(
                {
                    "type": "http.response.start",
                    "status": http_status,
                    "headers": [(b"content-type", b"application/problem+json")],
                }
            )
            await send_with_headers({"type": "http.response.body", "body": body})

        try:
            headers = dict(scope["headers"])
            declared = headers.get(b"content-length", b"0")
            if declared.isdigit() and int(declared) > MAX_BODY:
                await refuse("payload_too_large", 413)
                return
            chunks: list[bytes] = []
            size = 0
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    break
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > MAX_BODY:
                    await refuse("payload_too_large", 413)
                    return
                chunks.append(chunk)
                if not message.get("more_body"):
                    break
            content_type = headers.get(b"content-type", b"").split(b";")[0].strip().lower()
            if size and content_type != b"application/json":
                await refuse("unsupported_media_type", 415)
                return
            body = b"".join(chunks)
            sent = False

            async def replay() -> Message:
                nonlocal sent
                if sent:
                    return {"type": "http.disconnect"}
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}

            try:
                await self.app(scope, replay, send_with_headers)
            except Exception as error:
                # The type only: messages and tracebacks can carry personal data.
                log.error(
                    "unhandled_error", error_type=type(error).__name__, correlation_id=correlation
                )
                if not started_response["sent"]:
                    await refuse("server_error", 500)
        finally:
            # The route template, never the path: paths can carry client codes.
            route = getattr(scope.get("route"), "path", "unmatched")
            log.info(
                "request",
                route=route,
                method=scope["method"],
                status=status["code"],
                ms=round((time.perf_counter() - started) * 1000),
                correlation_id=correlation,
            )
