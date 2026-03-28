from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Literal

import apps.core.ranking.repository.issue_keyword_repo as repo

Mode = Literal["day", "week", "month", "year", "range"]


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _month_start_end(target: date) -> tuple[date, date]:
    last_day = monthrange(target.year, target.month)[1]
    return date(target.year, target.month, 1), date(target.year, target.month, last_day)


def _prev_month_anchor(target: date) -> date:
    if target.month == 1:
        return date(target.year - 1, 12, 1)
    return date(target.year, target.month - 1, 1)


def _year_start_end(target: date) -> tuple[date, date]:
    return date(target.year, 1, 1), date(target.year, 12, 31)


def _prev_same_length_range(start: date, end: date) -> tuple[date, date]:
    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    return prev_start, prev_end


def calc_change_rate(current_count: int, prev_count: int) -> int | None:
    if prev_count == 0:
        return None
    return round(((current_count - prev_count) / prev_count) * 100)


def calc_rank_change(current_rank: int, prev_rank: int | None) -> int | None:
    if prev_rank is None:
        return None
    return prev_rank - current_rank


def _get_badge(rank_change: int | None, change_rate: int | None) -> str:
    if rank_change is None or change_rate is None:
        return "NEW"
    if rank_change > 0:
        return "UP"
    if rank_change < 0:
        return "DOWN"
    return "SAME"


def _hits_to_items(es_resp: dict) -> list[dict]:
    hits = es_resp.get("hits", {}).get("hits", [])
    items = []
    for hit in hits:
        src = hit.get("_source", {})
        summary_obj = src.get("summary", {})
        items.append(
            {
                "keyword": src.get("keyword"),
                "count": int(src.get("count", 0) or 0),
                "summary": summary_obj.get("summary") if isinstance(summary_obj, dict) else None,
            }
        )
    return items


def _build_base_prev(mode: Mode, start: date, end: date) -> tuple[tuple[date, date], tuple[date, date] | None]:
    if mode == "day":
        if start != end:
            raise ValueError("day mode requires the same start and end date")
        return (start, end), (start - timedelta(days=1), start - timedelta(days=1))

    if mode == "week" or mode == "range":
        return (start, end), _prev_same_length_range(start, end)

    if mode == "month":
        base_start, base_end = _month_start_end(end)
        prev_start, prev_end = _month_start_end(_prev_month_anchor(end))
        return (base_start, base_end), (prev_start, prev_end)

    if mode == "year":
        base_start, base_end = _year_start_end(end)
        prev_start, prev_end = _year_start_end(date(end.year - 1, 1, 1))
        return (base_start, base_end), (prev_start, prev_end)

    raise ValueError("mode must be one of day|week|month|year|range")


def _load_ranking_items(es, mode: Mode, base_range: tuple[date, date], prev_range: tuple[date, date] | None, size: int):
    base_start, base_end = base_range

    if mode == "day":
        base_items = _hits_to_items(repo.get_issue_ranking_by_date(es, base_start.isoformat(), size=size))
        prev_items = (
            _hits_to_items(repo.get_issue_ranking_by_date(es, prev_range[0].isoformat(), size=size))
            if prev_range
            else []
        )
        return base_items, prev_items

    base_items = repo.get_top_keywords_sum_by_range(es, base_start.isoformat(), base_end.isoformat(), size=size)
    prev_items = []
    if prev_range:
        prev_items = repo.get_top_keywords_sum_by_range(
            es,
            prev_range[0].isoformat(),
            prev_range[1].isoformat(),
            size=size,
        )
    return base_items, prev_items


def get_keyword_ranking(
    es,
    mode: Mode,
    start: str,
    end: str,
    size: int = 10,
) -> dict:
    start_date = _parse_date(start)
    end_date = _parse_date(end)
    if start_date > end_date:
        return {"error": "start must not be later than end"}

    try:
        base_range, prev_range = _build_base_prev(mode, start_date, end_date)
    except ValueError as exc:
        return {"error": str(exc)}

    base_items, prev_items = _load_ranking_items(es, mode, base_range, prev_range, size)
    prev_rank_map = {item["keyword"]: index + 1 for index, item in enumerate(prev_items)}
    prev_count_map = {item["keyword"]: int(item["count"]) for item in prev_items}

    items = []
    for index, current in enumerate(base_items, start=1):
        keyword = current["keyword"]
        current_count = int(current["count"])
        prev_rank = prev_rank_map.get(keyword)
        prev_count = prev_count_map.get(keyword, 0)
        change_rate = calc_change_rate(current_count, prev_count)
        rank_change = calc_rank_change(index, prev_rank)

        items.append(
            {
                "rank": index,
                "keyword": keyword,
                "count": current_count,
                "change_rate": change_rate,
                "rank_change": rank_change,
                "badge": _get_badge(rank_change, change_rate),
                "summary": current.get("summary"),
            }
        )

    result = {
        "mode": mode,
        "base": {"start": base_range[0].isoformat(), "end": base_range[1].isoformat()},
        "prev": None,
        "items": items,
    }
    if prev_range:
        result["prev"] = {"start": prev_range[0].isoformat(), "end": prev_range[1].isoformat()}
    return result
