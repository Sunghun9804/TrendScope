from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from apps.shared.infra.db import get_db
from apps.core.glossary.repository import economic_term_repo
from .admin_deps import admin_required

router = APIRouter(prefix="/admin/terms", tags=["admin"])


def _require_text(value: Any, detail: str) -> str:
    text_value = str(value or "").strip()
    if not text_value:
        raise HTTPException(status_code=400, detail=detail)
    return text_value


@router.get("/")
def list_terms(
    group: str = "KOR",
    query: str = "",
    page: int = 1,
    size: int = 20,
    include_disabled: bool = False,
    _: None = Depends(admin_required),
):
    db = get_db()
    try:
        return economic_term_repo.list_terms(
            db,
            group=group,
            query=query,
            page=page,
            size=size,
            include_disabled=include_disabled,
        )
    finally:
        db.close()


@router.get("/{term_id}")
def term_detail(term_id: str, _: None = Depends(admin_required)):
    db = get_db()
    try:
        row = economic_term_repo.get_term(db, term_id=term_id)
        if not row:
            raise HTTPException(status_code=404, detail="term not found")
        return row
    finally:
        db.close()


@router.post("/")
def add_term(payload: dict[str, Any], _: None = Depends(admin_required)):
    term = _require_text(payload.get("term"), "term required")
    description = _require_text(payload.get("description"), "description required")
    term_id = str(payload.get("term_id", "")).strip() or uuid.uuid4().hex

    db = get_db()
    try:
        economic_term_repo.insert_term(
            db,
            term_id=term_id,
            term=term,
            description=description,
            state="ADD",
        )
        db.commit()
        return {"ok": True, "item": economic_term_repo.get_term(db, term_id)}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/{term_id}")
def update_term(term_id: str, payload: dict[str, Any], _: None = Depends(admin_required)):
    term = payload.get("term")
    description = payload.get("description")
    state = str(payload.get("state", "UPDATE")).strip() or "UPDATE"

    if term is not None:
        term = _require_text(term, "term cannot be empty")
    if description is not None:
        description = _require_text(description, "description cannot be empty")

    db = get_db()
    try:
        if not economic_term_repo.get_term(db, term_id):
            raise HTTPException(status_code=404, detail="term not found")

        economic_term_repo.update_term(
            db,
            term_id=term_id,
            term=term,
            description=description,
            state=state,
        )
        db.commit()
        return {"ok": True, "item": economic_term_repo.get_term(db, term_id)}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/{term_id}")
def disable_term(term_id: str, _: None = Depends(admin_required)):
    db = get_db()
    try:
        if not economic_term_repo.get_term(db, term_id):
            raise HTTPException(status_code=404, detail="term not found")

        economic_term_repo.disable_term(db, term_id)
        db.commit()
        return {"ok": True}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.post("/save")
def bulk_save(payload: dict[str, Any], _: None = Depends(admin_required)):
    items = payload.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items(list) required")

    db = get_db()
    try:
        count = economic_term_repo.bulk_upsert(db, items)
        db.commit()
        return {"ok": True, "count": count}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()
