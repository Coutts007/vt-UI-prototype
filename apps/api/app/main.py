import logging

import structlog
from fastapi import APIRouter, FastAPI

from app.config import Settings


def configure_logging(level: str) -> None:
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper())),
    )


def create_app() -> FastAPI:
    settings = Settings()
    configure_logging(settings.log_level)

    router = APIRouter(prefix="/api/v1")

    @router.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app = FastAPI(title="Virtual Tailor API", version="0.1.0")
    app.include_router(router)
    return app


app = create_app()
