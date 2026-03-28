"""
7일치 파이프라인 실행 스크립트
  - 기본: 오늘 기준 최근 7일
  - 이미 수집된 기사는 크롤링 스킵
  - 이미 요약된 기사는 summary 스킵

사용법:
  python scripts/run_week.py                        # 오늘 기준 최근 7일
  python scripts/run_week.py 2026-03-22             # 해당 날짜 기준 최근 7일
  python scripts/run_week.py 2026-03-16 2026-03-22  # 날짜 범위 직접 지정
"""
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

KST = ZoneInfo("Asia/Seoul")


def _parse_args():
    args = sys.argv[1:]
    if len(args) == 2:
        start = datetime.fromisoformat(args[0])
        end   = datetime.fromisoformat(args[1])
    elif len(args) == 1:
        end   = datetime.fromisoformat(args[0])
        start = end - timedelta(days=6)
    else:
        end   = datetime.now(KST).replace(tzinfo=None)
        start = end - timedelta(days=6)
    return start, end


def date_range(start: datetime, end: datetime):
    cur = start
    while cur <= end:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


def main():
    start, end = _parse_args()
    dates = list(date_range(start, end))

    print(f"\n{'=' * 60}")
    print(f"  7일치 파이프라인 시작")
    print(f"  대상: {dates[0]} ~ {dates[-1]}  ({len(dates)}일)")
    print(f"{'=' * 60}\n")

    from scripts.run_pipeline import step_create_indices, step_crawl, step_analysis

    step_create_indices()

    total_start = time.time()

    for i, date_str in enumerate(dates, 1):
        print(f"\n{'=' * 60}")
        print(f"  [{i}/{len(dates)}] {date_str} 처리 시작")
        print(f"{'=' * 60}")

        day_start = time.time()

        crawl_start = time.time()
        step_crawl(date_str, max_pages=20)
        print(f"[CRAWL TIME] {(time.time() - crawl_start) / 60:.1f}분")

        analysis_start = time.time()
        step_analysis(date_str)
        print(f"[ANALYSIS TIME] {(time.time() - analysis_start) / 60:.1f}분")

        elapsed = (time.time() - day_start) / 60
        remaining = (time.time() - total_start) / 60
        print(f"[DAY DONE] {date_str}  소요: {elapsed:.1f}분  누적: {remaining:.1f}분")

    total_min = (time.time() - total_start) / 60
    print(f"\n{'=' * 60}")
    print(f"  전체 완료  총 소요: {total_min:.1f}분")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
