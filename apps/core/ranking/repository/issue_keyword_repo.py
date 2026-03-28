import hashlib

ISSUE_KEYWORD_INDEX = "issue_keyword_count"


def make_issue_ranking_id(date: str, keyword: str) -> str:
    raw = f"{date}|{keyword.strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()


def upsert_issue_ranking(es, date: str, keyword: str, count: int):
    ranking_id = make_issue_ranking_id(date, keyword)
    es.update(
        index=ISSUE_KEYWORD_INDEX,
        id=ranking_id,
        doc={"date": date, "keyword": keyword, "count": count},
        op_type="create",
    )


def update_issue_sub_keywords(es, date: str, keyword: str, sub_keywords: list[dict]):
    ranking_id = make_issue_ranking_id(date, keyword)
    es.update(
        index=ISSUE_KEYWORD_INDEX,
        id=ranking_id,
        doc={"sub_keywords": sub_keywords},
    )


def update_issue_summary(es, ranking_id: str, summary_text: str, computed_at: str):
    es.update(
        index=ISSUE_KEYWORD_INDEX,
        id=ranking_id,
        doc={
            "summary": {
                "summary": summary_text,
                "computed_at": computed_at,
            }
        },
    )


def delete_by_ranking_id(es, ranking_id: int):
    es.delete_by_query(index=ISSUE_KEYWORD_INDEX, query={"term": {"ranking_id": ranking_id}})


def delete_by_date_keyword(es, date: str, keyword: str):
    es.delete_by_query(
        index=ISSUE_KEYWORD_INDEX,
        query={
            "bool": {
                "filter": [
                    {"term": {"date": date}},
                    {"term": {"keyword": keyword}},
                ]
            }
        },
    )


def get_sub_keywords_by_query(es, date: str, keyword: str):
    resp = es.search(
        index=ISSUE_KEYWORD_INDEX,
        query={"bool": {"filter": [{"term": {"date": date}}, {"term": {"keyword": keyword}}]}},
        source=["sub_keywords"],
        size=1,
    )
    hits = resp["hits"]["hits"]
    if not hits:
        return []
    return hits[0]["_source"].get("sub_keywords", [])


def get_issue_ranking_by_date(es, date: str, size: int = 10):
    return es.search(
        index=ISSUE_KEYWORD_INDEX,
        query={"term": {"date": date}},
        _source=["date", "keyword", "count", "summary.summary"],
        sort=[{"count": {"order": "desc"}}],
        size=size,
    )


def get_issue_ranking_by_date_range(es, start_date: str, end_date: str, size: int = 100):
    return es.search(
        index=ISSUE_KEYWORD_INDEX,
        query={"range": {"date": {"gte": start_date, "lte": end_date}}},
        _source=["date", "keyword", "count"],
        sort=[{"count": {"order": "desc"}}],
        size=size,
    )


def get_top_keywords_sum_by_range(es, start_date: str, end_date: str, size: int = 10):
    resp = es.search(
        index=ISSUE_KEYWORD_INDEX,
        size=0,
        query={"range": {"date": {"gte": start_date, "lte": end_date}}},
        aggs={
            "by_keyword": {
                "terms": {
                    "field": "keyword",
                    "size": size,
                    "order": [{"sum_count": "desc"}, {"_key": "asc"}],
                },
                "aggs": {"sum_count": {"sum": {"field": "count"}}},
            }
        },
    )

    buckets = resp.get("aggregations", {}).get("by_keyword", {}).get("buckets", [])
    return [{"keyword": bucket["key"], "count": int(bucket["sum_count"]["value"])} for bucket in buckets]


def get_sub_key(es, start: str, keyword: str):
    doc_id = make_issue_ranking_id(start, keyword)
    res = es.get(index=ISSUE_KEYWORD_INDEX, id=doc_id)
    src = res.get("_source", {})
    return {"sub_keywords": src.get("sub_keywords", []), "doc_id": doc_id}


def get_sub_keywords_sum_by_range(
    es,
    start_date: str,
    end_date: str,
    keyword: str,
    size: int = 80,
    min_score: float = 0.0,
):
    body = {
        "size": 0,
        "query": {
            "bool": {
                "filter": [
                    {"term": {"keyword": keyword}},
                    {"range": {"date": {"gte": start_date, "lte": end_date}}},
                ]
            }
        },
        "aggs": {
            "sub": {
                "nested": {"path": "sub_keywords"},
                "aggs": {
                    "by_kw": {
                        "terms": {
                            "field": "sub_keywords.keyword",
                            "size": max(1, min(int(size), 500)),
                            "order": {"score_sum": "desc"},
                        },
                        "aggs": {"score_sum": {"sum": {"field": "sub_keywords.score"}}},
                    }
                },
            }
        },
    }

    resp = es.search(index=ISSUE_KEYWORD_INDEX, body=body)
    buckets = (resp.get("aggregations") or {}).get("sub", {}).get("by_kw", {}).get("buckets", [])

    result = []
    for bucket in buckets:
        keyword_text = bucket.get("key")
        score = ((bucket.get("score_sum") or {}).get("value")) or 0.0
        if keyword_text is None or float(score) < float(min_score):
            continue
        result.append({"text": keyword_text, "value": float(score)})
    return result


def get_keyword_trend_by_date(es, start_date: str, end_date: str, keywords: list[str]):
    return es.search(
        index=ISSUE_KEYWORD_INDEX,
        query={
            "bool": {
                "filter": [
                    {"range": {"date": {"gte": start_date, "lte": end_date}}},
                    {"terms": {"keyword": keywords}},
                ]
            }
        },
        _source=["date", "keyword", "count"],
        size=5000,
    )["hits"]["hits"]
