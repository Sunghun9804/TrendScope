from apps.shared.infra import elastic


def _make_range_filter(start: str, end: str):
    return {
        "range": {
            "published_at": {
                "gte": f"{start}T00:00:00+09:00",
                "lte": f"{end}T23:59:59+09:00",
            }
        }
    }


def _make_sort(orderby: str):
    if orderby == "latest":
        return [{"published_at": {"order": "desc"}}]
    if orderby == "old":
        return [{"published_at": {"order": "asc"}}]
    if orderby == "trust_high":
        return [
            {"trust.score": {"order": "desc", "missing": "_last"}},
            {"published_at": {"order": "desc"}},
        ]
    if orderby == "trust_low":
        return [
            {"trust.score": {"order": "asc", "missing": "_last"}},
            {"published_at": {"order": "desc"}},
        ]
    return [{"published_at": {"order": "desc"}}]


def fetch_articles_by_keyword(
    keyword: str,
    date: str,
    sentiment: str,
    page: int,
    size: int,
    orderby: str,
):
    es = elastic.get_es()
    try:
        filters = [
            {"term": {"keywords.label": keyword}},
            {
                "range": {
                    "published_at": {
                        "gte": f"{date}T00:00:00+09:00",
                        "lte": f"{date}T23:59:59+09:00",
                    }
                }
            },
            {"exists": {"field": "sentiment.label"}},
        ]
        if sentiment != "all":
            filters.append({"term": {"sentiment.label": sentiment}})

        body = {
            "query": {"bool": {"filter": filters}},
            "sort": _make_sort(orderby),
            "from": (page - 1) * size,
            "size": size,
        }
        return es.search(index="news_info", body=body)
    finally:
        es.close()


def fetch_articles_by_keyword_range(
    keyword: str,
    start: str,
    end: str,
    sentiment: str,
    page: int,
    size: int,
    orderby: str,
):
    es = elastic.get_es()
    try:
        filters = [
            {"term": {"keywords.label": keyword}},
            _make_range_filter(start, end),
            {"exists": {"field": "sentiment.label"}},
        ]
        if sentiment != "all":
            filters.append({"term": {"sentiment.label": sentiment}})

        body = {
            "query": {"bool": {"filter": filters}},
            "sort": _make_sort(orderby),
            "from": (page - 1) * size,
            "size": size,
        }
        return es.search(index="news_info", body=body)
    finally:
        es.close()


def fetch_sentiment_summary(keyword: str, start: str, end: str):
    es = elastic.get_es()
    try:
        filters = [
            {"term": {"keywords.label": keyword}},
            _make_range_filter(start, end),
            {"exists": {"field": "sentiment.label"}},
        ]

        body = {
            "size": 0,
            "query": {"bool": {"filter": filters}},
            "aggs": {"sentiment_counts": {"terms": {"field": "sentiment.label", "size": 10}}},
        }
        return es.search(index="news_info", body=body)
    finally:
        es.close()


def fetch_article_by_id(doc_id: str):
    es = elastic.get_es()
    try:
        return es.get(index="news_info", id=doc_id)
    except Exception:
        return None
    finally:
        es.close()
