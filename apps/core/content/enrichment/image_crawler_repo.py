from __future__ import annotations

from typing import Any, Dict, Iterator, List, Tuple

from elasticsearch.helpers import bulk

from apps.shared.infra.elastic import get_es

INDEX = "news_info"


def build_missing_image_query() -> Dict[str, Any]:
    return {
        "bool": {
            "should": [
                {"bool": {"must_not": [{"exists": {"field": "image_url"}}]}},
                {"term": {"image_url": ""}},
            ],
            "minimum_should_match": 1,
        }
    }


def iter_targets_missing_image(page_size: int = 500) -> Iterator[Tuple[str, str]]:
    es = get_es()
    try:
        body = {
            "size": page_size,
            "_source": ["url", "article_id"],
            "sort": [{"url": "asc"}],
            "query": build_missing_image_query(),
        }

        search_after = None
        while True:
            if search_after is not None:
                body["search_after"] = search_after

            resp = es.search(index=INDEX, body=body)
            hits = (resp.get("hits") or {}).get("hits") or []
            if not hits:
                break

            for h in hits:
                doc_id = h.get("_id")
                url = (h.get("_source") or {}).get("url")
                if doc_id and url:
                    yield doc_id, url

            search_after = hits[-1].get("sort")
            if not search_after:
                break
    finally:
        es.close()


def bulk_update_image_urls(updates: List[Tuple[str, str]]) -> Tuple[int, List[str]]:
    if not updates:
        return 0, []

    es = get_es()
    try:
        actions = [
            {
                "_op_type": "update",
                "_index": INDEX,
                "_id": doc_id,
                "doc": {"image_url": image_url},
                "doc_as_upsert": False,
            }
            for (doc_id, image_url) in updates
        ]

        success_count, errors = bulk(es, actions, raise_on_error=False)
        reasons: List[str] = []
        if errors:
            for e in errors:
                try:
                    op = next(iter(e.keys()))
                    detail = e.get(op, {})
                    status = detail.get("status")
                    if status == 404:
                        continue

                    err = detail.get("error") or {}
                    reasons.append(err.get("reason") or err.get("type") or f"status_{status}")
                except Exception:
                    reasons.append("unknown_error")

        return success_count, reasons
    finally:
        es.close()
