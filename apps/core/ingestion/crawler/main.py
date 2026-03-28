import hashlib
import json
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from urllib.parse import urlencode, urljoin
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
from fastapi import FastAPI, HTTPException
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chromium.options import ChromiumOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

from apps.core.ingestion.crawler.db import create_batch_run, finish_batch_run
from apps.core.ingestion.crawler.logger import Logger
from apps.shared.config.env import ES_URL

KST = ZoneInfo("Asia/Seoul")
SCHEDULER = AsyncIOScheduler(timezone=KST)
ES_INDEX = "news_info"
BULK_CHUNK_SIZE = 200

logger = Logger().get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    SCHEDULER.add_job(
        scheduled_crawl_job,
        CronTrigger(hour=0, minute=0),
        id="naver_news_daily",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60 * 30,
    )
    SCHEDULER.start()
    logger.info("[SCHEDULER] started (00:00 Asia/Seoul)")

    try:
        yield
    finally:
        SCHEDULER.shutdown(wait=False)
        logger.info("[SCHEDULER] stopped")


app = FastAPI(lifespan=lifespan)
ES_HOST = ES_URL


def get_es() -> Elasticsearch:
    return Elasticsearch(ES_HOST)


options = ChromiumOptions()
options.add_argument("--remote-allow-origins=*")
options.add_argument("--headless=new")
options.add_argument("--window-size=1400,1000")
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_argument(
    "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def normalize_published_at(dt: str | None) -> str | None:
    if not dt:
        return None
    s = dt.strip()
    if not s:
        return None

    s = s.replace(" ", "T")
    try:
        parsed = datetime.fromisoformat(s)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.isoformat(timespec="seconds")


def parse_api_date(date: str) -> str:
    return datetime.strptime(date, "%Y-%m-%d").strftime("%Y%m%d")


def clean_doc_for_es(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if v not in (None, "")}


def build_list_url(date_yyyymmdd: str, page: int, sid1: int = 101) -> str:
    return (
        "https://news.naver.com/main/list.naver?"
        + urlencode(
            {
                "mode": "LS2D",
                "mid": "shm",
                "sid1": str(sid1),
                "date": date_yyyymmdd,
                "page": str(page),
            }
        )
    )


def make_article_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def collect_article_links(driver) -> list[str]:
    wait = WebDriverWait(driver, 15)
    wait.until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "ul.type06_headline li a[href], ul.type06 li a[href]")
        )
    )

    links = []
    for a in driver.find_elements(
        By.CSS_SELECTOR, "ul.type06_headline li a[href], ul.type06 li a[href]"
    ):
        href = a.get_attribute("href")
        if not href:
            continue

        abs_url = urljoin(driver.current_url, href)
        if (
            "news.naver.com/main/read.naver" in abs_url
            or "n.news.naver.com/article/" in abs_url
            or "n.news.naver.com/mnews/article/" in abs_url
        ):
            links.append(abs_url)

    return list(dict.fromkeys(links))


def collect_all_links_for_date(driver, date: str, max_pages: int = 1000) -> list[str]:
    all_links = []
    seen = set()

    for page in range(1, max_pages + 1):
        driver.get(build_list_url(date, page))
        links = collect_article_links(driver)
        logger.info(f"[list page {page}] links={len(links)}")

        if not links:
            break

        added = 0
        for url in links:
            if url not in seen:
                seen.add(url)
                all_links.append(url)
                added += 1

        if added == 0:
            break
        time.sleep(0.2)

    logger.info(f"[date {date}] total_links={len(all_links)}")
    return all_links


def extract_published_at(driver):
    try:
        el = driver.find_element(By.CSS_SELECTOR, "span.media_end_head_info_datestamp_time")
        return normalize_published_at(el.get_attribute("data-date-time"))
    except Exception:
        return None


def extract_press_name(driver):
    try:
        img = driver.find_element(By.CSS_SELECTOR, "a.media_end_head_top_logo img")
        return img.get_attribute("alt")
    except Exception:
        return None


def extract_title(driver):
    for sel in ["h2#title_area", "h3#articleTitle"]:
        try:
            title = driver.find_element(By.CSS_SELECTOR, sel).text.strip()
            if title:
                return title
        except Exception:
            pass
    return None


def extract_body(driver):
    wait = WebDriverWait(driver, 15)
    el = wait.until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "#dic_area, #articleBodyContents, #articeBody")
        )
    )
    return el.text.strip()


def extract_reporter(driver):
    selectors = [
        "span.byline_s",
        "span.media_end_head_journalist_name",
        "p.byline_p",
    ]
    for sel in selectors:
        try:
            el = driver.find_element(By.CSS_SELECTOR, sel)
            txt = (el.text or el.get_attribute("textContent") or "").strip()
            txt = re.sub(r"\S+@\S+", "", txt)
            txt = re.sub(r"\([^)]*\)", "", txt)
            txt = txt.replace("기자", "").strip()
            names = re.findall(r"[가-힣]{2,4}", txt)
            if names:
                return names[0]
        except Exception:
            pass
    return None


def parse_article(driver, url: str) -> dict:
    driver.get(url)
    doc = {
        "article_id": make_article_id(url),
        "published_at": extract_published_at(driver),
        "press_name": extract_press_name(driver),
        "reporter": extract_reporter(driver),
        "title": extract_title(driver),
        "body": extract_body(driver),
        "url": url,
    }
    return clean_doc_for_es(doc)


def es_exists(es: Elasticsearch, article_id: str) -> bool:
    return es.exists(index=ES_INDEX, id=article_id)


def bulk_index_news(es: Elasticsearch, docs: list[dict]) -> list[str]:
    actions = [
        {
            "_op_type": "index",
            "_index": ES_INDEX,
            "_id": d["article_id"],
            "_source": d,
        }
        for d in docs
    ]

    _, errors = bulk(es, actions, raise_on_error=False)
    reasons: list[str] = []
    if errors:
        for e in errors:
            try:
                op = next(iter(e.keys()))
                detail = e.get(op, {})
                err = detail.get("error") or {}
                reasons.append(err.get("reason") or err.get("type") or "unknown_error")
            except Exception:
                reasons.append("unknown_error")

        logger.error(f"[ES bulk errors] count={len(reasons)} sample={reasons[:3]}")

    return reasons


def flush_news_buffer(
    es: Elasticsearch,
    buffer: list[dict],
    chunk_errors: list[str],
) -> list[dict]:
    if not buffer:
        return []

    reasons = bulk_index_news(es, buffer)
    if reasons:
        chunk_errors.extend(reasons)
    return []


def build_run_message(
    total_links: int,
    crawled_ok: int,
    skipped: int,
    chunk_errors: list[str],
) -> str:
    return json.dumps(
        {
            "chunks": chunk_errors,
            "summary": {
                "total_links": total_links,
                "crawled_ok": crawled_ok,
                "skipped": skipped,
            },
        },
        ensure_ascii=False,
    )


def finish_run_if_created(
    run_id: int | None,
    end_at: datetime,
    state_code: int,
    message: str,
) -> None:
    if run_id is None:
        return
    finish_batch_run(run_id=run_id, end_at=end_at, state_code=state_code, message=message)


def create_driver() -> webdriver.Chrome:
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=options)


def should_skip_article(es: Elasticsearch, article_id: str) -> bool:
    return es_exists(es, article_id)


def is_target_date_doc(doc: dict, target_prefix: str) -> bool:
    published_at = doc.get("published_at")
    return not published_at or published_at.startswith(target_prefix)


def crawl_one_date(date: str, max_pages: int = 20) -> dict:
    es = get_es()
    if not es.ping():
        es.close()
        return {"error": "Elasticsearch is not available"}

    start_at = datetime.strptime(date, "%Y%m%d").replace(tzinfo=KST)
    end_at = start_at + timedelta(days=1)
    work_at = datetime.now(KST)

    run_id = create_batch_run(job_name="naver_news_daily", work_at=work_at, start_at=start_at)

    driver = None
    crawled_ok = 0
    skipped = 0
    parse_failed = 0
    buffer = []
    chunk_errors: list[str] = []

    try:
        driver = create_driver()

        logger.info(f"=== NAVER NEWS CRAWL START / date={date} max_pages={max_pages} ===")
        links = collect_all_links_for_date(driver, date, max_pages=max_pages)
        total_links = len(links)
        logger.info(f"total_links={total_links}")

        target_prefix = f"{date[:4]}-{date[4:6]}-{date[6:8]}"

        for url in links:
            article_id = make_article_id(url)
            if should_skip_article(es, article_id):
                skipped += 1
                continue

            try:
                doc = parse_article(driver, url)
                if not is_target_date_doc(doc, target_prefix):
                    continue

                buffer.append(doc)
                crawled_ok += 1

                if len(buffer) >= BULK_CHUNK_SIZE:
                    buffer = flush_news_buffer(es, buffer, chunk_errors)

                time.sleep(0.25)
            except Exception as e:
                parse_failed += 1
                chunk_errors.append(f"parse_error: {str(e)[:300]}")

        if buffer:
            buffer = flush_news_buffer(es, buffer, chunk_errors)

        logger.info("=== NAVER NEWS CRAWL DONE ===")

        state_code = 200 if (parse_failed == 0 and len(chunk_errors) == 0) else 300
        message = build_run_message(
            total_links=total_links,
            crawled_ok=crawled_ok,
            skipped=skipped,
            chunk_errors=chunk_errors,
        )
        finish_run_if_created(run_id=run_id, end_at=end_at, state_code=state_code, message=message)

        return {
            "run_id": run_id,
            "state_code": state_code,
            "date": date,
            "total_links": total_links,
            "crawled_ok": crawled_ok,
            "skipped_existing": skipped,
            "parse_failed": parse_failed,
            "saved": True,
        }
    except Exception as e:
        state_code = 400
        message = f"FAILED | error={str(e)[:200]}"

        try:
            finish_run_if_created(run_id=run_id, end_at=end_at, state_code=state_code, message=message)
        except Exception as finish_error:
            logger.error(f"[batch_runs] finish_batch_run failed: {finish_error}")
        raise
    finally:
        if driver is not None:
            driver.quit()
        es.close()


def scheduled_crawl_job():
    yesterday = (datetime.now(KST) - timedelta(days=1)).strftime("%Y%m%d")
    logger.info(f"[SCHEDULER] start scheduled crawl for date={yesterday}")
    result = crawl_one_date(yesterday)
    logger.info(f"[SCHEDULER] done scheduled crawl result={result}")


@app.get("/naver/news")
def crawl_naver_news(date: str, max_pages: int = 20):
    try:
        return crawl_one_date(parse_api_date(date), max_pages=max_pages)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error: {str(e)}")
