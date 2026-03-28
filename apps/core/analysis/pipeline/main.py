import time
from collections.abc import Callable
from typing import Any

from apps.core.analysis.enrichment.build_clean_text import build_clean_text_by_ids, build_clean_text_range
from apps.core.analysis.enrichment.predict_issue_keyword import (
    find_missing_keywords,
    predict_issue_keyword_ids,
    predict_issue_keyword_range,
)
from apps.core.ranking.aggregation.ranking import run_issue_keyword_count_for_range
from apps.core.ranking.aggregation.ranking_subkey import run_pipeline
from apps.core.analysis.enrichment.sentiment import update_sentiment
from apps.core.analysis.enrichment.summary_gemini import summarize_news
from apps.core.analysis.enrichment.trust import trust_analyze
from apps.shared.infra.db import get_db
from apps.shared.infra.elastic import get_es
from apps.core.ingestion.batch_runs.batch_runs_repo import sensing

PipelineStep = tuple[str, Callable[..., Any], dict[str, Any]]


def _as_day_string(value: Any) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)[:10]


def _build_range(start_at: Any, end_at: Any) -> tuple[str, str, str, str]:
    start_str = _as_day_string(start_at)
    end_str = _as_day_string(end_at)
    start_time = f"{start_str}T00:00:00+09:00"
    end_time = f"{end_str}T00:00:00+09:00"
    return start_str, end_str, start_time, end_time


def _run_steps(steps: list[PipelineStep]) -> None:
    for step_name, func, kwargs in steps:
        print(f"[STEP] {step_name}")
        func(**kwargs)
        time.sleep(1)


def _run_missing_keyword_backfill(es, work_date: str) -> None:
    target_ids = find_missing_keywords(es, work_date)
    if not target_ids:
        return

    print(f"[STEP] clean_text by ids count={len(target_ids)}")
    build_clean_text_by_ids(es, doc_ids=target_ids)
    time.sleep(1)

    print(f"[STEP] keyword by ids count={len(target_ids)}")
    predict_issue_keyword_ids(es, doc_ids=target_ids, batch_size=256)


def run_analysis_task(run_id, start_at, end_at, message):
    start_str, end_str, start_time, end_time = _build_range(start_at, end_at)

    print(f"[ANALYSIS START] run_id={run_id} range={start_time}~{end_time}")
    print(f"[MESSAGE] {str(message)[:50].replace(chr(10), ' ')}...")

    es = get_es()
    try:
        steps: list[PipelineStep] = [
            ("clean_text", build_clean_text_range, {"es": es, "start_dt": start_time, "end_dt": end_time}),
            ("keyword", predict_issue_keyword_range, {"es": es, "start_dt": start_time, "end_dt": end_time}),
            ("summary", summarize_news, {"es": es, "start_date": start_time, "end_date": end_time}),
            ("trust", trust_analyze, {"es": es, "start_at": start_time, "end_at": end_time}),
            ("sentiment", update_sentiment, {"es": es, "start_dt": start_time, "end_dt": end_time}),
            (
                "ranking count",
                run_issue_keyword_count_for_range,
                {"es": es, "start_dt": start_time, "end_dt": end_time},
            ),
            ("ranking subkeywords", run_pipeline, {"es": es, "start_at": start_time, "end_at": end_time}),
        ]
        _run_steps(steps)
        _run_missing_keyword_backfill(es, start_str)
        print(f"[ANALYSIS DONE] run_id={run_id} range={start_str}~{end_str}")
    finally:
        es.close()


def watch_batch_runs():
    processed_run_ids = set()
    while True:
        try:
            db = get_db()
            try:
                rows = sensing(db)
            finally:
                db.close()

            if not rows:
                time.sleep(10)
                continue

            print(f"DEBUG: fetched rows={len(rows)}")
            for row in rows:
                run_id = row["run_id"]
                if run_id in processed_run_ids:
                    print(f"ID {run_id} already processed")
                    continue

                print(f"ID {run_id} entering analysis")
                run_analysis_task(
                    run_id=run_id,
                    start_at=row["start_at"],
                    end_at=row["end_at"],
                    message=row["message"],
                )
                processed_run_ids.add(run_id)

            time.sleep(10)
        except Exception as exc:
            print(f"[ANALYSIS WATCHER] failed: {exc}")
            time.sleep(30)


if __name__ == "__main__":
    watch_batch_runs()
