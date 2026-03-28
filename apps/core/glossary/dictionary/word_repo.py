from sqlalchemy import text
import pandas as pd

from apps.shared.infra.db import get_db
from apps.shared.config.env import DEFAULT_WORD_DATA_CSV


def load_data_from_csv(file_path: str) -> dict:
    session = get_db()
    try:
        df = pd.read_csv(file_path)
        df["event_at"] = pd.to_datetime(df["scraped_at"]).dt.strftime("%Y-%m-%d %H:%M:%S")

        insert_sql = """
            INSERT INTO economic_terms (term_id, term, description, event_at)
            VALUES (:term_id, :term, :description, :event_at)
            ON DUPLICATE KEY UPDATE
                term = VALUES(term),
                description = VALUES(description),
                event_at = VALUES(event_at)
        """

        for _, row in df.iterrows():
            session.execute(
                text(insert_sql),
                {
                    "term_id": row["term_id"],
                    "term": row["keyword"],
                    "description": row["content"],
                    "event_at": row["event_at"],
                },
            )

        session.commit()
        return {"ok": True, "message": f"{len(df)} records inserted successfully!"}
    except Exception as exc:
        session.rollback()
        return {"ok": False, "error": "DB_ERROR", "detail": str(exc)}
    finally:
        session.close()


if __name__ == "__main__":
    result = load_data_from_csv(str(DEFAULT_WORD_DATA_CSV))
    if result["ok"]:
        print(result["message"])
    else:
        print(f"Error: {result['error']} - {result['detail']}")
