from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from apps.core.content.article.article_service import (
    get_article_summary_by_doc_id,
    get_articles_by_keyword,
    get_articles_by_keyword_range,
    get_sentiment_summary,
)

router = APIRouter(prefix="/articles", tags=["Articles"])


def require_login(request: Request) -> str:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="LOGIN_REQUIRED")
    return user_id


@router.get("/by-keyword")
def articles_by_keyword(
    keyword: str,
    date: str,
    sentiment: str = "all",
    page: int = 1,
    size: int = 10,
    orderby: Literal["latest", "old", "trust_high", "trust_low"] = "latest",
):
    return get_articles_by_keyword(keyword, date, sentiment, page, size, orderby)


@router.get("/sentiment-sum")
def sentiment_sum(keyword: str, start: str, end: str):
    return get_sentiment_summary(keyword=keyword, start=start, end=end)


@router.get("/list")
def list_articles(
    keyword: str,
    start: str,
    end: str,
    sentiment: str = "all",
    page: int = 1,
    size: int = 5,
    orderby: Literal["latest", "old", "trust_high", "trust_low"] = "latest",
):
    return get_articles_by_keyword_range(
        keyword=keyword,
        start=start,
        end=end,
        sentiment=sentiment,
        page=page,
        size=size,
        orderby=orderby,
    )


@router.get("/{doc_id}/summary")
def get_article_summary(doc_id: str, request: Request):
    require_login(request)
    return {"success": True, "summary": get_article_summary_by_doc_id(doc_id)}
