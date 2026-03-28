"""
통합 파이프라인 실행 스크립트
  1. ES 인덱스 생성
  2. 크롤링 (max_pages 제한)
  3. 전체 분석 (clean_text → keyword → summary → trust → sentiment → ranking)

사용법:
  python scripts/run_pipeline.py                  # 오늘 날짜, max_pages=20
  python scripts/run_pipeline.py 2026-03-22       # 특정 날짜
  python scripts/run_pipeline.py 2026-03-22 15   # 날짜 + max_pages 지정
"""
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# 프로젝트 루트를 sys.path에 추가
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# 프로젝트 루트의 .env 자동 로드
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(_env_path)
except ImportError:
    pass

KST = ZoneInfo("Asia/Seoul")


def _parse_args():
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.now(KST).strftime("%Y-%m-%d")
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    return date_str, max_pages


def step_create_indices():
    print("\n" + "=" * 60)
    print("[STEP 1] ES 인덱스 생성")
    print("=" * 60)
    from apps.shared.infra.elastic import create_indices
    create_indices()


def step_crawl(date_str: str, max_pages: int):
    print("\n" + "=" * 60)
    print(f"[STEP 2] 크롤링  date={date_str}  max_pages={max_pages}")
    print("=" * 60)
    from apps.core.ingestion.crawler.main import crawl_one_date
    date_yyyymmdd = date_str.replace("-", "")
    result = crawl_one_date(date_yyyymmdd, max_pages=max_pages)
    print(f"[CRAWL DONE] {result}")
    return result


def step_analysis(date_str: str):
    print("\n" + "=" * 60)
    print(f"[STEP 3] 분석 파이프라인  date={date_str}")
    print("=" * 60)
    from apps.core.analysis.pipeline.main import run_analysis_task
    end_str = (datetime.fromisoformat(date_str) + timedelta(days=1)).strftime("%Y-%m-%d")
    run_analysis_task(
        run_id=None,
        start_at=date_str,
        end_at=end_str,
        message=f"manual run date={date_str}",
    )


def main():
    date_str, max_pages = _parse_args()
    total_start = time.time()

    print(f"\n{'=' * 60}")
    print(f"  파이프라인 시작  date={date_str}  max_pages={max_pages}")
    print(f"{'=' * 60}")

    step_create_indices()

    crawl_start = time.time()
    step_crawl(date_str, max_pages)
    print(f"[CRAWL TIME] {(time.time() - crawl_start) / 60:.1f}분")

    analysis_start = time.time()
    step_analysis(date_str)
    print(f"[ANALYSIS TIME] {(time.time() - analysis_start) / 60:.1f}분")

    total_min = (time.time() - total_start) / 60
    print(f"\n{'=' * 60}")
    print(f"  전체 완료  총 소요: {total_min:.1f}분")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
