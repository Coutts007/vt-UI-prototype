import logging

import structlog
from fastapi import APIRouter, FastAPI

from app.api.v1 import auth, directory, profiles, public
from app.config import Settings
from app.db.session import make_engine, make_sessions
from app.errors import install_error_handlers
from app.middleware import ApiMiddleware
from app.services.ratelimit import RateLimiter
from app.services.rules import load_rules

API_PREFIX = "/api/v1"


def configure_logging(level: str) -> None:
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper())),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    production = settings.env == "production"
    docs = f"{API_PREFIX}/docs"

    app = FastAPI(
        title="Virtual Tailor API",
        version="0.1.0",
        docs_url=None if production else docs,
        redoc_url=None,
        openapi_url=None if production else f"{API_PREFIX}/openapi.json",
        separate_input_output_schemas=False,
    )
    app.state.settings = settings
    app.state.engine = make_engine(settings.database_url)
    app.state.sessions = make_sessions(app.state.engine)
    app.state.limiter = RateLimiter(off=settings.rate_limits_off)
    app.state.rules = load_rules()
    app.add_middleware(ApiMiddleware, docs_prefix=None if production else docs)
    install_error_handlers(app)

    router = APIRouter(prefix=API_PREFIX)
    router.include_router(public.router)
    router.include_router(auth.router)
    router.include_router(directory.router)
    router.include_router(profiles.router)
    app.include_router(router)
    return app


app = create_app()
