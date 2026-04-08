"""Async HTTP client for PAD (Pain/Agitation/Delirium) ICU Drug API.

Communicates with the PAD API from `0_chatICU reference/文本/PAD/`
which provides ICU drug dosing calculation and 3-layer RAG queries
for 9 PAD drugs backed by ChromaDB + GPT-4o Function Calling.

All methods are async (using httpx.AsyncClient).
Graceful degradation: timeouts and errors return empty results + log warnings.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

_CALCULATE_TIMEOUT = 10.0  # deterministic, no LLM
_CHAT_TIMEOUT = 30.0       # LLM generation can take 10-20s

# 9 PAD drugs
PAD_DRUGS = [
    "cisatracurium",
    "rocuronium",
    "fentanyl",
    "morphine",
    "dexmedetomidine",
    "propofol",
    "midazolam",
    "lorazepam",
    "haloperidol",
]


# ── Response Models ───────────────────────────────────────────────────────

class PadDosingResult(BaseModel):
    """Dosing calculation result from PAD /calculate."""
    drug: str = ""
    BMI: Optional[float] = None
    IBW_kg: Optional[float] = None
    AdjBW_kg: Optional[float] = None
    pct_IBW: Optional[float] = None
    is_obese: Optional[bool] = None
    weight_basis: Optional[str] = None
    dosing_weight_kg: Optional[float] = None
    dose_per_hr: Optional[float] = None
    rate_ml_hr: Optional[float] = None
    concentration: Optional[str] = None
    note: Optional[str] = None


class PadSourceChunk(BaseModel):
    """A source chunk from PAD chat."""
    chunk_id: str = ""
    text: str = ""
    score: Optional[float] = None
    module: Optional[str] = None
    drug: Optional[str] = None
    topic: Optional[str] = None


class PadChatResponse(BaseModel):
    """Response from PAD /chat."""
    answer: str = ""
    layer_used: str = ""
    sources: List[PadSourceChunk] = Field(default_factory=list)
    dosing_result: Optional[PadDosingResult] = None


# ── Client ────────────────────────────────────────────────────────────────

class PadClient:
    """Async HTTP client for the PAD ICU Drug API.

    Usage:
        client = PadClient()
        result = await client.calculate("cisatracurium", TBW_kg=70, ...)
        chat = await client.chat("cisatracurium 健保給付條件?")
    """

    def __init__(self, base_url: Optional[str] = None) -> None:
        self.base_url = (base_url or settings.PAD_API_URL).rstrip("/")

    async def calculate(
        self,
        drug: str,
        TBW_kg: float,
        target_dose_per_kg_hr: float,
        concentration_value: float,
        sex: Optional[str] = None,
        height_cm: Optional[float] = None,
        concentration_unit: Optional[str] = None,
    ) -> PadDosingResult:
        """Call PAD /calculate for deterministic dose calculation."""
        params: Dict[str, Any] = {
            "drug": drug.lower().strip(),
            "TBW_kg": TBW_kg,
            "target_dose_per_kg_hr": target_dose_per_kg_hr,
            "concentration_value": concentration_value,
        }
        if sex:
            params["sex"] = sex
        if height_cm:
            params["height_cm"] = height_cm
        if concentration_unit:
            params["concentration_unit"] = concentration_unit

        try:
            async with httpx.AsyncClient(timeout=_CALCULATE_TIMEOUT) as client:
                resp = await client.get(f"{self.base_url}/calculate", params=params)
                resp.raise_for_status()
                data = resp.json()
            return PadDosingResult(**data)

        except httpx.TimeoutException:
            logger.warning("[PAD] calculate timeout (%.1fs)", _CALCULATE_TIMEOUT)
            return PadDosingResult(drug=drug, note="PAD 服務逾時")

        except httpx.ConnectError:
            logger.warning("[PAD] calculate connection failed to %s", self.base_url)
            return PadDosingResult(drug=drug, note="PAD 服務未啟動")

        except httpx.HTTPStatusError as exc:
            logger.warning("[PAD] calculate HTTP %s: %s", exc.response.status_code, exc.response.text[:200])
            return PadDosingResult(drug=drug, note=f"PAD 錯誤 ({exc.response.status_code})")

        except Exception as exc:
            logger.error("[PAD] calculate unexpected: %s", str(exc)[:300])
            return PadDosingResult(drug=drug, note=f"意外錯誤: {exc.__class__.__name__}")

    async def chat(
        self,
        query: str,
        patient_info: Optional[Dict[str, Any]] = None,
    ) -> PadChatResponse:
        """Call PAD /chat for AI-powered drug query."""
        payload: Dict[str, Any] = {"query": query}
        if patient_info:
            payload["patient_info"] = patient_info

        try:
            async with httpx.AsyncClient(timeout=_CHAT_TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/chat",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

            sources = []
            for s in data.get("sources", []):
                sources.append(PadSourceChunk(
                    chunk_id=s.get("chunk_id", ""),
                    text=s.get("text", ""),
                    score=s.get("score"),
                    module=s.get("module"),
                    drug=s.get("drug"),
                    topic=s.get("topic"),
                ))

            dosing = None
            if data.get("dosing_result"):
                dosing = PadDosingResult(**data["dosing_result"])

            return PadChatResponse(
                answer=data.get("answer", ""),
                layer_used=data.get("layer_used", ""),
                sources=sources,
                dosing_result=dosing,
            )

        except httpx.TimeoutException:
            logger.warning("[PAD] chat timeout (%.1fs)", _CHAT_TIMEOUT)
            return PadChatResponse(answer="PAD 服務逾時，請稍後再試。", layer_used="error")

        except httpx.ConnectError:
            logger.warning("[PAD] chat connection failed to %s", self.base_url)
            return PadChatResponse(answer="PAD 服務未啟動，請確認 PAD API 是否正在運行。", layer_used="error")

        except httpx.HTTPStatusError as exc:
            logger.warning("[PAD] chat HTTP %s: %s", exc.response.status_code, exc.response.text[:200])
            return PadChatResponse(answer=f"PAD 服務錯誤 ({exc.response.status_code})", layer_used="error")

        except Exception as exc:
            logger.error("[PAD] chat unexpected: %s", str(exc)[:300])
            return PadChatResponse(answer=f"意外錯誤: {exc.__class__.__name__}", layer_used="error")

    async def health(self) -> bool:
        """Check if PAD API is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False


# Module-level singleton
pad_client = PadClient()
