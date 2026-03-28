from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.shared.infra.db import get_db
from apps.core.glossary.bookmarks.db import BookmarkRepository

router = APIRouter(prefix="/bookmarks", tags=["bookmark"])


def require_login(request: Request) -> str:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user_id


class BookmarkToggleReq(BaseModel):
    term_id: str
    state: Literal["ADD", "CANCEL"]


@router.get("/me")
def my_bookmarks(request: Request, db: Session = Depends(get_db)):
    repo = BookmarkRepository(db)
    return {"status": "success", "data": repo.get_my_term_bookmarks(require_login(request))}


@router.post("/toggle")
def toggle_bookmark(request: Request, data: BookmarkToggleReq, db: Session = Depends(get_db)):
    repo = BookmarkRepository(db)
    result = repo.toggle_term_bookmark(
        user_id=require_login(request),
        term_id=data.term_id,
        state=data.state,
    )
    if result.get("ok"):
        return {"status": "success", "state": result.get("state")}
    return JSONResponse(status_code=500, content={"status": "fail", "message": result.get("error", "fail")})


@router.post("/clear")
def clear_bookmarks(request: Request, db: Session = Depends(get_db)):
    repo = BookmarkRepository(db)
    return repo.clear_all_bookmarks(require_login(request))
