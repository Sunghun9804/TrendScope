from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import RedirectResponse

from apps.core.content.article.article import router as article_router
from apps.core.content.media.press_logo import router as logo_router
from apps.core.glossary.admin.term_manage import router as term_manager_router
from apps.core.glossary.bookmarks.bookmarks import router as bookmarks_router
from apps.core.glossary.dictionary.word_dict import router as word_router
from apps.core.ingestion.ops.collection import router as admin_crawl_router
from apps.core.ranking.api.dashboard import router as ranking_dashboard_router
from apps.core.ranking.api.keyword_ranking_router import router as ranking_router
from apps.core.user.auth.user_router import router as user_router
from apps.core.analysis.ops.reanalyze import router as reanalyze_router
from apps.shared.config.env import SESSION_SECRET_KEY
from apps.shared.infra.db import verify_connection as verify_db
from apps.shared.infra.elastic import verify_connection as verify_es
from apps.shared.logging.logger import Logger


logger = Logger().get_logger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR / "static"
VIEW_DIR = FRONTEND_DIR / "view"
_DEV_SESSION_SECRET = "dev-insecure-session-key-change-me"

app = FastAPI()


@app.on_event("startup")
async def _verify_infra() -> None:
    verify_db()
    verify_es()


app.include_router(bookmarks_router)
app.include_router(user_router)
app.include_router(ranking_dashboard_router)
app.include_router(ranking_router)
app.include_router(article_router)
app.include_router(admin_crawl_router)
app.include_router(reanalyze_router)
app.include_router(term_manager_router)
app.include_router(word_router)
app.include_router(logo_router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/view", StaticFiles(directory=VIEW_DIR), name="view")

if not SESSION_SECRET_KEY:
    logger.warning(
        "MBC_SESSION_SECRET_KEY is not set; using an insecure development-only fallback key."
    )

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET_KEY or _DEV_SESSION_SECRET,
    max_age=1800,
)

def _redirect(target: str) -> RedirectResponse:
    return RedirectResponse(target)


def _build_redirect_endpoint(target: str, endpoint_name: str):
    def _endpoint():
        return _redirect(target)

    _endpoint.__name__ = endpoint_name
    return _endpoint


_PAGE_REDIRECTS = {
    "/": "/view/home.html",
    "/main": "/view/main.html",
    "/main2": "/view/main.html#main2",
    "/main3": "/view/main.html#main3",
    "/my_page": "/view/my_page.html",
    "/login": "/view/login.html",
    "/info_edit": "/view/info_edit.html",
    "/find_id": "/view/find_id.html",
    "/find_pw": "/view/find_pw.html",
    "/pw_change": "/view/pw_change.html",
    "/signup": "/view/signup.html",
    "/word": "/view/word.html",
}


for route_path, target_path in _PAGE_REDIRECTS.items():
    endpoint_name = f"redirect_{route_path.strip('/').replace('/', '_') or 'root'}"
    app.add_api_route(
        route_path,
        endpoint=_build_redirect_endpoint(target_path, endpoint_name),
        methods=["GET"],
    )
