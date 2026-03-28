from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from apps.shared.infra.db import get_db
from apps.core.ingestion.batch_runs import batch_runs_repo
from apps.core.ingestion.crawler.main import crawl_one_date
from .admin_deps import admin_required

router = APIRouter(prefix="/admin/collection", tags=["admin"])

_lock = threading.Lock()
_state: Dict[str, Any] = {
    "running": False,
    "active_run_id": None,
    "progress": 0,
    "status": "idle",
    "message": "",
}


def _update_state(**changes: Any) -> None:
    with _lock:
        _state.update(**changes)


def _start_run_state() -> None:
    with _lock:
        if _state.get("running"):
            raise HTTPException(status_code=409, detail="Already running")
        _state.update(
            running=True,
            status="running",
            progress=0,
            active_run_id=None,
            message="start",
        )


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _parse_date_like(s: str) -> datetime:
    s = (s or "").strip()
    if not s:
        return datetime.now()

    digits = "".join(ch for ch in s if ch.isdigit())

    if len(digits) >= 8 and ("-" not in s) and (":" not in s):
        return datetime.strptime(digits[:8], "%Y%m%d")

    if len(s) >= 19 and s[4] == "-" and s[7] == "-" and (s[10] == " " or s[10] == "T"):
        fmt = "%Y-%m-%d %H:%M:%S" if s[10] == " " else "%Y-%m-%dT%H:%M:%S"
        try:
            return datetime.strptime(s[:19], fmt)
        except Exception:
            return datetime.strptime(s[:10], "%Y-%m-%d")

    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return datetime.strptime(s[:10], "%Y-%m-%d")

    if len(digits) >= 8:
        return datetime.strptime(digits[:8], "%Y%m%d")

    return datetime.now()


def _is_date_only(s: str) -> bool:
    s = (s or "").strip()
    if not s:
        return True

    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return True

    digits = "".join(ch for ch in s if ch.isdigit())
    return len(digits) == 8 and (":" not in s) and ("-" not in s)


def _range_to_sql_bounds(start: str, end: str) -> tuple[str, str]:
    s_dt = _parse_date_like(start)
    e_dt = _parse_date_like(end)

    if _is_date_only(start):
        s_dt = datetime(s_dt.year, s_dt.month, s_dt.day, 0, 0, 0)
    if _is_date_only(end):
        e_dt = datetime(e_dt.year, e_dt.month, e_dt.day, 0, 0, 0) + timedelta(days=1)
    if s_dt > e_dt:
        s_dt, e_dt = e_dt, s_dt

    return (
        s_dt.strftime("%Y-%m-%d %H:%M:%S"),
        e_dt.strftime("%Y-%m-%d %H:%M:%S"),
    )


def _date_from_runrow(row: dict) -> str:
    v = row.get("start_at") or row.get("work_at")
    if v is None:
        return datetime.now().strftime("%Y%m%d")

    if hasattr(v, "strftime"):
        return v.strftime("%Y%m%d")

    s = str(v).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10].replace("-", "")

    digits = "".join(ch for ch in s if ch.isdigit())
    return digits[:8] if len(digits) >= 8 else datetime.now().strftime("%Y%m%d")


def _build_rerun_message(
    origin_run_id: int,
    target_date: Optional[str] = None,
    crawler_result: Optional[dict] = None,
    error: Optional[Exception] = None,
) -> str:
    payload: Dict[str, Any] = {"origin_run_id": origin_run_id}
    if target_date is not None:
        payload["target_date"] = target_date
    if crawler_result is not None:
        payload["crawler_result"] = crawler_result
    if error is not None:
        payload["error"] = str(error)
    return json.dumps(payload, ensure_ascii=False)


def _finalize_rerun(
    db,
    run_id: int,
    state_code: int,
    message: str,
) -> None:
    batch_runs_repo.update_run_state(
        db,
        run_id=run_id,
        state_code=state_code,
        message=message,
        end_at=_now_str(),
    )
    db.commit()


def _real_rerun(db_run_id: int, origin_run_id: int) -> None:
    db = get_db()
    try:
        _update_state(
            running=True,
            active_run_id=db_run_id,
            progress=5,
            status="running",
            message="origin run lookup in progress",
        )

        origin = batch_runs_repo.get_run(db, origin_run_id)
        if not origin:
            raise RuntimeError("origin run not found")

        target_yyyymmdd = _date_from_runrow(origin)

        _update_state(progress=15, message=f"rerun preparing ({target_yyyymmdd})")

        _update_state(progress=25, message="crawler executing")

        result = crawl_one_date(target_yyyymmdd)
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(result["error"])

        _update_state(progress=90, message="finalizing rerun record")

        _finalize_rerun(
            db=db,
            run_id=db_run_id,
            state_code=200,
            message=_build_rerun_message(
                origin_run_id=origin_run_id,
                target_date=target_yyyymmdd,
                crawler_result=result,
            ),
        )

        _update_state(
            running=False,
            status="done",
            progress=100,
            message=f"done ({target_yyyymmdd})",
        )
    except Exception as e:
        db.rollback()
        try:
            _finalize_rerun(
                db=db,
                run_id=db_run_id,
                state_code=500,
                message=_build_rerun_message(origin_run_id=origin_run_id, error=e),
            )
        except Exception as finalize_error:
            _update_state(message=f"failed to save rerun error: {finalize_error}")

        _update_state(
            running=False,
            status="error",
            progress=100,
            message=f"failed: {e}",
        )
    finally:
        db.close()


@router.get("/runs")
def list_runs(
    start: str,
    end: str,
    cursor: Optional[int] = None,
    limit: int = 20,
    _: None = Depends(admin_required),
):
    start_bound, end_bound = _range_to_sql_bounds(start, end)

    db = get_db()
    try:
        rows = batch_runs_repo.list_error_runs(
            db,
            start=start_bound,
            end=end_bound,
            cursor=cursor,
            limit=limit,
        )
        next_cursor = rows[-1]["run_id"] if rows and len(rows) == limit else None
        return {"items": rows, "next_cursor": next_cursor}
    finally:
        db.close()


@router.get("/runs/{run_id}")
def run_detail(
    run_id: int,
    _: None = Depends(admin_required),
):
    db = get_db()
    try:
        row = batch_runs_repo.get_run(db, run_id)
        if not row:
            raise HTTPException(status_code=404, detail="run not found")
        return row
    finally:
        db.close()


@router.post("/runs/{run_id}/rerun")
def rerun(
    run_id: int,
    _: None = Depends(admin_required),
):
    _start_run_state()

    db = get_db()
    try:
        now = _now_str()
        db_run_id = batch_runs_repo.insert_run(
            db,
            job_name="admin_rerun",
            work_at=now,
            state_code=102,
            message=f"rerun requested (origin_run_id={run_id})",
            start_at=now,
            end_at=now,
        )
        db.commit()
    finally:
        db.close()

    t = threading.Thread(target=_real_rerun, args=(db_run_id, run_id), daemon=True)
    t.start()

    _update_state(active_run_id=db_run_id, message="rerun in progress")

    return {"ok": True, "run_id": db_run_id}


@router.get("/progress")
def progress(
    _: None = Depends(admin_required),
):
    with _lock:
        return dict(_state)
