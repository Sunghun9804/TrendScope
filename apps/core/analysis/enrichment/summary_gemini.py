import datetime
import time
import random
from google import genai
from google.genai import types
from elasticsearch import Elasticsearch
from elasticsearch.helpers import scan
from apps.shared.config.env import GEMINI_API_KEY as CONFIG_GEMINI_API_KEY

# 1. 설정
GEMINI_API_KEY = CONFIG_GEMINI_API_KEY
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

def summarize_news(es: Elasticsearch, start_date: str, end_date: str):
    model_name = "gemini-2.5-flash-lite"
    current_version = f"{model_name}-{datetime.datetime.now().strftime('%Y%m%d')}-formal"
    if client is None:
        print("[SUMMARY] GEMINI_API_KEY is not set; skipping summary generation")
        return

    # 사용자님의 코드 중 해당 부분
    query_news = {
        "query": {
            "range": {
                "published_at": {
                    "gte": start_date,  # 시작일 (예: 2026-01-10)
                    "lte": end_date     # 종료일 (예: 2026-01-12)
                }
            }
        }
    }
    # (쿼리 및 scan 로직 동일)
    docs = scan(es, index="news_info", query=query_news)

    for hit in docs:
        doc_id = hit['_id']

        # 이미 요약된 기사 스킵
        if hit['_source'].get('summary', {}).get('summary_text'):
            continue

        time.sleep(7)  # free tier 분당 10건 한도 → 7초 간격 ~8건/분

        for attempt in range(5):
            try:
                clean_resp = es.get(index="clean_text", id=doc_id)
                text = clean_resp['_source'].get('clean_text', '')

                if not text or len(text.strip()) < 50:
                    break

                # [최적화] 입력 1,500자로 상향 (격식 있는 문장을 위해 정보량 확보)
                truncated_text = text[:1500]

                # [프롬프트 수정] '~함' 제거, 보고서형 명사구 종결 지시
                response = client.models.generate_content(
                    model=model_name,
                    contents=f"기사 내용:\n{truncated_text}",
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            "너는 전문적인 경제 뉴스 분석가야. "
                            "격식 있는 비즈니스 보고서 문체를 사용하되, 문장은 명사형 핵심 키워드로 종결해라. "
                            "예시: '주가 반등 전망', '실적 개선 기대', '리스크 확대 우려' "
                            "다른 설명 없이 반드시 다음 형식을 지켜라.\n\n"
                            "핵심 주장: [격식 있는 한 문장 요약]\n"
                            "근거:\n"
                            "- [전문 용어를 사용한 핵심 지표 및 근거]\n"
                            "- [전문 용어를 사용한 핵심 지표 및 근거]"
                        ),
                        temperature=0.1,
                        max_output_tokens=500, # 격식 있는 문장을 위해 약간 상향
                        safety_settings=[
                            types.SafetySetting(category='HARM_CATEGORY_HARASSMENT', threshold='OFF'),
                            types.SafetySetting(category='HARM_CATEGORY_HATE_SPEECH', threshold='OFF'),
                            types.SafetySetting(category='HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold='OFF'),
                            types.SafetySetting(category='HARM_CATEGORY_DANGEROUS_CONTENT', threshold='OFF'),
                        ]
                    )
                )

                if response.candidates:
                    finish_reason = response.candidates[0].finish_reason
                    summary_text = response.text.strip()

                    es.update(
                        index="news_info",
                        id=doc_id,
                        body={
                            "doc": {
                                "summary": {
                                    "summary_text": summary_text,
                                    "model_version": current_version
                                }
                            }
                        }
                    )
                    print(f"[완료] doc_id: {doc_id} ({finish_reason})")
                    break

            except Exception as e:
                err = str(e)
                if "429" in err or "RESOURCE_EXHAUSTED" in err:
                    import re as _re
                    m = _re.search(r'retry in ([\d.]+)s', err)
                    wait = float(m.group(1)) + 3 if m else 20
                    print(f"⚠️ Rate limit(429). {wait:.0f}초 후 재시도... (attempt {attempt+1}/5)")
                    time.sleep(wait)
                elif "503" in err or "overloaded" in err:
                    wait = (attempt + 1) * 2 + random.random()
                    print(f"⚠️ 서버 과부하(503). {wait:.1f}초 후 재시도... ({doc_id})")
                    time.sleep(wait)
                else:
                    print(f"[실패] doc_id: {doc_id} | 이유: {err}")
                    break
