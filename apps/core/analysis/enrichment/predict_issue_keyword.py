# predict_issue_keyword.py
# clean_text(date 범위) -> 이슈 키워드 예측 -> news_info.keywords 업데이트 (score 없음)

import os
import re
from typing import List, Tuple

import joblib
from sentence_transformers import SentenceTransformer
from elasticsearch import helpers
from apps.shared.config.env import ISSUE_CLASSIFIER_MODEL_DIR


CLEAN_INDEX = "clean_text"
NEWS_INDEX = "news_info"

MODEL_DIR = str(ISSUE_CLASSIFIER_MODEL_DIR)
CLASSIFIER_PATH = os.path.join(MODEL_DIR, "classifier.joblib")
ENCODER_PATH = os.path.join(MODEL_DIR, "label_encoder.joblib")
EMB_NAME_PATH = os.path.join(MODEL_DIR, "embedding_model_name.txt")

MODEL_VERSION = "issue_classifier2_v2"


# -----------------------------
# 최소 전처리 (예측용)
# -----------------------------
_ws_re = re.compile(r"\s+")
_keep_re = re.compile(r"[^0-9A-Za-z가-힣\s]")


def normalize_for_predict(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    text = _keep_re.sub(" ", text)
    text = _ws_re.sub(" ", text).strip()
    return text


# -----------------------------
# 모델 로딩
# -----------------------------
def load_predict_models():
    clf = joblib.load(CLASSIFIER_PATH)
    label_encoder = joblib.load(ENCODER_PATH)

    with open(EMB_NAME_PATH, "r", encoding="utf-8") as f:
        emb_name = f.read().strip()

    embed_model = SentenceTransformer(emb_name)
    return clf, label_encoder, embed_model


# -----------------------------
# clean_text 조회 (날짜 범위)
# -----------------------------
def scan_clean_text_by_date_range(
    es,
    start_dt: str,
    end_dt: str,
    page_size: int = 500,
):
    """
    clean_text에서 date 범위로 문서 스캔
    yield: (doc_id, clean_text)
    """
    query = {
        "query": {
            "range": {
                "date": {
                    "gte": start_dt,
                    "lt": end_dt
                }
            }
        },
        "_source": ["clean_text"]
    }

    for hit in helpers.scan(
        client=es,
        index=CLEAN_INDEX,
        query=query,
        size=page_size,
        scroll="2m",
    ):
        yield hit["_id"], hit["_source"].get("clean_text", "")


# -----------------------------
# news_info 업데이트 (score 없음)
# -----------------------------
def bulk_update_news_keywords(es, rows):
    actions = []
    for doc_id, label in rows:
        actions.append({
            "_op_type": "update",
            "_index": "news_info",
            "_id": doc_id,
            "doc": {
                "keywords": {
                    "label": label,
                    "model_version": MODEL_VERSION,
                }
            }
        })

    updated = 0
    failed = 0
    printed = 0

    for ok, item in helpers.streaming_bulk(
        client=es,
        actions=actions,
        raise_on_error=False,
        raise_on_exception=False,
    ):
        if ok:
            updated += 1
        else:
            failed += 1
            if printed < 5:
                # 실패 원인 전체를 찍어야 확정 가능
                print("[BULK FAIL]", item)
                printed += 1

    es.indices.refresh(index="news_info")
    return updated, failed

def count_news_info_by_published_range(es, start_dt: str, end_dt: str) -> int:
    resp = es.count(
        index="news_info",
        query={"range": {"published_at": {"gte": start_dt, "lt": end_dt}}}
    )
    return int(resp["count"])

def count_clean_text_by_date_range(es, start_dt: str, end_dt: str) -> int:
    resp = es.count(
        index="clean_text",
        query={"range": {"date": {"gte": start_dt, "lt": end_dt}}}
    )
    return int(resp["count"])

# -----------------------------
# 메인 predict 함수
# -----------------------------
def predict_issue_keyword_range(
    es,
    start_dt: str,
    end_dt: str,
    batch_size: int = 256,
):
    clf, label_encoder, embed_model = load_predict_models()

    buf_ids = []
    buf_texts = []

    total_read = 0
    total_empty = 0
    total_updated = 0
    total_failed = 0

    for doc_id, clean_text in scan_clean_text_by_date_range(es, start_dt, end_dt):
        total_read += 1

        text = normalize_for_predict(clean_text)
        if not text:
            total_empty += 1
            continue

        buf_ids.append(doc_id)
        buf_texts.append(text)

        if len(buf_texts) >= batch_size:
            u, f = _flush_predict(
                es, clf, label_encoder, embed_model, buf_ids, buf_texts
            )
            total_updated += u
            total_failed += f
            buf_ids.clear()
            buf_texts.clear()

    if buf_texts:
        u, f = _flush_predict(
            es, clf, label_encoder, embed_model, buf_ids, buf_texts
        )
        total_updated += u
        total_failed += f

    
    total_news = count_news_info_by_published_range(es, start_dt, end_dt)
    total_clean = count_clean_text_by_date_range(es, start_dt, end_dt)

    # total_read는 scan_clean_text로 읽은 수(=처리 후보)
    missing_clean = max(0, total_news - total_clean)

    print("[PREDICT DONE]")
    print(f"- news_info in range: {total_news}")
    print(f"- clean_text in range: {total_clean}")
    print(f"- missing(clean_text): {missing_clean}")
    print(f"- read(clean_text): {total_read}")
    print(f"- empty(skip): {total_empty}")
    print(f"- updated(news_info): {total_updated}")
    print(f"- failed: {total_failed}")


def _flush_predict(
    es,
    clf,
    label_encoder,
    embed_model,
    doc_ids: List[str],
    texts: List[str],
):
    X = embed_model.encode(texts, batch_size=32, show_progress_bar=False)
    pred_idx = clf.predict(X)                  
    labels = label_encoder.inverse_transform(pred_idx)
    rows = list(zip(doc_ids, labels))
    return bulk_update_news_keywords(es, rows)


def _chunked(lst: List[str], size: int):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def fetch_clean_text_by_ids(es, doc_ids: List[str], mget_size: int = 500) -> Tuple[int, List[Tuple[str, str]]]:
    """
    clean_text에서 doc_id 리스트를 mget으로 가져온다.
    반환:
      - missing_count: clean_text 문서 자체가 없는 개수
      - found: [(doc_id, clean_text_value), ...]
    """
    missing = 0
    found: List[Tuple[str, str]] = []

    for chunk in _chunked(doc_ids, mget_size):
        resp = es.mget(index=CLEAN_INDEX, ids=chunk)
        for d in resp.get("docs", []):
            _id = d.get("_id")
            if not d.get("found"):
                missing += 1
                continue

            src = d.get("_source") or {}
            ct = src.get("clean_text", "")
            found.append((_id, ct))

    return missing, found


def predict_issue_keyword_ids(
    es,
    doc_ids: List[str],
    batch_size: int = 256,
    mget_size: int = 500,
    max_reason_log: int = 20,
):
    """
    clean_text를 날짜 range가 아니라 doc_id 리스트 기반으로 가져와 예측 후 news_info 업데이트.
    - clean_text 문서가 없는 id는 missing으로 집계 + 일부 로그
    - clean_text는 있는데 정규화 후 빈 문자열이면 empty로 집계 + 일부 로그
    - update bulk 실패는 기존 bulk_update_news_keywords의 [BULK FAIL]로 샘플 출력
    """
    clf, label_encoder, embed_model = load_predict_models()

    total_input_ids = len(doc_ids)
    total_missing_clean_doc = 0
    total_read_found = 0
    total_empty = 0
    total_updated = 0
    total_failed = 0

    printed_missing = 0
    printed_empty = 0

    # 1) clean_text 가져오기
    missing_cnt, pairs = fetch_clean_text_by_ids(es, doc_ids, mget_size=mget_size)
    total_missing_clean_doc += missing_cnt

    # missing id도 “어떤 게 없는지” 찍고 싶으면 아래처럼 2차 확인이 필요하지만
    # mget 응답 docs를 그대로 순회하면 id를 찍을 수 있다. (fetch 함수에서 찍기보다 여기서 찍는 게 깔끔)
    # -> 여기서는 성능/구조 유지 위해 fetch_clean_text_by_ids에서 missing만 count 했으므로,
    #    missing id까지 반드시 로그가 필요하면 fetch_clean_text_by_ids를 (missing_ids 리스트 반환)으로 확장하세요.

    # 2) 예측 버퍼
    buf_ids: List[str] = []
    buf_texts: List[str] = []

    for _id, clean_text in pairs:
        total_read_found += 1

        text = normalize_for_predict(clean_text)
        if not text:
            total_empty += 1
            if printed_empty < max_reason_log:
                print(f"[PREDICT SKIP] empty after normalize id={_id}", flush=True)
                printed_empty += 1
            continue

        buf_ids.append(_id)
        buf_texts.append(text)

        if len(buf_texts) >= batch_size:
            u, f = _flush_predict(es, clf, label_encoder, embed_model, buf_ids, buf_texts)
            total_updated += u
            total_failed += f
            buf_ids.clear()
            buf_texts.clear()

    if buf_texts:
        u, f = _flush_predict(es, clf, label_encoder, embed_model, buf_ids, buf_texts)
        total_updated += u
        total_failed += f

    print("[PREDICT DONE - BY IDS]")
    print(f"- input_ids: {total_input_ids}")
    print(f"- clean_text found: {total_read_found}")
    print(f"- clean_text missing(doc not found): {total_missing_clean_doc}")
    print(f"- empty(skip after normalize): {total_empty}")
    print(f"- updated(news_info): {total_updated}")
    print(f"- failed: {total_failed}")

from datetime import datetime, timedelta
def find_missing_keywords(es, date: str):
    """
    date (YYYY-MM-DD) 기준으로
    [date ~ date+1일) 범위에서
    keywords가 없는 news_info 문서의 id 리스트 반환
    """
    start_dt = f"{date}T00:00:00+09:00"
    end_dt = f'{(datetime.fromisoformat(date) + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")}+09:00'
    print(f"\n{end_dt}\n")
    resp = es.search(
        index="news_info",
        _source=False,
        query={
            "bool": {
                "filter": [
                    {
                        "range": {
                            "published_at": {
                                "gte": start_dt,
                                "lt": end_dt
                            }
                        }
                    }
                ],
                "must_not": [
                    { "exists": { "field": "keywords" } }
                ]
            }
        }
    )

    return [hit["_id"] for hit in resp["hits"]["hits"]]
