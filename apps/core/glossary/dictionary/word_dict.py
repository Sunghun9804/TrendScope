from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from apps.shared.infra.db import get_db
from .word_dict_repo import WordSowRepository

router = APIRouter(prefix="/economic", tags=["Economic Terms"])

INITIAL_FILTERS = {
    "KOR": ("\uac00", "\ud7a3"),
    "ENG": ("A", "Z"),
    "NUM": ("0", "9"),
}


@router.get("/terms")
def get_terms_list(request: Request, db: Session = Depends(get_db)):
    repo = WordSowRepository(db)
    user_id = request.session.get("user_id")
    return {"status": "success", "data": repo.get_terms_with_bookmark_status(user_id) or []}


@router.get("/terms/{term_id}")
def get_term_detail(term_id: str, db: Session = Depends(get_db)):
    repo = WordSowRepository(db)
    detail = repo.get_term_detail(term_id)
    if not detail:
        raise HTTPException(status_code=404, detail="용어를 찾을 수 없습니다.")
    return {"status": "success", "data": detail}


@router.get("/terms/filter/{initial}")
def get_terms_by_filter(initial: str, db: Session = Depends(get_db)):
    repo = WordSowRepository(db)
    normalized = (initial or "").upper().strip()
    if normalized not in INITIAL_FILTERS:
        return {"status": "error", "message": "지원하지 않는 필터입니다."}

    start, end = INITIAL_FILTERS[normalized]
    return {"status": "success", "data": repo.get_terms_by_initial(start, end)}
