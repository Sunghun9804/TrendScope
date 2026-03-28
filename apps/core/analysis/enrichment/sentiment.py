from __future__ import annotations

import os
from pathlib import Path

import torch
import torch.nn.functional as F
from elasticsearch import Elasticsearch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from apps.shared.config.env import SENTIMENT_MODEL_DIR


MODEL_DIR = Path(SENTIMENT_MODEL_DIR)
MODEL_VERSION = "sentiment_v1"
MAX_LEN = 256

os.environ["TRANSFORMERS_OFFLINE"] = "1"

tokenizer = None
model = None
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

LABEL_MAP = {0: "negative", 1: "neutral", 2: "positive"}


def _ensure_model_loaded():
    global tokenizer, model

    if tokenizer is not None and model is not None:
        return tokenizer, model

    if not MODEL_DIR.exists():
        raise FileNotFoundError(f"sentiment model directory not found: {MODEL_DIR}")

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR), local_files_only=True)
    model.eval()
    model.to(device)
    return tokenizer, model


def predict_sentiment(text: str):
    if not isinstance(text, str):
        text = ""

    tokenizer_obj, model_obj = _ensure_model_loaded()

    encoded = tokenizer_obj(
        text,
        padding="max_length",
        truncation=True,
        max_length=MAX_LEN,
        return_tensors="pt",
    )
    encoded = {key: value.to(device) for key, value in encoded.items()}

    with torch.no_grad():
        logits = model_obj(**encoded).logits
        probs = F.softmax(logits, dim=-1)[0]

    idx = torch.argmax(probs).item()
    return {"label": LABEL_MAP[idx], "score": float(round(probs[idx].item(), 6))}


def update_sentiment(es: Elasticsearch, start_dt: str, end_dt: str):
    try:
        _ensure_model_loaded()
    except Exception as exc:
        print(f"[SENTIMENT] model unavailable: {exc}")
        return

    query = {
        "size": 10000,
        "_source": False,
        "query": {
            "bool": {
                "filter": [{"range": {"published_at": {"gte": start_dt, "lt": end_dt}}}],
                "must_not": [{"exists": {"field": "sentiment.label"}}],
            }
        },
    }

    response = es.search(index="news_info", body=query)
    doc_ids = [hit["_id"] for hit in response.get("hits", {}).get("hits", [])]
    if not doc_ids:
        print("[SENTIMENT] no targets found")
        return

    print(f"[SENTIMENT] collected={len(doc_ids)}")
    update_sentiment_by_ids(es, doc_ids)


def update_sentiment_by_ids(es: Elasticsearch, doc_ids: list[str]):
    if not doc_ids:
        print("[SENTIMENT] no ids provided")
        return

    try:
        tokenizer_obj, model_obj = _ensure_model_loaded()
    except Exception as exc:
        print(f"[SENTIMENT] model unavailable: {exc}")
        return

    # 1. mget으로 clean_text 일괄 조회
    resp = es.mget(index="clean_text", ids=doc_ids)
    valid_ids = []
    texts = []
    for doc in resp["docs"]:
        if not doc.get("found"):
            print(f"[SENTIMENT] missing clean_text: {doc['_id']}")
            continue
        clean_text = doc["_source"].get("clean_text", "")
        if not clean_text or len(clean_text.strip()) < 10:
            print(f"[SENTIMENT] empty clean_text: {doc['_id']}")
            continue
        valid_ids.append(doc["_id"])
        texts.append(clean_text)

    if not valid_ids:
        print("[SENTIMENT] no valid targets")
        return

    # 2. 배치 추론
    INFER_BATCH = 32
    all_results = []
    for i in range(0, len(texts), INFER_BATCH):
        batch = texts[i : i + INFER_BATCH]
        encoded = tokenizer_obj(
            batch,
            padding=True,
            truncation=True,
            max_length=MAX_LEN,
            return_tensors="pt",
        )
        encoded = {k: v.to(device) for k, v in encoded.items()}
        with torch.no_grad():
            logits = model_obj(**encoded).logits
            probs = F.softmax(logits, dim=-1)
        for idx_t, prob in zip(torch.argmax(probs, dim=-1), probs):
            idx = idx_t.item()
            all_results.append({"label": LABEL_MAP[idx], "score": float(round(prob[idx].item(), 6))})
        if (i // INFER_BATCH + 1) % 5 == 0:
            print(f"[SENTIMENT] inferred={min(i + INFER_BATCH, len(texts))}/{len(texts)}")

    # 3. bulk update
    from elasticsearch.helpers import bulk as es_bulk
    actions = [
        {
            "_op_type": "update",
            "_index": "news_info",
            "_id": doc_id,
            "doc": {
                "sentiment": {
                    "label": result["label"],
                    "score": result["score"],
                    "model_version": MODEL_VERSION,
                }
            },
        }
        for doc_id, result in zip(valid_ids, all_results)
    ]
    es_bulk(es, actions, raise_on_error=False)
    print(f"[SENTIMENT] updated={len(valid_ids)}")
