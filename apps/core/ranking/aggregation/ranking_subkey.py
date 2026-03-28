from __future__ import annotations

import re

from elasticsearch import Elasticsearch
from sklearn.feature_extraction.text import TfidfVectorizer

from apps.core.ranking.repository.issue_keyword_repo import make_issue_ranking_id

SOURCE_INDEX = "news_info"
TARGET_INDEX = "issue_keyword_count"
MAX_TERMS = 10000
TOP_N_SUB_KEYWORDS = 30

STOPWORDS = {
    "기자",
    "뉴스",
    "연합뉴스",
    "이번",
    "오늘",
    "정부",
    "시장",
}


def is_valid_token(token: str) -> bool:
    if len(token) < 2 or token in STOPWORDS or token.isdigit():
        return False
    return re.fullmatch(r"[0-9]+", token) is None


def extract_sub_keywords(texts: list[str], top_n: int = TOP_N_SUB_KEYWORDS) -> list[dict]:
    if not texts:
        return []

    vectorizer = TfidfVectorizer(
        max_features=2000,
        ngram_range=(1, 2),
        token_pattern=r"(?u)\b\w+\b",
    )
    tfidf = vectorizer.fit_transform(texts)
    scores = tfidf.mean(axis=0).A1
    features = vectorizer.get_feature_names_out()

    pairs = sorted(zip(features, scores), key=lambda pair: pair[1], reverse=True)
    result = []
    for word, score in pairs:
        if not is_valid_token(word):
            continue
        result.append({"keyword": word, "score": float(score)})
        if len(result) >= top_n:
            break
    return result


def compute_issue_ranking(es: Elasticsearch, start_at, end_at) -> dict[str, int]:
    query = {
        "size": 0,
        "query": {"range": {"published_at": {"gte": start_at, "lt": end_at}}},
        "aggs": {"by_issue": {"terms": {"field": "keywords.label", "size": MAX_TERMS}}},
    }
    resp = es.search(index=SOURCE_INDEX, body=query)
    return {bucket["key"]: bucket["doc_count"] for bucket in resp["aggregations"]["by_issue"]["buckets"]}


def fetch_texts_by_issue(es, issue_keyword: str, start_at, end_at) -> list[str]:
    resp = es.search(
        index=SOURCE_INDEX,
        body={
            "size": 10000,
            "query": {
                "bool": {
                    "must": [
                        {"term": {"keywords.label": issue_keyword}},
                        {"range": {"published_at": {"gte": start_at, "lt": end_at}}},
                    ]
                }
            },
            "_source": ["title", "body"],
        },
    )

    texts = []
    for hit in resp["hits"]["hits"]:
        src = hit["_source"]
        text = f"{src.get('title', '')} {src.get('body', '')}".strip()
        if text:
            texts.append(text)
    return texts


def upsert_issue_keyword(
    es: Elasticsearch,
    work_date: str,
    keyword: str,
    count: int,
    sub_keywords: list[dict],
) -> None:
    doc_id = make_issue_ranking_id(work_date, keyword)
    es.index(
        index=TARGET_INDEX,
        id=doc_id,
        document={
            "date": work_date,
            "keyword": keyword,
            "count": count,
            "sub_keywords": sub_keywords,
        },
    )


def run_pipeline(es, start_at, end_at) -> None:
    work_date = start_at[:10]
    ranking = compute_issue_ranking(es, start_at, end_at)

    for issue_keyword, count in ranking.items():
        texts = fetch_texts_by_issue(es, issue_keyword=issue_keyword, start_at=start_at, end_at=end_at)
        sub_keywords = extract_sub_keywords(texts)
        upsert_issue_keyword(
            es=es,
            work_date=work_date,
            keyword=issue_keyword,
            count=count,
            sub_keywords=sub_keywords,
        )

    es.indices.refresh(index=TARGET_INDEX)
    print(f"[DONE] {work_date} issue_keyword_count indexed")
