from __future__ import annotations

import re
import time
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from apps.core.content.enrichment.image_crawler_repo import (
    bulk_update_image_urls,
    iter_targets_missing_image,
)

router = APIRouter(prefix="/image_crawler", tags=["image_crawler"])


def build_http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://news.naver.com/",
        }
    )
    return session


def _pick_first(*vals: str | None) -> str | None:
    for value in vals:
        if value and value.strip():
            return value.strip()
    return None


def _attr(tag_html: str, attr: str) -> str | None:
    match = re.search(rf'{re.escape(attr)}\s*=\s*["\']([^"\']+)["\']', tag_html, re.IGNORECASE)
    return match.group(1) if match else None


def extract_image_url_from_html(html: str) -> str | None:
    if not html:
        return None

    for pattern in [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'https?://imgnews\.pstatic\.net/[^"\'>\s]+',
    ]:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1).strip() if match.lastindex else match.group(0).strip()

    img_match = re.search(r'<img[^>]+id=["\']img1["\'][^>]*>', html, re.IGNORECASE)
    if img_match:
        tag = img_match.group(0)
        return _pick_first(
            _attr(tag, "src"),
            _attr(tag, "data-src"),
            _attr(tag, "data-lazy-src"),
            _attr(tag, "data-original"),
        )

    block_match = re.search(r'(<span[^>]+class=["\']end_photo_org["\'][\s\S]*?</span>)', html, re.IGNORECASE)
    if block_match:
        image_match = re.search(r"<img[^>]*>", block_match.group(1), re.IGNORECASE)
        if image_match:
            tag = image_match.group(0)
            return _pick_first(
                _attr(tag, "src"),
                _attr(tag, "data-src"),
                _attr(tag, "data-lazy-src"),
                _attr(tag, "data-original"),
            )

    return None


def fetch_image_url(session: requests.Session, article_url: str, timeout: int = 10) -> str | None:
    response = session.get(article_url, timeout=timeout)
    if response.status_code != 200:
        return None
    return extract_image_url_from_html(response.text or "")


def _flush_buffer(buffer: list[tuple[str, str]], update_errors: list[str]) -> int:
    if not buffer:
        return 0

    success_count, reasons = bulk_update_image_urls(buffer)
    if reasons:
        update_errors.extend(reasons)
    buffer.clear()
    return success_count


class BackfillReq(BaseModel):
    page_size: int = 500
    chunk_size: int = 200
    sleep_sec: float = 0.05
    http_timeout: int = 10
    limit: int | None = None


@router.post("/backfill")
def image_backfill(req: BackfillReq) -> dict[str, Any]:
    try:
        session = build_http_session()
        total_targets = 0
        img_found = 0
        img_missing = 0
        updated = 0
        update_errors: list[str] = []
        buffer: list[tuple[str, str]] = []

        for doc_id, url in iter_targets_missing_image(page_size=req.page_size):
            total_targets += 1
            if req.limit is not None and total_targets > req.limit:
                break

            try:
                image_url = fetch_image_url(session, url, timeout=req.http_timeout)
            except Exception:
                image_url = None

            if not image_url:
                img_missing += 1
                continue

            img_found += 1
            buffer.append((doc_id, image_url))
            if len(buffer) >= req.chunk_size:
                updated += _flush_buffer(buffer, update_errors)

            time.sleep(req.sleep_sec)

        updated += _flush_buffer(buffer, update_errors)
        return {
            "success": True,
            "result": {
                "total_targets": total_targets,
                "img_found": img_found,
                "img_missing": img_missing,
                "updated": updated,
                "update_error_count": len(update_errors),
                "update_error_sample": update_errors[:5],
                "params": req.model_dump(),
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"image backfill failed: {exc}")
