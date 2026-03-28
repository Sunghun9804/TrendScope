from typing import Optional

from sqlalchemy import text


class WordSowRepository:
    def __init__(self, db):
        self.db = db

    def get_terms_with_bookmark_status(self, user_id: Optional[str]):
        result = self.db.execute(
            text(
                """
                SELECT
                    t.term_id,
                    t.term,
                    CASE WHEN b.state = 'ADD' THEN 1 ELSE 0 END AS is_bookmarked
                FROM economic_terms t
                LEFT JOIN user_term_bookmarks b
                  ON t.term_id = b.term_id
                 AND b.user_id = :user_id
                 AND b.state = 'ADD'
                WHERE t.state NOT IN ('DISABLED', 'DELETED')
                ORDER BY t.term ASC
                """
            ),
            {"user_id": user_id},
        ).fetchall()
        return [dict(row._mapping) for row in result] if result else []

    def get_term_detail(self, term_id: str):
        result = self.db.execute(
            text(
                """
                SELECT term_id, term, description, event_at
                FROM economic_terms
                WHERE term_id = :term_id
                  AND state NOT IN ('DISABLED', 'DELETED')
                """
            ),
            {"term_id": term_id},
        ).fetchone()
        return dict(result._mapping) if result else None

    def get_terms_by_initial(self, start_char: str, end_char: str):
        result = self.db.execute(
            text(
                """
                SELECT term_id, term
                FROM economic_terms
                WHERE term >= :start
                  AND term <= :end
                  AND state NOT IN ('DISABLED', 'DELETED')
                ORDER BY term ASC
                """
            ),
            {"start": start_char, "end": end_char},
        ).fetchall()
        return [dict(row._mapping) for row in result] if result else []
