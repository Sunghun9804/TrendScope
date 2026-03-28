from __future__ import annotations

import torch
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm
from transformers import ElectraForSequenceClassification, ElectraTokenizerFast

from apps.shared.config.env import TRUST_MODEL_DIR


NEWS_INDEX = "news_info"
CLEAN_INDEX = "clean_text"
MODEL_DIR = str(TRUST_MODEL_DIR)
MAX_LEN = 512
BATCH_SIZE = 32
MODEL_VERSION = "trust_electra20251209"


class InferenceDataset(Dataset):
    def __init__(self, texts, tokenizer, max_len=256):
        self.texts = texts
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        encoded = self.tokenizer(
            self.texts[idx],
            add_special_tokens=True,
            padding="max_length",
            truncation=True,
            max_length=self.max_len,
            return_tensors="pt",
        )
        return {
            "input_ids": encoded["input_ids"].squeeze(0),
            "attention_mask": encoded["attention_mask"].squeeze(0),
        }


def fetch_news_by_date_range(es, start_at, end_at):
    query = {
        "query": {
            "bool": {
                "filter": [{"range": {"published_at": {"gte": start_at, "lt": end_at}}}],
                "must_not": [{"exists": {"field": "trust.label"}}],
            }
        }
    }

    page_size = 500
    scroll_time = "2m"
    response = es.search(index=NEWS_INDEX, body=query, size=page_size, scroll=scroll_time)

    scroll_id = response["_scroll_id"]
    hits = response["hits"]["hits"]
    all_docs = hits.copy()

    while hits:
        response = es.scroll(scroll_id=scroll_id, scroll=scroll_time)
        scroll_id = response["_scroll_id"]
        hits = response["hits"]["hits"]
        all_docs.extend(hits)

    es.clear_scroll(scroll_id=scroll_id)
    return all_docs


def _load_model():
    if not TRUST_MODEL_DIR.exists():
        raise FileNotFoundError(f"trust model directory not found: {TRUST_MODEL_DIR}")

    tokenizer = ElectraTokenizerFast.from_pretrained(str(TRUST_MODEL_DIR), local_files_only=True)
    model = ElectraForSequenceClassification.from_pretrained(str(TRUST_MODEL_DIR), local_files_only=True)
    model.eval()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)  # type: ignore[arg-type]
    return tokenizer, model, device


def _run_inference(texts: list[str]):
    tokenizer, model, device = _load_model()
    dataset = InferenceDataset(texts, tokenizer, MAX_LEN)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=False)

    scores: list[float] = []
    with torch.no_grad():
        for batch in tqdm(loader, desc="Infer Trust"):
            outputs = model(
                input_ids=batch["input_ids"].to(device),
                attention_mask=batch["attention_mask"].to(device),
            )
            probs = torch.softmax(outputs.logits, dim=-1)
            scores.extend(probs[:, 1].detach().cpu().numpy().tolist())
    return scores


def trust_analyze(es, start_at, end_at):
    try:
        _load_model()
    except Exception as exc:
        print(f"[TRUST] model unavailable: {exc}")
        return

    news_docs = fetch_news_by_date_range(es, start_at, end_at)
    if not news_docs:
        print("[TRUST] no news in range")
        return

    article_ids = []
    titles = []
    for doc in news_docs:
        source = doc["_source"]
        article_ids.append(source["article_id"])
        titles.append(source.get("title", ""))

    clean_response = es.mget(index=CLEAN_INDEX, ids=article_ids)
    texts = []
    valid_article_ids = []

    for idx, doc in enumerate(clean_response["docs"]):
        if not doc["found"]:
            continue
        clean_text = doc["_source"]["clean_text"]
        texts.append(f"{titles[idx]} [SEP] {clean_text}")
        valid_article_ids.append(article_ids[idx])

    if not texts:
        print("[TRUST] no clean_text matches")
        return

    trust_scores = _run_inference(texts)
    for article_id, score in zip(valid_article_ids, trust_scores):
        es.update(
            index=NEWS_INDEX,
            id=article_id,
            doc={
                "trust": {
                    "label": "reliable" if score >= 0.5 else "unreliable",
                    "score": float(score),
                    "model_version": MODEL_VERSION,
                }
            },
        )

    print(f"[TRUST] updated={len(valid_article_ids)}")


def trust_analyze_by_ids(es, doc_ids: list[str]):
    if not doc_ids:
        print("[TRUST] no ids provided")
        return

    try:
        _load_model()
    except Exception as exc:
        print(f"[TRUST] model unavailable: {exc}")
        return

    news_response = es.mget(index=NEWS_INDEX, ids=doc_ids)
    titles = []
    valid_article_ids = []

    for doc in news_response["docs"]:
        if not doc["found"]:
            continue
        source = doc["_source"]
        titles.append(source.get("title", ""))
        valid_article_ids.append(source["article_id"])

    if not valid_article_ids:
        print("[TRUST] no matching news docs")
        return

    clean_response = es.mget(index=CLEAN_INDEX, ids=valid_article_ids)
    texts = []
    final_article_ids = []

    for idx, doc in enumerate(clean_response["docs"]):
        if not doc["found"]:
            continue
        clean_text = doc["_source"]["clean_text"]
        texts.append(f"{titles[idx]} [SEP] {clean_text}")
        final_article_ids.append(valid_article_ids[idx])

    if not texts:
        print("[TRUST] no matching clean_text docs")
        return

    trust_scores = _run_inference(texts)
    for article_id, score in zip(final_article_ids, trust_scores):
        es.update(
            index=NEWS_INDEX,
            id=article_id,
            doc={
                "trust": {
                    "label": "reliable" if score >= 0.5 else "unreliable",
                    "score": float(score),
                    "model_version": MODEL_VERSION,
                }
            },
        )

    print(f"[TRUST] updated_by_ids={len(final_article_ids)}")
