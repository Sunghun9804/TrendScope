from __future__ import annotations

from datetime import datetime, timedelta
from multiprocessing import Process
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from apps.shared.infra import elastic
from apps.shared.infra.db import get_db
from apps.shared.logging.logger import Logger
from .admin_deps import admin_required


class ReanalyzeRequest(BaseModel):
    article_ids: list[str]
    fields: list[str]
    job_id: str


router = APIRouter(prefix="/admin/reanalyze", tags=["admin"])
logger = Logger().get_logger(__name__)

FIELD_MAP = {
    "keyword": "keywords.label",
    "sentiment": "sentiment.label",
    "trust": "trust.label",
    "summary": "summary.summary_text",
}

def _build_clean_text_by_ids(es, article_ids: list[str]) -> None:
    from apps.core.analysis.enrichment.build_clean_text import build_clean_text_by_ids

    build_clean_text_by_ids(es, article_ids)


def _predict_issue_keyword_ids(es, article_ids: list[str]) -> None:
    from apps.core.analysis.enrichment.predict_issue_keyword import predict_issue_keyword_ids

    predict_issue_keyword_ids(es, article_ids)


def _update_sentiment_by_ids(es, article_ids: list[str]) -> None:
    from apps.core.analysis.enrichment.sentiment import update_sentiment_by_ids

    update_sentiment_by_ids(es, article_ids)


def _trust_analyze_by_ids(es, article_ids: list[str]) -> None:
    from apps.core.analysis.enrichment.trust import trust_analyze_by_ids

    trust_analyze_by_ids(es, article_ids)


def _summarize_news_by_ids(es, article_ids: list[str]) -> None:
    from apps.core.analysis.enrichment.summary_gemini_ids import summarize_news_by_ids

    summarize_news_by_ids(es, article_ids)


FIELD_HANDLERS: dict[str, Callable] = {
    "keyword": _predict_issue_keyword_ids,
    "sentiment": _update_sentiment_by_ids,
    "trust": _trust_analyze_by_ids,
    "summary": _summarize_news_by_ids,
}


def _iso_dt(date_str: str | None, is_end: bool = False) -> str:
    if not date_str or date_str == "undefined":
        date_str = datetime.now().strftime("%Y-%m-%d")
    return f"{date_str}T23:59:59+09:00" if is_end else f"{date_str}T00:00:00+09:00"


def check_global_lock(db) -> bool:
    try:
        stmt = text("SELECT status FROM analysis_task ORDER BY work_at DESC LIMIT 1")
        row = db.execute(stmt).fetchone()
        return bool(row and row[0] == "running")
    except Exception as exc:
        logger.error(f"Global lock check error: {exc}")
        return False


def _update_task_row(db, job_id: str, *, status: str | None = None, progress: int | None = None) -> None:
    sets = ["update_at = NOW()"]
    params = {"id": job_id}
    if status is not None:
        sets.append("status = :status")
        params["status"] = status
    if progress is not None:
        sets.append("progress = :progress")
        params["progress"] = progress

    db.execute(text(f"UPDATE analysis_task SET {', '.join(sets)} WHERE job_id = :id"), params)
    db.commit()


def _fetch_source(es, article_id: str) -> dict:
    return es.get(index="news_info", id=article_id)["_source"]


def _needs_clean_text(src: dict) -> bool:
    return all(src.get(field) is None for field in ["keywords", "sentiment", "trust", "summary"])


def _run_requested_fields(es, article_id: str, fields: list[str], src: dict) -> None:
    if _needs_clean_text(src):
        _build_clean_text_by_ids(es, [article_id])

    for field in fields:
        handler = FIELD_HANDLERS.get(field)
        if handler is None:
            continue

        field_root = FIELD_MAP[field].split(".")[0]
        if src.get(field_root) is None:
            handler(es, [article_id])


@router.get("/errors")
def list_analysis_errors(
    start: str = None,
    end: str = None,
    fields: str = None,
    size: int = 10000,
    _: None = Depends(admin_required),
):
    if not start or start == "undefined":
        start = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    if not end or end == "undefined":
        end = datetime.now().strftime("%Y-%m-%d")

    wanted = [field.strip() for field in fields.split(",") if field.strip()] if fields else []
    if not wanted:
        return {"items": [], "count": 0}

    should_conditions = []
    fetch_fields = ["article_id", "published_at"]
    for field_name, path in FIELD_MAP.items():
        field_root = path.split(".")[0]
        if field_name in wanted:
            should_conditions.append({"bool": {"must_not": {"exists": {"field": path}}}})
        if field_root not in fetch_fields:
            fetch_fields.append(field_root)

    body = {
        "query": {
            "bool": {
                "filter": [
                    {
                        "range": {
                            "published_at": {
                                "gte": _iso_dt(start),
                                "lte": _iso_dt(end, True),
                            }
                        }
                    }
                ],
                "should": should_conditions,
                "minimum_should_match": 1,
            }
        },
        "_source": fetch_fields,
        "size": size,
        "sort": [{"published_at": {"order": "desc"}}],
    }

    es = elastic.get_es()
    try:
        resp = es.search(index="news_info", body=body)
        hits = resp.get("hits", {}).get("hits", [])

        items = []
        for hit in hits:
            src = hit.get("_source", {})
            row = {
                "article_id": src.get("article_id") or hit.get("_id"),
                "published_at": src.get("published_at"),
            }
            for field_name, path in FIELD_MAP.items():
                row[field_name] = "OK" if src.get(path.split(".")[0]) else None
            items.append(row)

        return {"items": items, "count": len(items)}
    except Exception as exc:
        logger.error(f"Error searching ES: {exc}")
        raise HTTPException(status_code=500, detail="error while searching analysis targets")
    finally:
        es.close()


@router.post("/run", dependencies=[Depends(admin_required)])
def _reanalyze_articles(req: ReanalyzeRequest):
    db = get_db()
    try:
        if check_global_lock(db):
            raise HTTPException(status_code=400, detail="another analysis task is already running")

        db.execute(
            text(
                """
                INSERT INTO analysis_task (job_id, status, progress, update_at)
                VALUES (:id, 'running', 0, NOW())
                """
            ),
            {"id": req.job_id},
        )
        db.commit()

        process = Process(target=_run_task, args=(req.article_ids, req.fields, req.job_id), daemon=True)
        process.start()
        return {"status": "ok", "job_id": req.job_id}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(f"[reanalyze] start failed: {exc}")
        raise HTTPException(status_code=500, detail=f"task start failed: {exc}")
    finally:
        db.close()


def _run_task(article_ids: list[str], fields: list[str], job_id: str):
    es = elastic.get_es()
    db = get_db()
    total = len(article_ids)
    total_safe = max(total, 1)

    try:
        for idx, article_id in enumerate(article_ids, start=1):
            try:
                src = _fetch_source(es, article_id)
                _run_requested_fields(es, article_id, fields, src)
            except Exception:
                logger.exception(f"[reanalyze] failed article_id={article_id}")

            current_progress = int(idx * 100 / total_safe)
            _update_task_row(db, job_id, progress=current_progress)

        _update_task_row(db, job_id, status="done", progress=100 if total else 0)
    except Exception as exc:
        logger.exception(f"[reanalyze] task error: {exc}")
        _update_task_row(db, job_id, status="error")
    finally:
        es.close()
        db.close()


@router.get("/progress/{job_id}", dependencies=[Depends(admin_required)])
def reanalyze_status(job_id: str):
    db = get_db()
    try:
        target_id = job_id.strip()
        row = db.execute(
            text("SELECT status, progress FROM analysis_task WHERE job_id = :id"),
            {"id": target_id},
        ).fetchone()
        if row:
            return {"status": row[0], "progress": row[1]}

        logger.warning(f"Job ID {target_id} not found in DB.")
        raise HTTPException(status_code=404, detail=f"job {target_id} not found")
    finally:
        db.close()


@router.get("/status/latest", dependencies=[Depends(admin_required)])
def get_latest_status():
    db = get_db()
    try:
        row = db.execute(
            text(
                """
                SELECT job_id, status, progress, work_at, update_at
                FROM analysis_task
                ORDER BY work_at DESC
                LIMIT 1
                """
            )
        ).mappings().fetchone()
        return dict(row) if row else {"job_id": None, "status": None, "progress": 0}
    finally:
        db.close()
