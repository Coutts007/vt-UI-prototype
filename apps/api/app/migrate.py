from pathlib import Path

from alembic import command
from alembic.config import Config

API_ROOT = Path(__file__).parents[1]


def alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(API_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def upgrade(url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(url), revision)


def downgrade(url: str, revision: str = "base") -> None:
    command.downgrade(alembic_config(url), revision)
