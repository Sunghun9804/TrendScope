# build_clean_text.py
# news_info (published_at 범위) -> clean_text 생성 -> clean_text index에 저장
# doc_id = news_info._id

import re
from typing import Dict, List, Any, Iterable, Tuple

from elasticsearch import helpers


NEWS_INDEX = "news_info"
CLEAN_INDEX = "clean_text"

# 필요하면 확장
KOREAN_STOPWORDS = {
    "기자", "연합뉴스", "뉴시스", "사진", "제공", "무단", "전재", "재배포", "금지",
    "오늘", "이번", "관련", "통해", "대해", "등", "및"
}

# 매우 단순한 전처리(운영 가능한 수준의 최소)
_html_tag_re = re.compile(r"<[^>]+>")
_ws_re = re.compile(r"\s+")
# 한글/영문/숫자/공백만 남기기 (필요 시 조정)
_keep_chars_re = re.compile(r"[^0-9A-Za-z가-힣\s]")

FOOTER_PATTERNS = [
    r"카카오톡\s*[^ ]*제보.*$",
    r"이메일\s*jebo[^\s]*",
    r"jebo[^\s]*",
    r"https?\s*[:/][^\s]+",
    r"talk[^\s]*\.kr[^\s]*",
    r"bbs\s*report\s*write",
    r"뉴스\s*홈페이지.*$",
    r"사이트\s*https?\s*url.*$",
]

_footer_res = [re.compile(p, re.IGNORECASE) for p in FOOTER_PATTERNS]


def remove_footer_noise(text: str) -> str:
    for r in _footer_res:
        text = r.sub(" ", text)
    return _ws_re.sub(" ", text).strip()


def normalize_text(title: str, body: str) -> str:
    t = (title or "").strip()
    b = (body or "").strip()
    text = (t + " " + b).strip()

    if not text:
        return ""

    # html 제거
    text = _html_tag_re.sub(" ", text)

    # 특수문자 제거/정리
    text = _keep_chars_re.sub(" ", text)
    text = text.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = _ws_re.sub(" ", text).strip()

    # 특수패턴 제거
    text = remove_footer_noise(text)
    if not text:
        return ""

    # 아주 단순한 불용어 제거(토큰 기반이 아니라 공백 split 기반)
    tokens = [tok for tok in text.split(" ") if tok and tok not in KOREAN_STOPWORDS]
    return " ".join(tokens).strip()


def iter_news_docs_by_published_range(
    es,
    start_dt: str,  # "YYYY-MM-DDTHH:MM:SS+09:00"
    end_dt: str,    # "YYYY-MM-DDTHH:MM:SS+09:00"
    page_size: int = 500,
) -> Iterable[Tuple[str, Dict[str, Any]]]:
    """
    news_info에서 published_at 범위로 검색해 (doc_id, _source)를 순회
    search_after 방식 (정렬: published_at asc)
    """
    search_after = None

    while True:
        body: Dict[str, Any] = {
            "size": page_size,
            "_source": ["published_at", "title", "body"],
            "query": {
                "range": {
                    "published_at": {
                        "gte": start_dt,
                        "lt": end_dt
                    }
                }
            },
            "sort": [{"published_at": "asc"}],
        }
        if search_after is not None:
            body["search_after"] = search_after

        resp = es.search(index=NEWS_INDEX, body=body)
        hits = resp["hits"]["hits"]
        if not hits:
            break

        for h in hits:
            yield h["_id"], h["_source"]

        search_after = hits[-1]["sort"]


def count_news_info_by_published_range(es, start_dt: str, end_dt: str) -> int:
    resp = es.count(
        index=NEWS_INDEX,
        query={"range": {"published_at": {"gte": start_dt, "lt": end_dt}}}
    )
    return int(resp["count"])


def count_clean_text_by_date_range(es, start_dt: str, end_dt: str) -> int:
    resp = es.count(
        index=CLEAN_INDEX,
        query={"range": {"date": {"gte": start_dt, "lt": end_dt}}}
    )
    return int(resp["count"])


def bulk_create_clean_text(es, items: List[Dict[str, Any]], max_fail_collect: int = 50) -> Dict[str, Any]:
    """
    clean_text에 bulk create (중복 덮어쓰기 방지)
    - status 기준으로 엄격 집계:
      * created: 201
      * conflict: 409 (이미 존재 → 스킵)
      * other_error: 그 외(status 400/404/500 등)
    - other_error에 대해서는 (id,status,error) 샘플을 반환 (출력은 호출자가 담당)
    """
    if not items:
        return {"created": 0, "conflict": 0, "other_error": 0, "failed_items": []}

    actions = []
    for it in items:
        doc_id = it["id"]
        actions.append({
            "_op_type": "create",
            "_index": CLEAN_INDEX,
            "_id": doc_id,
            "_source": {
                "date": it["date"],
                "clean_text": it["clean_text"]
            }
        })

    created = 0
    conflict = 0
    other_error = 0
    failed_items: List[Dict[str, Any]] = []

    for ok, item in helpers.streaming_bulk(
        es,
        actions,
        raise_on_error=False,
        raise_on_exception=False
    ):
        op = item.get("create") or item.get("index") or item.get("update") or item.get("delete")
        status = op.get("status") if op else None
        doc_id = op.get("_id") if op else None

        # ok 플래그 신뢰 금지: status로만 처리
        if status == 201:
            created += 1
        elif status == 409:
            conflict += 1
        else:
            other_error += 1
            if len(failed_items) < max_fail_collect:
                failed_items.append({
                    "id": doc_id,
                    "status": status,
                    "error": op.get("error") if op else item
                })

    return {
        "created": created,
        "conflict": conflict,
        "other_error": other_error,
        "failed_items": failed_items
    }


def build_clean_text_range(
    es,
    start_dt: str,
    end_dt: str,
    batch_size: int = 500,
    max_reason_log: int = 20,
) -> None:
    """
    news_info -> clean_text 생성/적재

    요구사항 충족:
    - "못 만든 경우" doc_id를 원인별로 로그 출력 (스킵/미생성/실패)
    - bulk 결과는 status 기준으로 엄격 집계(201/409/기타)
    - refresh 후 count로 news_info 대비 clean_text 누락 수 즉시 확인
    - try/except로 숨기지 않고, 예외는 failed로 집계
    """
    print(f"[CLEAN_TEXT START] range: {start_dt} ~ {end_dt} file={__file__}", flush=True)

    buffer: List[Dict[str, Any]] = []

    # range 전체 크기(비교용)
    total_news_in_range = count_news_info_by_published_range(es, start_dt, end_dt)

    # 처리/결과 카운터
    total_read = 0
    total_buffered = 0

    # 스킵/미생성 사유 카운트
    skipped_no_content = 0
    skipped_missing_published_at = 0
    skipped_empty_after_normalize = 0

    # 참고용 상태(생성 실패/성공과 무관한 카운트)
    noted_no_body = 0

    # 실패(문서 처리 레벨)
    failed_normalize_exception = 0

    # bulk 결과 카운트
    total_created = 0
    total_conflict = 0
    total_other_error = 0

    # 원인별 id 로그 제한 카운터(폭주 방지)
    printed_missing_published_at = 0
    printed_no_content = 0
    printed_empty_after_normalize = 0
    printed_normalize_exception = 0
    printed_bulk_other_error = 0

    # 본문
    for doc_id, src in iter_news_docs_by_published_range(es, start_dt, end_dt, page_size=batch_size):
        total_read += 1

        published_at = src.get("published_at")
        title = src.get("title", "")
        body = src.get("body", "")

        t = (title or "").strip()
        b = (body or "").strip()

        if not b:
            noted_no_body += 1

        # 1) published_at 없음 → clean_text.date 채울 수 없음 (strict 가정이면 bulk로 보내면 400 가능)
        if not published_at:
            skipped_missing_published_at += 1
            if printed_missing_published_at < max_reason_log:
                print(f"[CLEAN_TEXT SKIP] missing published_at id={doc_id}", flush=True)
                printed_missing_published_at += 1
            continue

        # 2) title+body 모두 없음
        if not t and not b:
            skipped_no_content += 1
            if printed_no_content < max_reason_log:
                print(f"[CLEAN_TEXT SKIP] no title/body id={doc_id}", flush=True)
                printed_no_content += 1
            continue

        # 3) 정규화 (예외는 실패)
        try:
            cleaned = normalize_text(t, b)
        except Exception as e:
            failed_normalize_exception += 1
            if printed_normalize_exception < max_reason_log:
                print(f"[CLEAN_TEXT FAIL] normalize exception id={doc_id} err={repr(e)}", flush=True)
                printed_normalize_exception += 1
            continue

        # 4) 정규화 후 빈 문자열
        if not cleaned:
            skipped_empty_after_normalize += 1
            if printed_empty_after_normalize < max_reason_log:
                print(f"[CLEAN_TEXT SKIP] empty after normalize id={doc_id}", flush=True)
                printed_empty_after_normalize += 1
            continue

        buffer.append({
            "id": doc_id,
            "date": published_at,
            "clean_text": cleaned
        })
        total_buffered += 1

        # 배치 flush
        if len(buffer) >= batch_size:
            r = bulk_create_clean_text(es, buffer)
            total_created += r["created"]
            total_conflict += r["conflict"]
            total_other_error += r["other_error"]

            # bulk 실패는 doc_id + status + error 출력
            for fail in r["failed_items"]:
                if printed_bulk_other_error < max_reason_log:
                    print(
                        f"[CLEAN_TEXT FAIL] bulk status={fail['status']} id={fail['id']} error={fail['error']}",
                        flush=True
                    )
                    printed_bulk_other_error += 1

            buffer.clear()

            # 진행률(너무 시끄럽지 않게 배치 단위로만)
            print(
                f"[CLEAN_TEXT PROGRESS] read={total_read} buffered={total_buffered} "
                f"created={total_created} conflict={total_conflict} other_error={total_other_error}",
                flush=True
            )

    # 잔여 flush
    if buffer:
        r = bulk_create_clean_text(es, buffer)
        total_created += r["created"]
        total_conflict += r["conflict"]
        total_other_error += r["other_error"]

        for fail in r["failed_items"]:
            if printed_bulk_other_error < max_reason_log:
                print(
                    f"[CLEAN_TEXT FAIL] bulk status={fail['status']} id={fail['id']} error={fail['error']}",
                    flush=True
                )
                printed_bulk_other_error += 1

        buffer.clear()

    # refresh 타이밍 이슈 방지: 넣었으면 바로 count로 검증
    es.indices.refresh(index=CLEAN_INDEX)

    total_clean_in_range = count_clean_text_by_date_range(es, start_dt, end_dt)
    missing_clean = max(0, total_news_in_range - total_clean_in_range)

    print("[CLEAN_TEXT BUILD DONE]", flush=True)
    print(f"- range: {start_dt} ~ {end_dt}", flush=True)
    print(f"- news_info in range (count): {total_news_in_range}", flush=True)
    print(f"- clean_text in range (count, after refresh): {total_clean_in_range}", flush=True)
    print(f"- missing(clean_text) = news_info - clean_text: {missing_clean}", flush=True)

    print(f"- read(news_info hits): {total_read}", flush=True)
    print(f"- buffered_for_bulk: {total_buffered}", flush=True)

    print("[DOC-LEVEL SKIP/FAIL BREAKDOWN]", flush=True)
    print(f"- skipped_missing_published_at: {skipped_missing_published_at}", flush=True)
    print(f"- skipped_no_content(title+body empty): {skipped_no_content}", flush=True)
    print(f"- skipped_empty_after_normalize: {skipped_empty_after_normalize}", flush=True)
    print(f"- noted_no_body(body empty): {noted_no_body}", flush=True)
    print(f"- failed_normalize_exception: {failed_normalize_exception}", flush=True)

    print("[BULK RESULT (STATUS-STRICT)]", flush=True)
    print(f"- created(status=201): {total_created}", flush=True)
    print(f"- conflict(skip existing, status=409): {total_conflict}", flush=True)
    print(f"- other_error(status!=201/409): {total_other_error}", flush=True)

    # “로그가 안 뜸” 자체도 방지: 종료 로그
    print("[CLEAN_TEXT END]", flush=True)


def build_clean_text_by_ids(es, doc_ids: List[str], batch_size: int = 500) -> None:
    """
    특정 doc_id 리스트를 받아 news_info에서 조회 후 clean_text에 생성/적재
    """
    if not doc_ids:
        print("[CLEAN_TEXT_BY_IDS] No IDs provided.")
        return

    print(f"[CLEAN_TEXT_BY_IDS START] target_count={len(doc_ids)}", flush=True)

    # 1. news_info에서 해당 ID들의 문서만 가져오기 (ids 쿼리 사용)
    query = {
        "query": {
            "ids": {
                "values": doc_ids
            }
        },
        "size": len(doc_ids),
        "_source": ["published_at", "title", "body"]
    }

    resp = es.search(index=NEWS_INDEX, body=query)
    hits = resp["hits"]["hits"]
    
    print(f"[CLEAN_TEXT_BY_IDS] Found {len(hits)} docs in {NEWS_INDEX}", flush=True)

    buffer = []
    total_created = 0
    total_conflict = 0
    total_other_error = 0

    # 2. 가져온 문서들을 순회하며 기존 정제 로직(normalize_text) 적용
    for h in hits:
        doc_id = h["_id"]
        src = h["_source"]
        
        published_at = src.get("published_at")
        title = src.get("title", "")
        body = src.get("body", "")

        # 기존 build_clean_text_range의 정제 로직과 동일하게 처리
        if not published_at or (not title and not body):
            print(f"[CLEAN_TEXT_BY_IDS SKIP] Invalid content/date id={doc_id}")
            continue

        try:
            cleaned = normalize_text(title, body)
            if not cleaned:
                print(f"[CLEAN_TEXT_BY_IDS SKIP] Empty after normalize id={doc_id}")
                continue
            
            buffer.append({
                "id": doc_id,
                "date": published_at,
                "clean_text": cleaned
            })
        except Exception as e:
            print(f"[CLEAN_TEXT_BY_IDS FAIL] Exception id={doc_id} err={repr(e)}")
            continue

        # 배치 단위 실행
        if len(buffer) >= batch_size:
            r = bulk_create_clean_text(es, buffer)
            total_created += r["created"]
            total_conflict += r["conflict"]
            total_other_error += r["other_error"]
            buffer.clear()

    # 잔여 데이터 처리
    if buffer:
        r = bulk_create_clean_text(es, buffer)
        total_created += r["created"]
        total_conflict += r["conflict"]
        total_other_error += r["other_error"]

    # 검증을 위한 리프레시
    es.indices.refresh(index=CLEAN_INDEX)
    
    print(f"[CLEAN_TEXT_BY_IDS DONE] Result: Created={total_created}, Conflict={total_conflict}, Error={total_other_error}")