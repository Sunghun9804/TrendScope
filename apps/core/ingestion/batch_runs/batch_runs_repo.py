from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import text


DateLike = str


def sensing(db) -> List[Dict[str, Any]]:
    """Return the latest run rows that already contain a non-empty message."""
    sql = text(
        """
        SELECT run_id, start_at, end_at, message
        FROM batch_runs
        WHERE LENGTH(TRIM(message)) > 0
        ORDER BY run_id DESC
        LIMIT 1
        """
    )
    rows = db.execute(sql).mappings().all()
    return [dict(row) for row in rows]


def list_error_runs(
    db,
    start: DateLike,
    end: DateLike,
    cursor: Optional[int] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Return unresolved error runs within [start, end)."""
    resolved_filter = """
      AND NOT EXISTS (
        SELECT 1
        FROM batch_runs rr
        WHERE rr.job_name = 'admin_rerun'
          AND rr.state_code = 200
          AND rr.message IS NOT NULL
          AND JSON_VALID(rr.message)
          AND CAST(JSON_UNQUOTE(JSON_EXTRACT(rr.message, '$.origin_run_id')) AS UNSIGNED) = batch_runs.run_id
      )
    """

    cursor_clause = "" if cursor is None else "AND run_id < :cursor"
    sql = f"""
    SELECT run_id, job_name, start_at, end_at, work_at, state_code, message
    FROM batch_runs
    WHERE work_at >= :start
      AND work_at < :end
      AND state_code >= 300
      {resolved_filter}
      {cursor_clause}
    ORDER BY run_id DESC
    LIMIT :limit
    """

    params = {"start": start, "end": end, "limit": limit}
    if cursor is not None:
        params["cursor"] = cursor

    rows = db.execute(text(sql), params).mappings().all()
    return [dict(row) for row in rows]


def get_run(db, run_id: int) -> Optional[Dict[str, Any]]:
    sql = text(
        """
        SELECT run_id, job_name, start_at, end_at, work_at, state_code, message
        FROM batch_runs
        WHERE run_id = :run_id
        """
    )
    row = db.execute(sql, {"run_id": run_id}).mappings().fetchone()
    return dict(row) if row else None


def insert_run(
    db,
    job_name: str,
    work_at: str,
    state_code: int,
    message: str,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> int:
    """Insert a new batch_runs row and return its run_id."""
    sql = text(
        """
        INSERT INTO batch_runs (job_name, work_at, state_code, message, start_at, end_at)
        VALUES (:job_name, :work_at, :state_code, :message, :start_at, :end_at)
        """
    )
    result = db.execute(
        sql,
        {
            "job_name": job_name,
            "work_at": work_at,
            "state_code": state_code,
            "message": message,
            "start_at": start_at,
            "end_at": end_at,
        },
    )
    run_id = getattr(result, "lastrowid", None)
    if run_id is None:
        row = db.execute(text("SELECT LAST_INSERT_ID() AS id")).mappings().fetchone()
        run_id = int(row["id"]) if row else 0
    return int(run_id)


def update_run_state(
    db,
    run_id: int,
    state_code: int,
    message: str,
    end_at: Optional[str] = None,
) -> None:
    sql = text(
        """
        UPDATE batch_runs
        SET state_code = :state_code,
            message = :message,
            end_at = COALESCE(:end_at, end_at)
        WHERE run_id = :run_id
        """
    )
    db.execute(
        sql,
        {
            "run_id": run_id,
            "state_code": state_code,
            "message": message,
            "end_at": end_at,
        },
    )
