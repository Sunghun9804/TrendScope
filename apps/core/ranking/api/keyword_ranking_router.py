from fastapi import APIRouter, HTTPException, Query

from apps.shared.infra.elastic import get_es
from apps.shared.logging.logger import Logger
import apps.core.ranking.api.keyword_ranking as service

logger = Logger().get_logger(__name__)
router = APIRouter(prefix="/api/keywords", tags=["keywords"])


@router.get("/ranking")
def issue_keyword_ranking(
    mode: str = Query(..., pattern="^(day|week|month|year|range)$", description="day|week|month|year|range"),
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    size: int = Query(10, ge=1, le=50, description="Top N"),
):
    es = get_es()
    try:
        result = service.get_keyword_ranking(es, mode=mode, start=start, end=end, size=size)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("[issue_keyword_ranking] failed")
        raise HTTPException(status_code=500, detail="keyword ranking lookup failed")
    finally:
        es.close()
