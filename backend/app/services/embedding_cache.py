"""Redis-based embedding cache to avoid repeated OpenAI API calls.

Each embedding is stored as a JSON-serialised list[float] with a 7-day TTL.
Cache keys are SHA-256 hashes of ``model:text`` to keep key length fixed.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import List, Optional

from app.config import settings

logger = logging.getLogger("chaticu")

CACHE_PREFIX = "emb:"
CACHE_TTL = getattr(settings, "EMBEDDING_CACHE_TTL_SECONDS", 604800)  # 7 days


def _cache_key(text: str, model: str) -> str:
    h = hashlib.sha256(f"{model}:{text}".encode("utf-8")).hexdigest()[:32]
    return f"{CACHE_PREFIX}{h}"


async def get_cached_embedding(redis_client, text: str, model: str) -> Optional[List[float]]:
    """Return cached embedding vector or None."""
    try:
        key = _cache_key(text, model)
        raw = await redis_client.get(key)
        if raw:
            logger.debug("[EMB_CACHE] hit key=%s", key)
            return json.loads(raw)
    except Exception as exc:
        logger.warning("[EMB_CACHE] get error: %s", exc)
    return None


async def set_cached_embedding(redis_client, text: str, model: str, embedding: List[float]) -> None:
    """Store embedding vector in Redis with TTL."""
    try:
        key = _cache_key(text, model)
        await redis_client.setex(key, CACHE_TTL, json.dumps(embedding))
        logger.debug("[EMB_CACHE] set key=%s", key)
    except Exception as exc:
        logger.warning("[EMB_CACHE] set error: %s", exc)
