"""LLM-based chat router — determines which data sources to query.

Uses a fast LLM (gpt-4o-mini) to produce structured JSON output indicating
which specialized databases to consult for a given user question.

Sources:
  - drug_rag: Drug RAG (Qdrant) — 仿單、UpToDate、藥品資訊 (231K vectors)
  - pad: PAD ICU Drug API — 9 種 ICU 藥物臨床指引 + 劑量計算
  - interaction: Drug Graph — drug-drug interactions (risk X/D/C/B/A)
  - compatibility: Drug Graph — IV Y-site compatibility
  - nhi: NHI index — Taiwan health insurance reimbursement rules
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger("chaticu")


class ChatRouteResult(BaseModel):
    """Structured output from the LLM router."""
    lookup_types: List[str] = Field(default_factory=list)
    drugs: List[str] = Field(default_factory=list)
    solution: Optional[str] = None


# ── Prompt ────────────────────────────────────────────────────────────────

_ROUTER_SYSTEM_PROMPT = """\
你是 ICU 臨床藥學 AI 助手的路由控制器。根據使用者的問題，決定需要查詢哪些專門資料庫。

可選的資料庫：
- drug_rag: 藥品知識庫（仿單、UpToDate、藥品資訊、藥理機轉、副作用、用法用量、禁忌）適用於「任何需要查證藥物特性的問題」
- pad: ICU 臨床指引資料庫（9 種 ICU 常用藥物：cisatracurium, rocuronium, fentanyl, morphine, dexmedetomidine, propofol, midazolam, lorazepam, haloperidol 的臨床使用指引、配置方式、劑量建議）
- interaction: 藥物交互作用資料庫（查兩種以上藥物之間的交互作用風險等級）
- compatibility: IV 相容性資料庫（查靜脈注射藥物的 Y-site 相容性）
- nhi: 台灣健保給付規範資料庫（查藥物的健保給付條件和限制）
- guideline: ICU 臨床指引資料庫（PADIS 2018/2025、NMB 指引、UpToDate 臨床綜述，涵蓋疼痛/鎮靜/譫妄/NMB/活動/睡眠等 ICU 六大主題的臨床建議與實證）

規則：
1. 只在問題明確涉及該主題時才選擇對應資料庫
2. 可同時選擇多個資料庫（例如問「dexmedetomidine 劑量和健保限制」→ ["pad", "nhi"]）
3. drug_rag 適用範圍最廣：藥物的副作用、禁忌、用法用量、藥理機轉、仿單資訊都用 drug_rag
4. pad 只限 9 種 ICU 藥物的臨床使用情境（鎮靜、止痛、NMB 策略、配置方式、藥動學屬性如脂溶性/蛋白結合率）
5. guideline 適用於 ICU 臨床策略問題（鎮靜策略、疼痛評估、譫妄預防、NMB 使用時機、早期活動、呼吸器脫離等）
6. 當問到 ICU 藥物的「機轉」「藥理」時，同時選 drug_rag 和 guideline（guideline 含 UpToDate 藥理綜述）
7. 當問到健保規範的「原因」「為什麼」時，同時選 nhi 和 drug_rag（drug_rag 含 FDA 核准背景）
8. 如果問題完全不涉及以上任何主題，回傳空陣列
9. drugs 欄位：只提取問題中「明確出現」的藥物名稱，不要推測或補充
10. solution 欄位：只在問相容性且提到特定溶液時才填寫（如 D5W、NS、LR）

回傳 JSON 格式（不要有其他文字）：
{"lookup_types": [...], "drugs": [...], "solution": null}"""

_ROUTER_FEW_SHOT = [
    {
        "q": "propofol 連續輸注4天後出現 lactate 上升和 triglyceride 升高，可能原因？",
        "a": '{"lookup_types": ["drug_rag", "pad", "guideline"], "drugs": ["propofol"], "solution": null}',
    },
    {
        "q": "amiodarone 和 quetiapine 一起用會不會有問題？",
        "a": '{"lookup_types": ["interaction"], "drugs": ["amiodarone", "quetiapine"], "solution": null}',
    },
    {
        "q": "dexmedetomidine 健保可以用多久？",
        "a": '{"lookup_types": ["nhi", "pad"], "drugs": ["dexmedetomidine"], "solution": null}',
    },
    {
        "q": "midazolam 和 fentanyl 可以接同一條 line 嗎？用 NS 稀釋",
        "a": '{"lookup_types": ["compatibility"], "drugs": ["midazolam", "fentanyl"], "solution": "NS"}',
    },
    {
        "q": "他目前用 amiodarone、levofloxacin、quetiapine，QTc 延長怎麼辦？",
        "a": '{"lookup_types": ["interaction"], "drugs": ["amiodarone", "levofloxacin", "quetiapine"], "solution": null}',
    },
    {
        "q": "ICU 鎮靜策略應該怎麼選擇？",
        "a": '{"lookup_types": ["guideline"], "drugs": [], "solution": null}',
    },
    {
        "q": "cisatracurium 怎麼配置？onset 多久？健保有沒有限制？",
        "a": '{"lookup_types": ["pad", "nhi"], "drugs": ["cisatracurium"], "solution": null}',
    },
    {
        "q": "Metformin 的副作用有哪些？",
        "a": '{"lookup_types": ["drug_rag"], "drugs": ["Metformin"], "solution": null}',
    },
    {
        "q": "lorazepam 的藥理機轉和在 ICU 的使用建議？",
        "a": '{"lookup_types": ["drug_rag", "guideline", "pad"], "drugs": ["lorazepam"], "solution": null}',
    },
    {
        "q": "哪些因素可能影響 midazolam 的藥效？",
        "a": '{"lookup_types": ["drug_rag", "pad"], "drugs": ["midazolam"], "solution": null}',
    },
    {
        "q": "ICU 病人拔管後出現譫妄，應如何處置？",
        "a": '{"lookup_types": ["guideline"], "drugs": [], "solution": null}',
    },
    {
        "q": "DSI 和 nursing protocolized sedation 哪個比較好？",
        "a": '{"lookup_types": ["guideline"], "drugs": [], "solution": null}',
    },
    {
        "q": "Dexmedetomidine 造成心搏過緩的機轉為何？",
        "a": '{"lookup_types": ["drug_rag", "guideline"], "drugs": ["dexmedetomidine"], "solution": null}',
    },
    {
        "q": "為什麼台灣健保限制 dexmedetomidine 連續使用不超過24小時？",
        "a": '{"lookup_types": ["nhi", "drug_rag", "pad"], "drugs": ["dexmedetomidine"], "solution": null}',
    },
    {
        "q": "ICU 常用的止痛鎮靜藥中哪些屬於高脂溶性？",
        "a": '{"lookup_types": ["pad", "drug_rag"], "drugs": [], "solution": null}',
    },
    {
        "q": "Ketamine 在 ICU 的角色和建議劑量？",
        "a": '{"lookup_types": ["drug_rag", "guideline"], "drugs": ["ketamine"], "solution": null}',
    },
]


def _build_router_prompt(question: str, medication_names: Optional[List[str]] = None) -> str:
    """Build the user prompt for the router LLM call."""
    parts = []
    if medication_names:
        parts.append(f"[病患目前用藥] {', '.join(medication_names)}")
    parts.append(f"[使用者問題] {question}")
    return "\n".join(parts)


def _build_router_messages(question: str, medication_names: Optional[List[str]] = None) -> List[Dict[str, str]]:
    """Build multi-turn messages with few-shot examples."""
    messages = []
    for ex in _ROUTER_FEW_SHOT:
        messages.append({"role": "user", "content": ex["q"]})
        messages.append({"role": "assistant", "content": ex["a"]})
    messages.append({"role": "user", "content": _build_router_prompt(question, medication_names)})
    return messages


def _parse_router_response(raw: str) -> ChatRouteResult:
    """Parse JSON from LLM response, with fallback for malformed output."""
    text = raw.strip()
    # Try to extract JSON from markdown code blocks
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if json_match:
        text = json_match.group(1)
    # Try to find raw JSON object
    brace_match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if brace_match:
        text = brace_match.group(0)

    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("[ROUTER] Failed to parse router response: %s", raw[:200])
        return ChatRouteResult()

    # Validate lookup_types
    valid_types = {"drug_rag", "pad", "interaction", "compatibility", "nhi", "guideline"}
    lookup_types = [t for t in data.get("lookup_types", []) if t in valid_types]

    return ChatRouteResult(
        lookup_types=lookup_types,
        drugs=[str(d).strip() for d in data.get("drugs", []) if d],
        solution=data.get("solution"),
    )


async def route_chat(
    question: str,
    medication_names: Optional[List[str]] = None,
) -> ChatRouteResult:
    """Call the router LLM to determine which sources to query.

    Args:
        question: The user's question.
        medication_names: Optional list of the patient's current medication names
                         (helps the router detect implicit drug references).

    Returns:
        ChatRouteResult with lookup_types, drugs, and optional solution.
    """
    import asyncio
    from app.llm import call_llm_multi_turn

    messages = _build_router_messages(question, medication_names)

    try:
        result = await asyncio.to_thread(
            call_llm_multi_turn,
            task="chat_route",
            messages=messages,
            temperature=0,
            max_tokens=150,
        )
        if result.get("status") != "success":
            logger.warning("[ROUTER] LLM call failed: %s", result.get("content", "")[:200])
            return ChatRouteResult()

        parsed = _parse_router_response(result.get("content", ""))
        logger.info(
            "[ROUTER] question=%s lookup_types=%s drugs=%s solution=%s",
            question[:80],
            parsed.lookup_types,
            parsed.drugs,
            parsed.solution,
        )
        return parsed

    except Exception as exc:
        logger.warning("[ROUTER] Router call failed: %s", str(exc)[:200])
        return ChatRouteResult()
