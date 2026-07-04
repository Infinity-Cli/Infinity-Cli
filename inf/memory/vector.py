"""Vector memory backed by an ephemeral ChromaDB client with an in-process fallback."""

from __future__ import annotations

import hashlib
import logging
from typing import Any

try:
    import chromadb
    from chromadb.config import Settings
except Exception:  # pragma: no cover - dependency is optional
    chromadb = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


class _SimpleEmbeddingFunction:
    """Deterministic local embedding function that avoids network calls."""

    def __init__(self, dimension: int = 256) -> None:
        self.dimension = dimension

    def __call__(self, input: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in input]

    def _embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dimension
        for token in text.lower().split():
            index = (
                int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
                % self.dimension
            )
            vector[index] += 1.0
        if not any(vector):
            vector[0] = 1.0
        return vector


class VectorMemory:
    """Stores and queries text documents using an ephemeral vector store."""

    def __init__(
        self,
        collection_name: str = "infinity_memory",
        embedding_function: Any | None = None,
    ) -> None:
        self.collection_name = collection_name
        self._embedding_function = embedding_function
        self._fallback: dict[str, dict[str, Any]] = {}

        if chromadb is None:
            logger.warning(
                "chromadb is not installed; VectorMemory will use an in-memory fallback."
            )
            return

        settings = Settings(anonymized_telemetry=False)
        self._client = chromadb.Client(settings)
        ef = embedding_function if embedding_function is not None else _SimpleEmbeddingFunction()
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            embedding_function=ef,
        )

    def add(
        self, doc_id: str, text: str, metadata: dict[str, Any] | None = None
    ) -> None:
        """Add or update a document in the collection."""
        if chromadb is None:
            self._fallback[doc_id] = {
                "text": text,
                "metadata": metadata or {},
            }
            return

        self._collection.upsert(
            ids=[doc_id],
            documents=[text],
            metadatas=[metadata or {}],
        )

    def query(self, text: str, n_results: int = 3) -> list[dict[str, Any]]:
        """Query the collection and return matching documents."""
        if chromadb is None:
            return self._fallback_query(text, n_results)

        raw = self._collection.query(
            query_texts=[text],
            n_results=n_results,
        )

        ids = raw.get("ids", [[]])[0]
        documents = raw.get("documents", [[]])[0]
        metadatas = raw.get("metadatas", [[]])[0]
        distances = raw.get("distances", [[]])[0]

        return [
            {
                "id": ids[i],
                "document": documents[i],
                "metadata": metadatas[i],
                "distance": distances[i],
            }
            for i in range(len(ids))
        ]

    def _fallback_query(self, text: str, n_results: int) -> list[dict[str, Any]]:
        query_lower = text.lower()
        results = []
        for doc_id, doc in self._fallback.items():
            distance = (
                0.0 if query_lower in doc["text"].lower() else 1.0
            )
            results.append(
                {
                    "id": doc_id,
                    "document": doc["text"],
                    "metadata": doc["metadata"],
                    "distance": distance,
                }
            )
        results.sort(key=lambda item: item["distance"])
        return results[:n_results]
