from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from apps.shared.config.env import (
    DB_ECHO,
    DB_HOST,
    DB_NAME,
    DB_POOL_MAX_OVERFLOW,
    DB_POOL_SIZE,
    DB_POOL_TIMEOUT,
    DB_PORT,
    get_database_url,
)

logger = logging.getLogger(__name__)

url = get_database_url()

_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            url,
            echo=DB_ECHO,
            pool_size=DB_POOL_SIZE,
            max_overflow=DB_POOL_MAX_OVERFLOW,
            pool_timeout=DB_POOL_TIMEOUT,
            pool_pre_ping=True,
        )
    return _engine


def get_db():
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine())
    return _session_factory()


def verify_connection() -> None:
    logger.info("MySQL 연결 확인 중 — host=%s port=%s db=%s", DB_HOST, DB_PORT, DB_NAME)
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("MySQL 연결 성공")
    except Exception as exc:
        logger.error("MySQL 연결 실패 — host=%s port=%s db=%s | %s", DB_HOST, DB_PORT, DB_NAME, exc)
        raise
