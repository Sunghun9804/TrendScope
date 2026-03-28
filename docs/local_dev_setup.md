# Local Development Setup

This guide keeps the repository safe for public use while making local setup predictable.

## Prerequisites

- Python 3.11+
- MySQL
- Elasticsearch
- Chrome and ChromeDriver support for Selenium-based crawling

## 1. Create and activate a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r apps\requirements.txt
```

## 2. Create your local `.env`

```powershell
Copy-Item .env.example .env
```

Fill in the required values:

```env
MBC_DB_HOST=localhost
MBC_DB_PORT=3306
MBC_DB_NAME=trendscope
MBC_DB_USER=your_db_user
MBC_DB_PASSWORD=your_db_password_here
MBC_ES_URL=http://localhost:9200
MBC_SESSION_SECRET_KEY=replace_with_a_random_32_plus_char_secret
GEMINI_API_KEY=
```

Notes:

- `GEMINI_API_KEY` is optional.
- If `GEMINI_API_KEY` is empty, summary generation is skipped.
- `.env` must remain local and must never be committed.

## 3. Initialize MySQL

Create a database and user that match your `.env` values, then apply the schema:

```powershell
mysql -u your_db_user -p trendscope < docs\schema_init.sql
```

## 4. Start Elasticsearch

Make sure Elasticsearch is running locally and reachable:

```powershell
curl http://localhost:9200
```

## 5. Verify infrastructure connectivity

```powershell
python -c "from apps.shared.infra.db import verify_connection; verify_connection(); print('DB OK')"
python -c "from apps.shared.infra.elastic import verify_connection; verify_connection(); print('ES OK')"
```

## 6. Run the services

Web app:

```powershell
uvicorn apps.runtime.web.app:app --reload
```

Crawler:

```powershell
uvicorn apps.runtime.crawler.app:app --reload --port 8001
```

Analyzer:

```powershell
python -m apps.runtime.analyzer.app
```

## Troubleshooting

If MySQL or Elasticsearch is unreachable, verify:

- the service is running
- the host and port in `.env` are correct
- your MySQL user has access to the `trendscope` database

If the web app starts with a session-key warning, replace `MBC_SESSION_SECRET_KEY` with a secure random value before any shared or production use.
