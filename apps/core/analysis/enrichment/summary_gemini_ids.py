from __future__ import annotations

import datetime
import random
import time

from elasticsearch import Elasticsearch
from google import genai
from google.genai import types

from apps.shared.config.env import GEMINI_API_KEY


def _get_client():
    if not GEMINI_API_KEY:
        return None
    return genai.Client(api_key=GEMINI_API_KEY)


def summarize_news_by_ids(es: Elasticsearch, doc_ids: list[str]):
    client = _get_client()
    if client is None:
        print("[SUMMARY] GEMINI_API_KEY is not set; skipping summary generation")
        return

    model_name = "gemini-2.5-flash-lite"
    current_version = f"{model_name}-{datetime.datetime.now().strftime('%Y%m%d')}-formal"

    for doc_id in doc_ids:
        time.sleep(0.5)
        for attempt in range(3):
            try:
                clean_response = es.get(index="clean_text", id=doc_id)
                text = clean_response["_source"].get("clean_text", "")
                if not text or len(text.strip()) < 50:
                    print(f"[SUMMARY] skipped_short_text={doc_id}")
                    break

                response = client.models.generate_content(
                    model=model_name,
                    contents=f"Article text:\n{text[:1500]}",
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            "Summarize the article in a concise formal Korean report style. "
                            "Return a short main point and supporting reasons."
                        ),
                        temperature=0.1,
                        max_output_tokens=500,
                        safety_settings=[
                            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
                            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                        ],
                    ),
                )

                if not response.candidates:
                    print(f"[SUMMARY] no_candidate={doc_id}")
                    break

                es.update(
                    index="news_info",
                    id=doc_id,
                    body={
                        "doc": {
                            "summary": {
                                "summary_text": response.text.strip(),
                                "model_version": current_version,
                            }
                        }
                    },
                )
                print(f"[SUMMARY] updated={doc_id}")
                break
            except Exception as exc:
                if "503" in str(exc) or "overloaded" in str(exc):
                    wait = (attempt + 1) * 2 + random.random()
                    print(f"[SUMMARY] overloaded retry in {wait:.1f}s for {doc_id}")
                    time.sleep(wait)
                    continue
                print(f"[SUMMARY] failed {doc_id}: {exc}")
                break
