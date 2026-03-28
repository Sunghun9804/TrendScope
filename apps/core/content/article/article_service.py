import re

from fastapi import HTTPException

from apps.core.content.article.article_repo import (
    fetch_article_by_id,
    fetch_articles_by_keyword,
    fetch_articles_by_keyword_range,
    fetch_sentiment_summary,
)


def _extract_hits(res: dict) -> tuple[list[dict], int]:
    hits = (res.get("hits") or {}).get("hits") or []
    total = ((res.get("hits") or {}).get("total") or {}).get("value", 0)
    return hits, total


def _format_article_card(src: dict) -> dict:
    trust = src.get("trust") or {}
    sentiment_obj = src.get("sentiment") or {}
    body = src.get("body", "")
    published_at = (src.get("published_at") or "")[:10]
    return {
        "press": src.get("press_name"),
        "title": src.get("title"),
        "summary": (body[:120] + "...") if body else "",
        "published_at": published_at,
        "sentiment": sentiment_obj.get("label"),
        "sentiment_score": sentiment_obj.get("score"),
        "trust_label": trust.get("label"),
        "trust_score": trust.get("score"),
        "url": src.get("url"),
    }


def get_articles_by_keyword(
    keyword: str,
    date: str,
    sentiment: str,
    page: int,
    size: int,
    orderby: str,
):
    hits, total = _extract_hits(fetch_articles_by_keyword(keyword, date, sentiment, page, size, orderby))
    articles = [_format_article_card(hit["_source"]) for hit in hits]
    return {
        "success": True,
        "keyword": keyword,
        "sentiment": sentiment,
        "total": total,
        "page": page,
        "size": size,
        "orderby": orderby,
        "articles": articles,
        "items": articles,
    }


def make_summary_preview(summary_text: str, max_len: int = 80) -> str:
    text = (summary_text or "").strip()
    if not text:
        return ""

    match = re.search(r"핵심\s*주장\s*:\s*(.+)", text)
    if match:
        line = match.group(1).strip()
        return f"{line[:max_len]}..." if len(line) > max_len else line

    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if not first_line:
        return ""
    return f"{first_line[:max_len]}..." if len(first_line) > max_len else first_line


def get_articles_by_keyword_range(keyword, start, end, sentiment, page, size, orderby):
    hits, total = _extract_hits(fetch_articles_by_keyword_range(keyword, start, end, sentiment, page, size, orderby))

    items = []
    for hit in hits:
        src = hit.get("_source") or {}
        sent = src.get("sentiment") or {}
        trust = src.get("trust") or {}
        published_at = src.get("published_at") or ""
        summary_obj = src.get("summary") or {}
        summary_text = summary_obj.get("summary_text") or ""

        items.append(
            {
                "doc_id": hit.get("_id"),
                "press": src.get("press_name"),
                "title": src.get("title"),
                "published_at": published_at[:10] if published_at else "",
                "sentiment": sent.get("label"),
                "sentiment_score": sent.get("score"),
                "trust_score": trust.get("score"),
                "trust_label": trust.get("label"),
                "url": src.get("url"),
                "image_url": src.get("image_url") or "",
                "body": src.get("body") or "",
                "summary_preview": make_summary_preview(summary_text, max_len=80),
            }
        )

    return {
        "success": True,
        "keyword": keyword,
        "start": start,
        "end": end,
        "sentiment": sentiment,
        "total": total,
        "page": page,
        "size": size,
        "orderby": orderby,
        "items": items,
    }


def get_sentiment_summary(keyword: str, start: str, end: str):
    res = fetch_sentiment_summary(keyword, start, end)
    buckets = ((res.get("aggregations") or {}).get("sentiment_counts") or {}).get("buckets") or []

    counts = {"positive": 0, "neutral": 0, "negative": 0}
    for bucket in buckets:
        label = bucket.get("key")
        if label in counts:
            counts[label] = int(bucket.get("doc_count", 0))

    return {
        "success": True,
        "keyword": keyword,
        "start": start,
        "end": end,
        "positive": counts["positive"],
        "neutral": counts["neutral"],
        "negative": counts["negative"],
    }


def get_article_summary_by_doc_id(doc_id: str) -> str:
    doc = fetch_article_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="NOT_FOUND")

    src = doc.get("_source") or {}
    summary_obj = src.get("summary") or {}
    return summary_obj.get("summary_text") or ""
