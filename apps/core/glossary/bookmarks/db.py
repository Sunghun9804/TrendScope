from sqlalchemy import text


class BookmarkRepository:
    def __init__(self, db):
        self.db = db

    def get_my_term_bookmarks(self, user_id: str):
        rows = self.db.execute(
            text(
                """
                SELECT utb.term_id, et.term
                FROM user_term_bookmarks utb
                JOIN economic_terms et ON utb.term_id = et.term_id
                WHERE utb.user_id = :user_id
                  AND utb.state = 'ADD'
                ORDER BY utb.event_at DESC
                """
            ),
            {"user_id": user_id},
        ).fetchall()
        return [dict(row._mapping) for row in rows]

    def toggle_term_bookmark(self, user_id: str, term_id: str, state: str):
        if state not in ("ADD", "CANCEL"):
            raise ValueError("state must be 'ADD' or 'CANCEL'")

        try:
            self.db.execute(
                text(
                    """
                    INSERT INTO user_term_bookmarks (user_id, term_id, state, event_at)
                    VALUES (:user_id, :term_id, :state, NOW())
                    ON DUPLICATE KEY UPDATE
                      state = VALUES(state),
                      event_at = NOW()
                    """
                ),
                {"user_id": user_id, "term_id": term_id, "state": state},
            )
            self.db.commit()
            return {"ok": True, "state": state}
        except Exception as exc:
            self.db.rollback()
            return {"ok": False, "error": str(exc)}

    def clear_all_bookmarks(self, user_id: str):
        try:
            self.db.execute(
                text(
                    """
                    UPDATE user_term_bookmarks
                    SET state = 'CANCEL', event_at = NOW()
                    WHERE user_id = :user_id AND state = 'ADD'
                    """
                ),
                {"user_id": user_id},
            )
            self.db.commit()
            return {"status": "success", "message": "모든 북마크가 해제되었습니다."}
        except Exception as exc:
            self.db.rollback()
            return {"status": "fail", "message": str(exc)}
