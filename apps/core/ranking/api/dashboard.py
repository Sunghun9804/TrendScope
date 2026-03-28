from collections import defaultdict

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from apps.shared.infra.elastic import get_es
from apps.core.ranking.repository.issue_keyword_repo import (
    get_keyword_trend_by_date,
    get_sub_keywords_sum_by_range,
    get_top_keywords_sum_by_range,
)

router = APIRouter(prefix="/api")


def _build_series(hits: list[dict], keywords: list[str]) -> tuple[list[str], dict[str, list[int]]]:
    data_by_date = defaultdict(dict)
    for hit in hits:
        src = hit.get("_source", {})
        date = src.get("date")
        keyword = src.get("keyword")
        count = src.get("count", 0)
        if date and keyword:
            data_by_date[date][keyword] = count

    dates = sorted(data_by_date.keys())
    series = {keyword: [data_by_date[date].get(keyword, 0) for date in dates] for keyword in keywords}
    return dates, series


@router.get("/issue_wordcloud")
def issue_wordcloud(
    start: str = Query(...),
    keyword: str = Query(...),
    end: str | None = Query(None),
    size: int = Query(80),
    min_score: float = Query(0.0),
):
    es = get_es()
    end = end or start

    try:
        sub_keywords = get_sub_keywords_sum_by_range(
            es=es,
            start_date=start,
            end_date=end,
            keyword=keyword,
            size=size,
            min_score=min_score,
        )
        return {
            "success": True,
            "start": start,
            "end": end,
            "keyword": keyword,
            "sub_keywords": sub_keywords,
        }
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "issue_wordcloud aggregation failed",
                "error": str(exc),
                "start": start,
                "end": end,
                "keyword": keyword,
                "sub_keywords": [],
            },
        )
    finally:
        es.close()


@router.get("/keyword_trend")
def keyword_trend(
    start: str = Query(...),
    end: str = Query(...),
    keywords: list[str] | None = Query(None),
):
    es = get_es()
    try:
        selected_keywords = keywords or []
        if not selected_keywords:
            top = get_top_keywords_sum_by_range(es, start, end, size=5)
            selected_keywords = [item["keyword"] for item in top]

        hits = get_keyword_trend_by_date(es, start, end, selected_keywords)
        if not hits:
            return {"success": True, "dates": [], "series": {}, "keywords": selected_keywords}

        dates, series = _build_series(hits, selected_keywords)
        return {"success": True, "dates": dates, "series": series, "keywords": selected_keywords}
    finally:
        es.close()
