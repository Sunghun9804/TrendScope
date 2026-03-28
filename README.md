# TrendScope

TrendScope is a FastAPI-based news analysis project that combines article crawling, NLP enrichment, ranking, glossary features, and a static frontend.

This repository is prepared for public upload without private API keys. Users should copy `.env.example` to `.env` and fill in their own local values.

## Stack

- Backend: FastAPI, SQLAlchemy, Uvicorn
- Data stores: MySQL, Elasticsearch
- Crawling: Selenium, webdriver-manager
- NLP/ML: Transformers, TensorFlow, scikit-learn
- Optional summarization: Gemini API
- Frontend: static HTML, CSS, JavaScript

## Project Layout

```text
apps/
  core/        domain logic
  runtime/     web, crawler, analyzer entrypoints
  shared/      config, infra, logging
frontend/
  view/        static HTML
  static/      JS and data assets
legacy/
  analyzer_assets/   local-only model assets
docs/
  github-architecture.md
  local_dev_setup.md
  schema_init.sql
```

## Environment Setup

1. Create a virtual environment and install dependencies.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r apps\requirements.txt
```

2. Copy the example environment file.

```powershell
Copy-Item .env.example .env
```

3. Fill in your local values in `.env`.

Required values:

- `MBC_DB_HOST`
- `MBC_DB_PORT`
- `MBC_DB_NAME`
- `MBC_DB_USER`
- `MBC_DB_PASSWORD`
- `MBC_ES_URL`
- `MBC_SESSION_SECRET_KEY`

Optional values:

- `GEMINI_API_KEY`

If `GEMINI_API_KEY` is empty, summary generation is skipped by design.

## Local Run

Initialize the MySQL schema:

```powershell
mysql -u your_db_user -p trendscope < docs\schema_init.sql
```

Start the web app:

```powershell
uvicorn apps.runtime.web.app:app --reload
```

Start the crawler:

```powershell
uvicorn apps.runtime.crawler.app:app --reload --port 8001
```

Start the analyzer:

```powershell
python -m apps.runtime.analyzer.app
```

## Notes

- `.env` is intentionally ignored and must never be committed.
- Large local model binaries under `legacy/analyzer_assets/model` are excluded from Git.
- If `MBC_SESSION_SECRET_KEY` is not set, the app falls back to an insecure development-only key and logs a warning.

## Docs

- [Architecture](./docs/github-architecture.md)
- [Local Development](./docs/local_dev_setup.md)
- [Schema](./docs/schema_init.sql)
