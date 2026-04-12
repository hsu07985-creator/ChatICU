"""
llm.py — Unified LLM entry point for ChatICU backend.
All LLM calls in the project MUST go through call_llm().
All embeddings MUST go through embed_texts().

Ported from ChatICU/config.py with backend Settings integration.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, List, Optional

from app.config import settings

logger = logging.getLogger("chaticu")


# ── Lazy-initialized client singletons (avoid TLS handshake per request) ──
_openai_sync_client = None
_openai_async_client = None
_anthropic_sync_client = None
_anthropic_async_client = None


def _get_openai_sync():
    global _openai_sync_client
    if _openai_sync_client is None:
        from openai import OpenAI
        _openai_sync_client = OpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_sync_client


def _get_openai_async():
    global _openai_async_client
    if _openai_async_client is None:
        from openai import AsyncOpenAI
        _openai_async_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_async_client


def _get_anthropic_sync():
    global _anthropic_sync_client
    if _anthropic_sync_client is None:
        from anthropic import Anthropic
        _anthropic_sync_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_sync_client


def _get_anthropic_async():
    global _anthropic_async_client
    if _anthropic_async_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_async_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_async_client


# ── Conversation history thresholds (configurable via env: F08) ──
RECENT_MSG_WINDOW = settings.LLM_RECENT_MSG_WINDOW
COMPRESS_THRESHOLD = settings.LLM_COMPRESS_THRESHOLD

# Reasoning models (o-series, gpt-5.4-mini) don't support temperature
_REASONING_EFFORT = (settings.LLM_REASONING_EFFORT or "").strip() or None

_LANG_DIRECTIVE = (
    "Always reply in Traditional Chinese (繁體中文). "
    "Use medical terminology common in Taiwan "
    "(e.g., 加護病房, not 重症监护病房; 血氧飽和度, not 血氧饱和度)."
)

TASK_PROMPTS: dict[str, str] = {
    "clinical_summary": (
        "You are a clinical summarizer for ICU patients. "
        "Given structured patient data (JSON), produce a concise clinical summary. "
        "Include: primary diagnosis, key lab findings, current medications, "
        "and clinical recommendations. "
        + _LANG_DIRECTIVE
    ),
    "patient_explanation": (
        "You are a patient educator. Rewrite clinical information "
        "in simple, empathetic language for patients and families. "
        + _LANG_DIRECTIVE
    ),
    "guideline_interpretation": (
        "You are a clinical guideline expert. Given a clinical scenario "
        "and guideline text, provide contextualized recommendations. "
        + _LANG_DIRECTIVE
    ),
    "multi_agent_decision": (
        "You are a clinical decision integrator. Synthesize multiple "
        "clinical assessments into a unified recommendation. "
        + _LANG_DIRECTIVE
    ),
    "rag_generation": (
        "你是一位資深的 ICU 臨床藥師，擁有超過 15 年的重症照護經驗，專長為插管病人的止痛藥、鎮靜劑、神經肌肉阻斷劑的使用。"
        "你熟悉 PADIS 指引（含 2025 focused update）、ABCDEF bundle、SCCM 臨床指引，以及台灣健保給付規範。"
        "你的回答對象是具備基礎藥學知識的臨床藥師或住院醫師。\n\n"

        "## 回答結構（嚴格遵守）\n\n"

        "每個回答必須包含以下兩區塊：\n\n"

        "【主回答】\n"
        "- 極度簡潔，通常 1-3 句話（30-80 字為主流）\n"
        "- 直接給結論或行動建議，不在此處解釋原因\n"
        "- 省略主語（不寫「醫師應」「藥師建議」），直接以動詞或名詞開頭\n"
        "- 藥物一律使用英文學名（generic name）\n\n"

        "【說明/補充】\n"
        "- 以 (1)(2)(3)... 編號逐點展開深度解釋\n"
        "- 每點聚焦一個面向，典型為 2-4 點，最常見 3 點\n"
        "- 每點內部遵循「事實/機轉 → 臨床意義 → 實務建議」推論鏈\n"
        "- 若無需補充，寫「無。」\n\n"

        "## A 區塊句型模式\n\n"
        "1. 祈使/建議動作型（最常見）：直接以動詞開頭發出臨床指令\n"
        "2. 單一名詞片語型：僅以名詞回答「是什麼」的問題\n"
        "3. 替換/比較型：以「A 取代/更換為 B」結構\n"
        "4. 條件—行動複合型：「若/在...前提下 + 行動」\n"
        "5. 列舉型：並列多個項目回答知識彙整題\n"
        "6. 否定＋正向替代型：先否定不適當方案，再提出正確方案\n\n"

        "## 建議強度四級梯度\n"
        "- 「應」→ 最強，強制性（強烈推薦，高品質證據）\n"
        "- 「建議」→ 強烈推薦（有明確指引支持）\n"
        "- 「考慮」→ 條件性建議（需個體化評估）\n"
        "- 「可」→ 可選方案（證據有限或為替代方案）\n\n"

        "## 【說明/補充】的六大論述類型\n"
        "1. 機轉解釋型：機轉陳述 → 臨床表現/警訊 → 處置建議\n"
        "2. 指引引用型：「年份 + 指引簡稱 + 動詞」→ 指引結論摘述 → 臨床延伸（引用動詞：指出、建議、記載、支持、強調、強烈建議；不使用完整文獻格式）\n"
        "3. 藥動學分析型：逐一列舉影響因子（肝腎功能、年齡、蛋白結合、CYP交互作用、肥胖）\n"
        "4. 劑量配置型：劑量範圍 → 調整頻率 → 配置算式。以「・」區分間歇推注 vs 持續輸注\n"
        "5. 鑑別診斷型：概念A vs 概念B 的對照邏輯\n"
        "6. 法規給付型：精簡條列規範，形成「國際指引 + 台灣法規」雙層結構\n\n"

        "## 語言規範\n"
        "1. 主體語言為繁體中文\n"
        "2. 藥名統一使用英文學名（小寫）：fentanyl、propofol、midazolam、dexmedetomidine、cisatracurium\n"
        "3. 臨床工具使用英文縮寫：RASS、CPOT、BPS、CAM-ICU、TOF、GCS\n"
        "4. 劑量用阿拉伯數字＋英文單位：mcg/kg/min、mg/hr、mL/hr\n"
        "5. 中英混用括號格式（首次出現時標註，後續僅用英文）：「譫妄（delirium）」「神經肌肉阻斷劑（neuromuscular blocking agent, NMBA）」\n"
        "6. 語氣客觀、學術：使用「文獻指出」「研究顯示」「指引建議」\n"
        "7. 不使用第一人稱、口語化表達、個人意見語句\n"
        "8. 防禦性書寫：適時使用「應高度警覺」「不得作為例行性使用」「需密切監測」\n"
        "9. 句間連接詞：因果（「導致」「進而引發」「因此」）、並列（「並」「且」「亦」）、轉折（「然而」「但」）、條件（「若」「當...時」）\n\n"

        "## 臨床推理框架\n"
        "1. 評估疼痛 → 先處理疼痛再考慮鎮靜（analgesia-first approach）\n"
        "2. 確認可逆原因 → 排除譫妄、感染、戒斷、低氧、電解質異常\n"
        "3. 藥物選擇 → 依指引推薦＋病人個體化因素（肝腎功能、血流動力學）\n"
        "4. 劑量調整 → 考量體重（TBW vs IBW vs ABW）、器官功能、藥物交互作用\n"
        "5. 目標導向 → 明確鎮靜目標（如 RASS -2 至 0 分 = 輕度鎮靜）\n"
        "6. 監測與再評估 → 定期評估並依臨床反應調整\n"
        "7. 非藥物介入優先 → reorientation、環境介入、早期活動\n\n"

        "## 題型處理\n"
        "- 開放式臨床情境題：A 給具體處置建議或診斷結論；說明給機轉與指引依據\n"
        "- 劑量計算/配置題：A 列出劑量範圍、輸注速率、配置方式（此題型 A 可較長）；說明給計算過程、體重校正；以「・」區分間歇推注 vs 持續輸注；配置須提供幾支藥 + 多少 mL 稀釋液 = 總量與濃度\n"
        "- 藥物交互作用/藥動學題：A 直接說明結論；說明分點列舉各影響因素\n"
        "- 藥物相容性題：A 逐對（pairwise）列出相容/不相容結論；說明給物理化學原因\n"
        "- 法規/健保給付題：A 給規範背後的制度邏輯；說明條列具體要點\n"
        "- 題組承接題：承接前題脈絡但獨立回答，注意病程轉折點\n\n"

        "## 禁止事項\n"
        "- 不使用表情符號\n"
        "- 不使用「首先...其次...最後...」或「第一步、第二步」等過渡句式\n"
        "- 不重複題目內容\n"
        "- 不加入免責聲明（如「此建議僅供參考，請諮詢醫師」）\n"
        "- A 區塊不展開解釋（解釋放在說明/補充）\n"
        "- A 區塊不使用主語\n"
        "- 不自行創造未被問到的問題\n"
        "- 不加入個人意見語句（「我認為」「建議可以考慮看看」）\n"
        "- 不使用商品名取代學名（除非題目特別問到商品名）\n\n"

        "## 自我檢查\n"
        "生成回答後，確認：A 區塊簡潔且未含解釋、省略主語、建議強度用詞與證據等級匹配、"
        "說明/補充使用 (1)(2)(3) 編號、每點含完整推論鏈、藥名統一英文學名、中英混用格式正確、無禁止事項違反。\n"
    ),
    "clinical_polish": (
        "You are a medical documentation specialist for ICU care. "
        "Polish the given draft into professional clinical documentation. "
        "Use the patient's actual clinical data (labs, vitals, medications, "
        "ventilator settings) when available — never fabricate values. "
        "If a 'template_format' field is provided, use it as the output structure — "
        "fill in each section/field of the template using information from the draft and patient data. "
        "Replace placeholders (___) with actual values; leave blank if data is unavailable. "
        "If no template_format is provided, format based on polish_type: "
        "progress_note → Full SOAP format "
        "(S: Subjective — patient/family complaints, relevant history; "
        "O: Objective — vitals, labs with values, imaging, physical exam; "
        "A: Assessment — clinical interpretation, problem list; "
        "P: Plan — treatment plan, pending studies, follow-up); "
        "medication_advice → include dosing rationale based on renal/hepatic function; "
        "nursing_record → correct typos, standardize formatting in Chinese; "
        "pharmacy_advice → formal clinical pharmacy recommendation. "
        + _LANG_DIRECTIVE
    ),
    "conversation_compress": (
        "You are a conversation summarizer for an ICU clinical AI assistant. "
        "Given a multi-turn conversation between a clinician and an AI, produce a "
        "concise summary that preserves: (1) all clinical facts discussed, "
        "(2) key decisions or recommendations made, (3) any pending questions. "
        "Keep drug names, dosages, lab values, and patient-specific details intact. "
        "Output a structured summary in 300 words or fewer. "
        + _LANG_DIRECTIVE
    ),
    "contextual_chunk": (
        "你是 ICU 醫學文獻分析助手。"
        "給定一份完整文件和其中一個片段，"
        "請用 1-2 句繁體中文簡要描述該片段在整份文件中的位置與主題。"
        "重點：該片段屬於哪個章節/主題、涵蓋什麼具體內容。"
        "只輸出簡要上下文，不要其他文字。"
    ),
    "icu_chat": (
        "你是 ChatICU 的 ICU 臨床決策輔助 AI。你協助 ICU 醫護人員分析病患狀況、"
        "解讀檢驗數據、討論用藥選擇。你的回覆應精確、簡潔，並符合實證醫學。\n\n"
        "安全規則：\n"
        "- 你的建議供參考，最終決策由醫師負責\n"
        "- 若問題超出現有資料範疇，明確說明資訊不足\n"
        "- 藥物建議須符合腎/肝功能狀態\n"
        "- 遇到高風險藥物組合，主動警示\n\n"
        "格式規則（ICU 現場快速掃描優先）：\n"
        "- 直接回答問題，不要在每次回應前重複摘要病患基本資料\n"
        "- 只在問題明確要求摘要時，才輸出患者整體概況\n"
        "- 優先順序清單：先列最重要/最緊急的 3–5 項，再補充次要事項\n"
        "- 每個要點控制在 1–2 行，避免多層巢狀子列表\n"
        "- 若需分類，最多 3 個大類，每類最多 4 個子項\n"
        "- 警示事項（高風險藥物、緊急處置）用 ⚠️ 標示，並在該條目加上 **粗體**\n"
        "- 分類標題使用 ### Markdown 格式（會渲染為粗體標題）\n"
        "- 重要數值與藥物名稱使用 **粗體** 強調\n"
        "- 免責聲明只在首次回覆出現，後續對話不需重複\n\n"
        "語言：以繁體中文回覆，數值保留英文縮寫（如 Cr、WBC、MAP）。"
    ),
    "citation_summary": (
        "你是 ICU 臨床文獻整理助手。將醫療文獻的原文段落精煉為簡潔的參考引述。\n"
        "輸入包含多個來源文獻及其原文段落。\n"
        "對每個來源，輸出 JSON 物件包含：\n"
        '  "summary": 一句話概述該文獻與查詢相關的核心建議（30字內，繁體中文）\n'
        '  "keyQuote": 原文中最關鍵的一句話（直接引述原文，60字內）\n'
        '  "relevanceNote": 為什麼這段文獻與查詢相關（15字內）\n'
        "輸出格式：一個 JSON array，每個元素對應一個來源。\n"
        "只輸出 JSON，不要其他文字。"
    ),
    "safety_check": (
        "You are a medical AI safety reviewer for ICU clinical outputs. "
        "Analyze the given AI-generated response for safety concerns:\n"
        "1. Dangerous drug dosage recommendations (especially high-alert medications)\n"
        "2. Definitive diagnostic claims without sufficient evidence\n"
        "3. Contraindicated treatment suggestions for ICU patients\n"
        "4. Missing critical safety caveats for high-risk interventions\n"
        "5. Potential patient harm from following the advice\n"
        "6. Off-label use recommendations without appropriate disclaimer\n\n"
        "Return a JSON object with:\n"
        '  "safe": true/false\n'
        '  "warnings": ["warning1", "warning2"] (繁體中文, each prefixed with ⚠️)\n'
        '  "severity": "none" | "low" | "medium" | "high"\n'
        "Only output JSON, no other text. "
        "Be conservative: only flag genuine safety concerns, not general medical advice."
    ),
    "agentic_rag_router": (
        "You are an ICU clinical search strategist. "
        "Given a clinical question, decide the best search strategy. "
        "You can search multiple times with different queries to gather comprehensive evidence. "
        "Rewrite queries to be specific and medical when needed. "
        + _LANG_DIRECTIVE
    ),
}


def _normalize_trace_value(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _fingerprint_payload(payload: Any) -> str:
    try:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:
        body = str(payload)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _model_dump_safe(payload: Any) -> Any:
    if payload is None:
        return None
    if hasattr(payload, "model_dump"):
        try:
            return payload.model_dump()
        except Exception:
            pass
    if hasattr(payload, "to_dict"):
        try:
            return payload.to_dict()
        except Exception:
            pass
    try:
        return json.loads(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        return str(payload)


def _capture_dir_path() -> Path:
    raw = str(settings.LLM_AUDIT_CAPTURE_DIR or "").strip()
    default_rel = "reports/operations/llm_raw_capture"
    path = Path(raw or default_rel).expanduser()
    if path.is_absolute():
        return path
    repo_root = Path(__file__).resolve().parents[2]
    return repo_root / path


def _maybe_capture_provider_raw(
    *,
    provider: str,
    task: str,
    model: str,
    request_id: str | None,
    trace_id: str | None,
    input_payload: Any,
    response_payload: Any,
) -> None:
    if not settings.LLM_AUDIT_CAPTURE_RAW:
        return

    try:
        capture_dir = _capture_dir_path()
        capture_dir.mkdir(parents=True, exist_ok=True)
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        rid = request_id or "no_request_id"
        tid = trace_id or rid
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"{stamp}_{provider}_{task}_{rid[:20]}.json"
        target = capture_dir / filename
        payload = {
            "captured_at": captured_at,
            "provider": provider,
            "model": model,
            "task": task,
            "request_id": request_id,
            "trace_id": trace_id,
            "input_fingerprint": _fingerprint_payload(input_payload),
            "response_raw": _model_dump_safe(response_payload),
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "[INTG][AI][AUDIT] provider_raw_captured path=%s request_id=%s trace_id=%s task=%s",
            str(target),
            rid,
            tid,
            task,
        )
    except Exception:
        logger.warning("[INTG][AI][AUDIT] provider raw capture failed", exc_info=True)


def call_llm(task: str, input_data: dict[str, Any], **kwargs) -> dict[str, Any]:
    """Call LLM for a specific task. Returns {status, content, metadata}."""
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", settings.LLM_TEMPERATURE)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        return {"status": "error", "content": "OPENAI_API_KEY is not set", "metadata": {}}
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        return {"status": "error", "content": "ANTHROPIC_API_KEY is not set", "metadata": {}}

    try:
        if settings.LLM_PROVIDER == "openai":
            return _call_openai(
                system_prompt,
                input_data,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        elif settings.LLM_PROVIDER == "anthropic":
            return _call_anthropic(
                system_prompt,
                input_data,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        else:
            return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


def call_llm_multi_turn(
    task: str,
    messages: List[dict[str, str]],
    **kwargs,
) -> dict[str, Any]:
    """Call LLM with a multi-turn conversation history.

    Args:
        task: Task name from TASK_PROMPTS (used as system prompt).
        messages: List of {"role": "user"|"assistant", "content": "..."}.
        **kwargs: temperature, max_tokens overrides.

    Returns:
        {status, content, metadata} — same shape as call_llm().
    """
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", settings.LLM_TEMPERATURE)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        return {"status": "error", "content": "OPENAI_API_KEY is not set", "metadata": {}}
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        return {"status": "error", "content": "ANTHROPIC_API_KEY is not set", "metadata": {}}

    try:
        if settings.LLM_PROVIDER == "openai":
            return _call_openai_multi(
                system_prompt,
                messages,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        elif settings.LLM_PROVIDER == "anthropic":
            return _call_anthropic_multi(
                system_prompt,
                messages,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        else:
            return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


async def call_llm_stream(
    task: str,
    messages: List[dict],
    **kwargs,
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens for a multi-turn conversation.

    Yields individual text chunks as they arrive from the provider's
    streaming API. The final yield is a JSON metadata string prefixed
    with ``[DONE]`` containing usage statistics.

    Optional kwargs:
        system_prompt_override: str — replaces the TASK_PROMPTS[task] system prompt.
    """
    system_prompt_override = kwargs.get("system_prompt_override")
    if system_prompt_override:
        system_prompt = system_prompt_override
    elif task in TASK_PROMPTS:
        system_prompt = TASK_PROMPTS[task]
    else:
        yield "[ERROR] Unknown task: " + task
        return
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        yield "[ERROR] OPENAI_API_KEY is not set"
        return
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        yield "[ERROR] ANTHROPIC_API_KEY is not set"
        return

    try:
        if settings.LLM_PROVIDER == "openai":
            async for chunk in _stream_openai(system_prompt, messages, max_tokens, task=task, request_id=request_id, trace_id=trace_id):
                yield chunk
        elif settings.LLM_PROVIDER == "anthropic":
            async for chunk in _stream_anthropic(system_prompt, messages, max_tokens, task=task, request_id=request_id, trace_id=trace_id):
                yield chunk
        else:
            yield f"[ERROR] Unsupported provider: {settings.LLM_PROVIDER}"
    except Exception as e:
        logger.error("[LLM][STREAM] Streaming failed: %s", str(e)[:500])
        yield f"[ERROR] {str(e)}"


async def _stream_openai(
    system_prompt: str,
    messages: List[dict],
    max_tokens: int,
    *,
    task: str,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from OpenAI using the async client."""
    client = _get_openai_async()
    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)

    create_kwargs: dict = dict(
        model=settings.LLM_MODEL,
        max_completion_tokens=max_tokens,
        messages=api_messages,
        stream=True,
        stream_options={"include_usage": True},
    )
    if _REASONING_EFFORT:
        create_kwargs["reasoning_effort"] = _REASONING_EFFORT
    else:
        create_kwargs["temperature"] = settings.LLM_TEMPERATURE
    stream = await client.chat.completions.create(**create_kwargs)

    full_content = ""
    usage_meta = {}
    async for chunk in stream:
        if chunk.usage:
            usage_meta = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
            }
        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
            text = chunk.choices[0].delta.content
            full_content += text
            yield text

    _maybe_capture_provider_raw(
        provider="openai", task=task, model=settings.LLM_MODEL,
        request_id=request_id, trace_id=trace_id,
        input_payload=messages, response_payload={"content": full_content[:500], "usage": usage_meta},
    )
    yield json.dumps({"__done__": True, "model": settings.LLM_MODEL, "usage": usage_meta})


async def _stream_anthropic(
    system_prompt: str,
    messages: List[dict],
    max_tokens: int,
    *,
    task: str,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Anthropic using the async client."""
    client = _get_anthropic_async()
    full_content = ""
    usage_meta = {}

    async with client.messages.stream(
        model=settings.LLM_MODEL,
        temperature=settings.LLM_TEMPERATURE,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            full_content += text
            yield text
        # Get final message for usage info
        final_message = await stream.get_final_message()
        usage_meta = {
            "input_tokens": final_message.usage.input_tokens,
            "output_tokens": final_message.usage.output_tokens,
        }

    _maybe_capture_provider_raw(
        provider="anthropic", task=task, model=settings.LLM_MODEL,
        request_id=request_id, trace_id=trace_id,
        input_payload=messages, response_payload={"content": full_content[:500], "usage": usage_meta},
    )
    yield json.dumps({"__done__": True, "model": settings.LLM_MODEL, "usage": usage_meta})


def _call_openai(
    system_prompt,
    input_data,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_openai_sync()
    create_kwargs: dict = dict(
        model=settings.LLM_MODEL,
        max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(input_data, ensure_ascii=False, default=str)},
        ],
    )
    if _REASONING_EFFORT:
        create_kwargs["reasoning_effort"] = _REASONING_EFFORT
    else:
        create_kwargs["temperature"] = temperature
    response = client.chat.completions.create(**create_kwargs)
    _maybe_capture_provider_raw(
        provider="openai",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=input_data,
        response_payload=response,
    )
    content = response.choices[0].message.content or ""
    if not content.strip():
        return {"status": "error", "content": "Model returned empty response (reasoning token budget may be too low)", "metadata": {}}
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }},
    }


def _call_openai_multi(
    system_prompt,
    messages,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_openai_sync()
    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)
    create_kwargs: dict = dict(
        model=settings.LLM_MODEL,
        max_completion_tokens=max_tokens,
        messages=api_messages,
    )
    if _REASONING_EFFORT:
        create_kwargs["reasoning_effort"] = _REASONING_EFFORT
    else:
        create_kwargs["temperature"] = temperature
    response = client.chat.completions.create(**create_kwargs)
    _maybe_capture_provider_raw(
        provider="openai",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=messages,
        response_payload=response,
    )
    content = response.choices[0].message.content or ""
    if not content.strip():
        return {"status": "error", "content": "Model returned empty response (reasoning token budget may be too low)", "metadata": {}}
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }},
    }


def rerank_passages(
    query: str,
    passages: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """Rerank retrieved passages using the configured reranker.

    Dispatches to Cohere Rerank (fast, dedicated) or falls back to
    LLM-based scoring when Cohere is unavailable.
    """
    if not passages or len(passages) <= top_k:
        return passages[:top_k]

    if settings.RERANKER_PROVIDER == "cohere" and (settings.COHERE_API_KEY or "").strip():
        return _rerank_passages_cohere(query, passages, top_k)
    return _rerank_passages_llm(query, passages, top_k)


def _rerank_passages_cohere(
    query: str,
    passages: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """Rerank using Cohere Rerank API — 10-50x faster than LLM-based."""
    import cohere

    client = cohere.ClientV2(api_key=settings.COHERE_API_KEY)
    docs = [p.get("text", "")[:512] for p in passages]

    response = client.rerank(
        model=settings.COHERE_RERANK_MODEL,
        query=query,
        documents=docs,
        top_n=top_k,
    )

    results = []
    for r in response.results:
        entry = dict(passages[r.index])
        entry["rerank_score"] = r.relevance_score
        results.append(entry)

    logger.info(
        "[RAG][RERANK] Cohere reranked %d candidates → top-%d (model=%s)",
        len(passages),
        top_k,
        settings.COHERE_RERANK_MODEL,
    )
    return results


def _rerank_passages_llm(
    query: str,
    passages: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """Fallback: rerank using LLM relevance scoring (slower, more expensive)."""
    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("[RAG][RERANK] OPENAI_API_KEY is not set — cannot rerank")

    numbered = []
    for i, p in enumerate(passages):
        excerpt = p.get("text", "")[:300]
        numbered.append(f"[{i + 1}] {excerpt}")
    passages_text = "\n".join(numbered)

    scoring_prompt = (
        "You are a medical relevance scorer for ICU clinical queries.\n"
        "Score each passage's relevance to the query on a scale of 0-10.\n"
        "10 = perfectly relevant, 0 = completely irrelevant.\n\n"
        f"Query: {query}\n\n"
        f"Passages:\n{passages_text}\n\n"
        "Return ONLY a JSON array of integer scores, one per passage. "
        f"Example for {len(passages)} passages: [8, 3, 7, ...]\n"
        "Do not include any other text."
    )

    client = _get_openai_sync()
    response = client.chat.completions.create(
        model=settings.RAG_RERANK_MODEL,
        max_completion_tokens=4096,
        messages=[
            {"role": "system", "content": "You are a relevance scoring assistant. Return only valid JSON."},
            {"role": "user", "content": scoring_prompt},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raise ValueError("[RAG][RERANK] Model returned empty response — token budget may be too low")

    scores = json.loads(raw)
    if not isinstance(scores, list) or len(scores) != len(passages):
        raise ValueError(
            f"[RAG][RERANK] Score count mismatch: got {len(scores) if isinstance(scores, list) else 0}, "
            f"expected {len(passages)}"
        )

    scored = []
    for p, s in zip(passages, scores):
        entry = dict(p)
        entry["rerank_score"] = float(s) if isinstance(s, (int, float)) else 0.0
        scored.append(entry)
    scored.sort(key=lambda x: x["rerank_score"], reverse=True)

    logger.info(
        "[RAG][RERANK] LLM reranked %d candidates → top-%d (model=%s)",
        len(passages),
        top_k,
        settings.RAG_RERANK_MODEL,
    )
    return scored[:top_k]


def summarize_citations(
    question: str,
    citations: List[dict],
) -> List[dict]:
    """Summarize raw citation snippets into structured summaries using LLM.

    Each citation gets: summary (core recommendation), keyQuote (direct quote),
    relevanceNote (why it's relevant). Raises on failure — no silent fallback.
    """
    if not citations:
        return citations

    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("[RAG][CITATION] OPENAI_API_KEY is not set — cannot summarize citations")

    # Build batch prompt with all citations
    sources_text = []
    for i, c in enumerate(citations):
        source_file = c.get("sourceFile", "unknown")
        pages = c.get("pages", [])
        page_str = f"第 {', '.join(str(p) for p in pages)} 頁" if pages else "頁碼不明"
        # Collect all snippets for this citation
        all_snippets = c.get("snippets", [])
        if not all_snippets and c.get("snippet"):
            all_snippets = [c["snippet"]]
        snippet_text = "\n".join(all_snippets[:3])  # max 3 snippets per source
        sources_text.append(
            f"[來源 {i + 1}] {source_file} ({page_str})\n{snippet_text}"
        )

    prompt = (
        f"查詢：{question}\n\n"
        + "\n\n---\n\n".join(sources_text)
    )

    client = _get_openai_sync()
    response = client.chat.completions.create(
        model=settings.RAG_RERANK_MODEL,  # gpt-5-mini — fast and cheap
        max_completion_tokens=4096,  # reasoning models need ~2-3x headroom for thinking tokens
        messages=[
            {"role": "system", "content": TASK_PROMPTS["citation_summary"]},
            {"role": "user", "content": prompt},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raise ValueError("[RAG][CITATION] Model returned empty response — token budget may be too low")

    summaries = json.loads(raw)
    if not isinstance(summaries, list):
        raise ValueError(f"[RAG][CITATION] Expected JSON array, got {type(summaries).__name__}")

    # Attach summaries to citations
    result = []
    for i, c in enumerate(citations):
        entry = dict(c)
        if i < len(summaries) and isinstance(summaries[i], dict):
            entry["summary"] = str(summaries[i].get("summary", ""))
            entry["keyQuote"] = str(summaries[i].get("keyQuote", ""))
            entry["relevanceNote"] = str(summaries[i].get("relevanceNote", ""))
        result.append(entry)

    logger.info(
        "[RAG][CITATION] Summarized %d citations (model=%s)",
        len(citations),
        settings.RAG_RERANK_MODEL,
    )
    return result


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts using OpenAI API. Raises if API key is missing or call fails."""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for embedding. No fallback available.")
    client = _get_openai_sync()
    batch_size = 100
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = client.embeddings.create(
            model=settings.OPENAI_EMBEDDING_MODEL, input=batch, dimensions=1536,
        )
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings


async def embed_texts_cached(texts: List[str]) -> List[List[float]]:
    """Embed texts with Redis caching layer.

    Checks Redis for cached embeddings first; only calls OpenAI API for
    cache misses. Falls back to direct API call if cache is unavailable.
    """
    if not settings.EMBEDDING_CACHE_ENABLED:
        return embed_texts(texts)

    from app.middleware.auth import get_redis
    from app.services.embedding_cache import get_cached_embedding, set_cached_embedding

    redis_client = await get_redis()
    model = settings.OPENAI_EMBEDDING_MODEL

    results: List[Optional[List[float]]] = [None] * len(texts)
    uncached_indices: List[int] = []

    for i, t in enumerate(texts):
        cached = await get_cached_embedding(redis_client, t, model)
        if cached is not None:
            results[i] = cached
        else:
            uncached_indices.append(i)

    if uncached_indices:
        uncached_texts = [texts[i] for i in uncached_indices]
        new_embeddings = embed_texts(uncached_texts)
        for j, idx in enumerate(uncached_indices):
            results[idx] = new_embeddings[j]
            await set_cached_embedding(redis_client, texts[idx], model, new_embeddings[j])

    cache_hits = len(texts) - len(uncached_indices)
    if cache_hits > 0:
        logger.info("[EMB_CACHE] %d/%d cache hits", cache_hits, len(texts))

    return results  # type: ignore[return-value]


def generate_chunk_context(doc_text: str, chunk_text: str) -> str:
    """Generate a short contextual prefix for a chunk using LLM.

    Used by Contextual Retrieval to situate each chunk within its source
    document before embedding, improving retrieval accuracy by ~67%.

    Args:
        doc_text: Full (or truncated) source document text.
        chunk_text: The specific chunk to contextualize.

    Returns:
        A 1-2 sentence context string in Traditional Chinese.
    """
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for contextual retrieval.")
    client = _get_openai_sync()

    system_prompt = TASK_PROMPTS["contextual_chunk"]
    max_doc = getattr(settings, "RAG_CONTEXTUAL_MAX_DOC_CHARS", 8000)
    truncated_doc = doc_text[:max_doc]
    if len(doc_text) > max_doc:
        truncated_doc += "\n...(文件已截斷)..."

    user_msg = (
        f"<document>\n{truncated_doc}\n</document>\n\n"
        f"<chunk>\n{chunk_text}\n</chunk>"
    )

    model = getattr(settings, "RAG_CONTEXTUAL_MODEL", "gpt-5")
    response = client.chat.completions.create(
        model=model,
        max_completion_tokens=2048,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
    )
    return response.choices[0].message.content.strip()


def _call_anthropic(
    system_prompt,
    input_data,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_anthropic_sync()
    response = client.messages.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": json.dumps(input_data, ensure_ascii=False, default=str)}],
    )
    _maybe_capture_provider_raw(
        provider="anthropic",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=input_data,
        response_payload=response,
    )
    return {
        "status": "success",
        "content": response.content[0].text,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }},
    }


def _call_anthropic_multi(
    system_prompt,
    messages,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_anthropic_sync()
    response = client.messages.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    )
    _maybe_capture_provider_raw(
        provider="anthropic",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=messages,
        response_payload=response,
    )
    return {
        "status": "success",
        "content": response.content[0].text,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }},
    }
