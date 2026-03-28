from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
APPS_DIR = PROJECT_ROOT / "apps"
MODELS_DIR = PROJECT_ROOT / "legacy" / "analyzer_assets" / "model"
ARTIFACTS_DIR = PROJECT_ROOT / "artifacts"


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


DB_USER = os.getenv("MBC_DB_USER", "")
DB_PASSWORD = os.getenv("MBC_DB_PASSWORD", "")
DB_HOST = os.getenv("MBC_DB_HOST", "localhost")
DB_PORT = int(os.getenv("MBC_DB_PORT", "3306"))
DB_NAME = os.getenv("MBC_DB_NAME", "trendscope")
DB_ECHO = _get_bool("MBC_DB_ECHO", True)
DB_POOL_SIZE = int(os.getenv("MBC_DB_POOL_SIZE", "100"))
DB_POOL_MAX_OVERFLOW = int(os.getenv("MBC_DB_POOL_MAX_OVERFLOW", "20"))
DB_POOL_TIMEOUT = int(os.getenv("MBC_DB_POOL_TIMEOUT", "30"))

ES_URL = os.getenv("MBC_ES_URL", "http://localhost:9200")
ES_CONNECTIONS_PER_NODE = int(os.getenv("MBC_ES_CONNECTIONS_PER_NODE", "10"))
ES_REQUEST_TIMEOUT = int(os.getenv("MBC_ES_REQUEST_TIMEOUT", "120"))

SESSION_SECRET_KEY = os.getenv("MBC_SESSION_SECRET_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SENTIMENT_MODEL_DIR = Path(
    os.getenv("MBC_SENTIMENT_MODEL_DIR", str(MODELS_DIR / "sentiment_model"))
)
TRUST_MODEL_DIR = Path(
    os.getenv("MBC_TRUST_MODEL_DIR", str(MODELS_DIR / "trust_electra20251209"))
)
ISSUE_CLASSIFIER_MODEL_DIR = Path(
    os.getenv("MBC_ISSUE_CLASSIFIER_MODEL_DIR", str(MODELS_DIR / "issue_classifier0106_svc"))
)
DEFAULT_WORD_DATA_CSV = Path(
    os.getenv(
        "MBC_WORD_DATA_CSV",
        str(PROJECT_ROOT / "frontend" / "static" / "word_data" / "kdi_worddic_strict_20251230_165545.csv"),
    )
)


def get_database_url() -> str:
    return f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
