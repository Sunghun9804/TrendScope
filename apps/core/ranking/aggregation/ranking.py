from typing import Dict

from elasticsearch import helpers

from apps.core.ranking.repository.issue_keyword_repo import make_issue_ranking_id

NEWS_INDEX = "news_info"
OUT_INDEX = "issue_keyword_count"
DATE_FIELD = "published_at"
KEYWORD_FIELD = "keywords.label"


def _make_doc_id(start_date_strict: str, keyword: str) -> str:
    return make_issue_ranking_id(start_date_strict, keyword)


def aggregate_keywords_in_range(
    es,
    start_dt: str,
    end_dt: str,
    size: int = 10000,
) -> list[tuple[str, int]]:
    resp = es.search(
        index=NEWS_INDEX,
        size=0,
        query={
            "bool": {
                "filter": [
                    {"range": {DATE_FIELD: {"gte": start_dt, "lt": end_dt}}},
                    {"exists": {"field": KEYWORD_FIELD}},
                ]
            }
        },
        aggs={"by_keyword": {"terms": {"field": KEYWORD_FIELD, "size": size}}},
    )

    buckets = resp.get("aggregations", {}).get("by_keyword", {}).get("buckets", [])
    return [(bucket["key"], int(bucket["doc_count"])) for bucket in buckets]


def write_issue_keyword_count(
    es,
    start_date_strict: str,
    keyword_counts: list[tuple[str, int]],
    refresh: bool = True,
    chunk_size: int = 1000,
) -> Dict[str, int]:
    actions = [
        {
            "_op_type": "index",
            "_index": OUT_INDEX,
            "_id": _make_doc_id(start_date_strict, keyword),
            "_source": {
                "date": start_date_strict,
                "keyword": keyword,
                "count": int(count),
            },
        }
        for keyword, count in keyword_counts
    ]

    ok = 0
    fail = 0
    for _, item in helpers.streaming_bulk(
        es,
        actions,
        chunk_size=chunk_size,
        raise_on_error=False,
        raise_on_exception=False,
    ):
        op = item.get("index") or item.get("create") or item.get("update")
        status = op.get("status") if op else None
        if status in (200, 201):
            ok += 1
        else:
            fail += 1

    if refresh:
        es.indices.refresh(index=OUT_INDEX)

    return {"ok": ok, "fail": fail, "total": len(actions)}


def run_issue_keyword_count_for_range(es, start_dt: str, end_dt: str) -> None:
    start_date_strict = start_dt[:10]
    pairs = aggregate_keywords_in_range(es, start_dt, end_dt)
    result = write_issue_keyword_count(es, start_date_strict, pairs)

    print("[ISSUE_KEYWORD_COUNT DONE]")
    print(f"- date: {start_date_strict}")
    print(f"- keywords: {len(pairs)}")
    print(f"- bulk_ok: {result['ok']}, bulk_fail: {result['fail']}")
