from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import text


def _group_where(group: str) -> Tuple[str, Dict[str, Any]]:
    """
    group:
      - KOR: 한글 시작
      - ENG: 영문 시작
      - NUM: 숫자 시작
      - ""  : 전체
    """
    group = (group or "").upper().strip()
    if group == "KOR":
        # MySQL REGEXP: 한글(가-힣) 시작
        return "AND term REGEXP '^[가-힣]'", {}
    if group == "ENG":
        return "AND term REGEXP '^[A-Za-z]'", {}
    if group == "NUM":
        return "AND term REGEXP '^[0-9]'", {}
    return "", {}


def list_terms(
    db,
    group: str = "KOR",
    query: str = "",
    page: int = 1,
    size: int = 20,
    include_disabled: bool = False,
) -> Dict[str, Any]:
    """
    Returns:
      { items: [...], page, size, total }
    """
    page = max(page, 1)
    size = max(min(size, 200), 1)
    offset = (page - 1) * size

    where_group, _ = _group_where(group)
    where_disabled = "" if include_disabled else "AND state != 'DISABLED'"

    where_query = ""
    params: Dict[str, Any] = {"limit": size, "offset": offset}
    q = (query or "").strip()
    if q:
        where_query = "AND (term LIKE :q OR description LIKE :q)"
        params["q"] = f"%{q}%"

    # total
    total_sql = text(
        f"""
        SELECT COUNT(*) AS cnt
        FROM economic_terms
        WHERE 1=1
          {where_disabled}
          {where_group}
          {where_query}
        """
    )
    total_row = db.execute(total_sql, params).mappings().fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    # items
    items_sql = text(
        f"""
        SELECT term_id, term, description, state, event_at
        FROM economic_terms
        WHERE 1=1
          {where_disabled}
          {where_group}
          {where_query}
        ORDER BY term ASC
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(items_sql, params).mappings().all()
    items = [dict(r) for r in rows]

    return {"items": items, "page": page, "size": size, "total": total}


def get_term(db, term_id: str) -> Optional[Dict[str, Any]]:
    sql = text(
        """
        SELECT term_id, term, description, state, event_at
        FROM economic_terms
        WHERE term_id = :term_id
        """
    )
    row = db.execute(sql, {"term_id": term_id}).mappings().fetchone()
    return dict(row) if row else None


def insert_term(
    db,
    term_id: str,
    term: str,
    description: str,
    state: str = "ADD",
) -> None:
    sql = text(
        """
        INSERT INTO economic_terms (term_id, term, description, state)
        VALUES (:term_id, :term, :description, :state)
        """
    )
    db.execute(
        sql,
        {"term_id": term_id, "term": term, "description": description, "state": state},
    )


def update_term(
    db,
    term_id: str,
    term: Optional[str] = None,
    description: Optional[str] = None,
    state: str = "UPDATE",
) -> None:
    # 변경된 값만 업데이트
    sets = ["state = :state", "event_at = NOW()"]
    params: Dict[str, Any] = {"term_id": term_id, "state": state}

    if term is not None:
        sets.append("term = :term")
        params["term"] = term
    if description is not None:
        sets.append("description = :description")
        params["description"] = description

    sql = text(
        f"""
        UPDATE economic_terms
        SET {", ".join(sets)}
        WHERE term_id = :term_id
        """
    )
    db.execute(sql, params)


def disable_term(db, term_id: str) -> None:
    sql = text(
        """
        UPDATE economic_terms
        SET state = 'DISABLED',
            event_at = NOW()
        WHERE term_id = :term_id
        """
    )
    db.execute(sql, {"term_id": term_id})


def bulk_upsert(db, items: List[Dict[str, Any]]) -> int:
    """
    UI 설계서의 '편집/추가 모드에서 임시 반영 후 저장'을 서버에서 지원하려면,
    프론트가 items 전체를 보내고 이 API가 upsert로 반영하면 됨.
    """
    if not items:
        return 0

    sql = text(
        """
        INSERT INTO economic_terms (term_id, term, description, state, event_at)
        VALUES (:term_id, :term, :description, :state, NOW())
        ON DUPLICATE KEY UPDATE
            term = VALUES(term),
            description = VALUES(description),
            state = VALUES(state),
            event_at = NOW()
        """
    )

    n = 0
    for it in items:
        term_id = str(it.get("term_id", "")).strip()
        term = str(it.get("term", "")).strip()
        desc = str(it.get("description", "")).strip()
        state = str(it.get("state", "UPDATE")).strip() or "UPDATE"

        if not term_id or not term or not desc:
            continue

        db.execute(
            sql,
            {"term_id": term_id, "term": term, "description": desc, "state": state},
        )
        n += 1
    return n
