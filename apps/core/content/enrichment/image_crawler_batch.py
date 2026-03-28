from __future__ import annotations

import time

from apps.core.content.enrichment.image_crawler import build_http_session, fetch_image_url
from apps.core.content.enrichment.image_crawler_repo import (
    bulk_update_image_urls,
    iter_targets_missing_image,
)


def run_image_backfill_batch(
    page_size: int = 1000,
    chunk_size: int = 200,
    sleep_sec: float = 0.1,
    http_timeout: int = 10,
):
    session = build_http_session()
    total_checked = 0
    image_found = 0
    updated = 0
    buffer: list[tuple[str, str]] = []

    print("=== IMAGE BACKFILL BATCH START ===")
    for doc_id, url in iter_targets_missing_image(page_size=page_size):
        total_checked += 1

        try:
            image_url = fetch_image_url(session, url, timeout=http_timeout)
        except Exception:
            image_url = None

        if not image_url:
            continue

        image_found += 1
        buffer.append((doc_id, image_url))
        if len(buffer) >= chunk_size:
            success_count, _ = bulk_update_image_urls(buffer)
            updated += success_count
            buffer.clear()

        if total_checked % 1000 == 0:
            print(f"[PROGRESS] checked={total_checked} found={image_found} updated={updated}")
        time.sleep(sleep_sec)

    if buffer:
        success_count, _ = bulk_update_image_urls(buffer)
        updated += success_count

    print("=== IMAGE BACKFILL BATCH DONE ===")
    print(f"total_checked={total_checked}")
    print(f"image_found={image_found}")
    print(f"updated={updated}")


if __name__ == "__main__":
    run_image_backfill_batch()
