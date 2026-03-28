from __future__ import annotations

import logging

from elasticsearch import Elasticsearch

from apps.shared.config.env import ES_CONNECTIONS_PER_NODE, ES_REQUEST_TIMEOUT, ES_URL

logger = logging.getLogger(__name__)

es = Elasticsearch(
    hosts=[ES_URL],
    request_timeout=30,
)


def get_es():
    return Elasticsearch(
        hosts=[ES_URL],
        connections_per_node=ES_CONNECTIONS_PER_NODE,
        request_timeout=ES_REQUEST_TIMEOUT,
    )


def verify_connection() -> None:
    logger.info("Elasticsearch 연결 확인 중 — url=%s", ES_URL)
    try:
        client = get_es()
        if not client.ping():
            raise ConnectionError("ping 실패")
        logger.info("Elasticsearch 연결 성공")
        client.close()
    except Exception as exc:
        logger.error("Elasticsearch 연결 실패 — url=%s | %s", ES_URL, exc)
        raise


def delete_indices():
    client = get_es()
    try:
        for index in ["issue_keyword_count"]:
            if client.indices.exists(index=index):
                client.indices.delete(index=index)
                print(f"Deleted index: {index}")
            else:
                print(f"Index not found (skip): {index}")
    finally:
        print("Delete complete")
        client.close()


def create_indices():
    client = get_es()
    try:
        if not client.indices.exists(index="issue_keyword_count"):
            client.indices.create(
                index="issue_keyword_count",
                mappings={
                    "dynamic": "strict",
                    "properties": {
                        "date": {"type": "date", "format": "strict_date"},
                        "keyword": {"type": "keyword"},
                        "count": {"type": "integer"},
                        "sub_keywords": {
                            "type": "nested",
                            "properties": {
                                "keyword": {"type": "keyword"},
                                "score": {"type": "float"},
                            },
                        },
                        "summary": {
                            "properties": {
                                "summary": {"type": "text"},
                                "computed_at": {"type": "date", "format": "strict_date_time"},
                            }
                        },
                    },
                },
            )
            print("Created index: issue_keyword_count")
        else:
            print("Index already exists (skip): issue_keyword_count")

        if not client.indices.exists(index="news_info"):
            client.indices.create(
                index="news_info",
                mappings={
                    "dynamic": True,
                    "properties": {
                        "article_id": {"type": "keyword"},
                        "published_at": {"type": "date"},
                        "press_name": {"type": "keyword"},
                        "reporter": {"type": "keyword"},
                        "title": {"type": "text"},
                        "body": {"type": "text"},
                        "url": {"type": "keyword"},
                        "keywords": {
                            "properties": {
                                "label": {"type": "keyword"},
                                "model_version": {"type": "keyword"},
                            }
                        },
                        "sentiment": {
                            "properties": {
                                "label": {"type": "keyword"},
                                "score": {"type": "float"},
                                "model_version": {"type": "keyword"},
                            }
                        },
                        "trust": {
                            "properties": {
                                "label": {"type": "keyword"},
                                "score": {"type": "float"},
                                "model_version": {"type": "keyword"},
                            }
                        },
                        "summary": {
                            "properties": {
                                "summary_text": {"type": "text"},
                                "model_version": {"type": "keyword"},
                            }
                        },
                    },
                },
            )
            print("Created index: news_info")
        else:
            print("Index already exists (skip): news_info")

        if not client.indices.exists(index="clean_text"):
            client.indices.create(
                index="clean_text",
                mappings={
                    "dynamic": "strict",
                    "properties": {
                        "date": {"type": "date"},
                        "clean_text": {"type": "text"},
                    },
                },
            )
            print("Created index: clean_text")
        else:
            print("Index already exists (skip): clean_text")

    finally:
        client.close()
        print("Index setup complete")
