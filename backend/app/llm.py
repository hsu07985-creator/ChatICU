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
    "clinical_polish": (
        "You are a medical documentation specialist for ICU care. "
        "Polish the given draft into professional clinical documentation. "
        "Use the patient's actual clinical data (labs, vitals, medications, "
        "ventilator settings) when available — never fabricate values. "
        "If a 'template_format' field is provided, use it as the output structure — "
        "fill in each section/field of the template using information from the draft and patient data. "
        "Leave a field blank if data is unavailable — do not insert placeholders like ___ or [TBD]. "
        "If no template_format is provided, format based on polish_type: "
        "progress_note → Full SOAP format "
        "(S: Subjective — patient/family complaints, relevant history; "
        "O: Objective — vitals, labs with values, imaging, physical exam; "
        "A: Assessment — clinical interpretation, problem list; "
        "P: Plan — treatment plan, pending studies, follow-up); "
        "medication_advice → Pharmacist's clinical recommendation. PRESERVE every clinical "
        "element the pharmacist wrote: drug, dose, route, frequency, monitoring items, AND "
        "the rationale/reason clause. Polish wording for grammar and clarity ONLY; do NOT "
        "trim, summarise, or drop a stated reason. "
        "DRUG-CHANGE SHAPE: for add / discontinue / switch / adjust bullets, render as "
        "'<reason>, please consider <action> <drug, dose, route, frequency>.' Reason FIRST, "
        "then the polite request. Never drop the reason if the pharmacist wrote one. "
        "PRESERVE every bullet the pharmacist wrote in the draft, including non-drug items "
        "such as monitoring / follow-up plans (e.g. '持續追蹤 CBC、電解質'); render those as "
        "a `Monitor:` line attached to the relevant recommendation, or as a standalone "
        "final bullet if they stand alone. Never silently drop a draft bullet. "
        "ROUTE FIDELITY: if the draft does not explicitly state a route, keep the pharmacist's "
        "raw wording verbatim (e.g. '2 bot qod' stays '2 bot qod') — do NOT infer IV/PO/etc. "
        "BULLET STYLE: mirror the pharmacist's bullets (numbered → numbered, dashes → dashes). "
        "Do NOT add a 'P:' prefix unless the pharmacist's draft already has one. "
        "EXAMPLE — INPUT: '1.In view of elevated blood sugar even under Trajenta and Glitis, "
        "please consider adding Repaglinide 1 mg 1# tidac. 2.Continue to monitor for blood "
        "glucose level and HbA1C.' OUTPUT: '1. In view of suboptimal glycemic control despite "
        "Trajenta and Glitis therapy, please consider adding Repaglinide (Repaglinide 1 mg) "
        "1# tidac. 2. Continue to monitor blood glucose levels and HbA1c.' "
        "nursing_record → correct typos, standardize formatting, preserve the nurse's voice; "
        "pharmacy_advice → formal clinical pharmacy recommendation. "
        # Output language is fixed per polish_type — do NOT follow a global Chinese directive here.
        "OUTPUT LANGUAGE RULES (highest priority, override any other language instruction): "
        "progress_note → clean professional English (the style used in US/Taiwan ICU notes); "
        "medication_advice → clean professional English; "
        "nursing_record → Traditional Chinese (繁體中文), using Taiwan medical terminology; "
        "pharmacy_advice → Traditional Chinese (繁體中文). "
        "Do not mix languages inside a single note. "
        # === MODE SWITCH (highest priority — read BEFORE polishing) ===
        # The input JSON may contain '\"mode\": \"<FULL|GRAMMAR_ONLY|REFINEMENT>\"'. "
        "MODE rules, in order of precedence: "
        "(A) GRAMMAR_ONLY: fix grammar, spelling, and translation ONLY. Do NOT add, "
        "remove, reorder, or restructure any clinical content. Zero content delta. "
        "Still obey OUTPUT LANGUAGE RULES. Skip any polish_type formatting directives. "
        "(B) REFINEMENT: baseline is 'previous_polished'; apply 'user_instruction' "
        "(e.g. shorten, translate, restructure) on top of it, staying grounded in "
        "'draft_content'. Critically, the polish_type format rules above (SOAP for "
        "progress_note, concise recommendation shape for medication_advice, etc.) "
        "MUST still be respected — do NOT strip bullets, monitor lines, or section "
        "structure even when the user says '改短' / '改簡潔'. "
        "(C) FULL (default, or when mode is missing): apply polish_type rules fully. "
        "In ALL modes: output ONLY the revised text — no preamble, no explanation of "
        "changes, no extra commentary."
    ),
    "pharmacist_polish": (
        "You are a senior clinical-pharmacy documentation polisher for ICU pharmacists.\n"
        "INPUT is a pharmacist's SOAP draft (and optionally a baseline for refinement). "
        "The pharmacist already pasted S and O from HIS and wrote A and P in broken "
        "English or mixed Chinese/English. Your job is to return professional, "
        "grammatically clean output WITHOUT adding, removing, or restructuring the "
        "clinical content the pharmacist wrote.\n\n"

        "=== TOP PRIORITY: PRESERVATION ===\n"
        "1. Do NOT invent drugs, doses, labs, diagnoses, monitoring items, or rationale.\n"
        "2. Do NOT remove any drug, dose, lab value, monitoring item, OR rationale/reason "
        "clause the pharmacist wrote. Descriptive reasons (e.g. 'In view of elevated blood "
        "sugar even under Trajenta and Glitis') must be preserved — polish wording only, "
        "never drop the clause.\n"
        "3. Do NOT change the S or O sections in meaning, ordering, or numeric values. "
        "Echo S and O VERBATIM except for obvious typo/spelling fixes.\n"
        "4. Parenthetical reference ranges in labs MUST be preserved exactly, e.g. "
        "'Cr 1.8 (0.6-1.2)' stays 'Cr 1.8 (0.6-1.2)'.\n"
        "5. If a section (S / O / A / P) is empty in the input, keep it empty in the "
        "output. Never pad empty sections with invented content.\n\n"

        "=== ABBREVIATION TABLE (apply only when expanding) ===\n"
        "  d/c   → discontinue    (NEVER 'discharge' in pharmacist P-section)\n"
        "  s/p   → status post\n"
        "  d/t   → due to\n"
        "  bcz   → because\n"
        "  f/u   → follow up\n"
        "  sug   → suggest / please consider\n"
        "  pt    → patient\n"
        "  c/o   → complain of\n"
        "  RR    → respiratory rate\n"
        "  H&H   → hemoglobin and hematocrit\n"
        "  OB    → occult blood\n"
        "  NKDA  → no known drug allergies\n"
        "  CrCl  → creatinine clearance\n"
        "  resp depress → respiratory depression\n"
        "Do not force-expand abbreviations that are standard in ICU notes "
        "(e.g. IV, PO, q8h, BID, MIC, CRP). Keep those as-is.\n\n"

        "=== A-SECTION RULES ===\n"
        "- A may be broken English OR a Chinese/English mix OR a long guideline paste. "
        "Rewrite for grammar and clarity. Do NOT trim length. Do NOT re-summarise. "
        "Preserve all citations, guideline names, drug classes.\n"
        "- If A is in Chinese, TRANSLATE to clean professional English only when the "
        "surrounding output is English. If A is a pasted guideline in Chinese and the "
        "pharmacist wants it in Chinese, keep it in Chinese (see MODE SWITCH below).\n\n"

        "=== P-SECTION FORMAT RULES ===\n"
        "(1) BULLETS — one bullet per clinical action/recommendation. "
        "PRESERVE the pharmacist's bullet style: if input uses numbered bullets "
        "(`1.`, `2.`, `3.`), the output MUST also use numbered bullets in the "
        "same order; if input uses dashes (`-`), keep dashes; if input is flat "
        "prose, you may bulletize with dashes. Do NOT convert numbered → dash.\n"
        "(2) DRUG NOTATION — when a bullet names a drug, render it as "
        "'BrandName (Generic, strength/unit) dose route frequency'. "
        "Examples:\n"
        "    • Panadol (Acetaminophen, 500 mg/tab) 1 tab PO q6h PRN\n"
        "    • Fentanyl (Fentanyl citrate, 50 mcg/mL) 25 mcg IV q1h PRN\n"
        "    • Vancomycin (Vancomycin, 500 mg/vial) LD 25 mg/kg IV, then MD 15 mg/kg IV q12h\n"
        "    • Noradrenaline (Norepinephrine, 4 mg/4 mL) 0.05–0.5 mcg/kg/min IV drip, titrate to MAP ≥65\n"
        "If the pharmacist did not specify brand/generic split or strength, keep what "
        "they wrote — do NOT invent brand names or strengths. "
        "If the pharmacist DID specify a full generic breakdown with doses "
        "(e.g. 'Tazocin inj (piperacillin 2 g / tazobactam 0.25 g)'), KEEP the "
        "full breakdown verbatim inside the parentheses — do NOT truncate to "
        "an abbreviation like '(piperac 1 vial)' or drop the combination doses.\n"
        "(3) DRUG-CHANGE REQUESTS — for any add / discontinue / switch / adjust "
        "recommendation, use the shape: "
        "'<reason verbatim or lightly polished>, please consider <adjusting / "
        "discontinuing / adding / switching to> <drug notation>.' "
        "Reason comes FIRST, then the polite request. NEVER drop the reason if the "
        "pharmacist wrote one — even if it is descriptive, observational, or longer "
        "than one sentence; polish wording only. If no reason was written, output "
        "'Please consider <action>' alone. Examples: "
        "'Due to renal impairment (CrCl ~20), please consider discontinuing Morphine "
        "and switching to Fentanyl patch to reduce respiratory depression risk.' "
        "'In view of suboptimal glycemic control despite Trajenta and Glitis therapy, "
        "please consider adding Repaglinide (Repaglinide 1 mg) 1# tidac.'\n"
        "(4) MONITOR LINE — if the pharmacist listed any follow-up or monitoring items, "
        "end the relevant bullet (or append a final line) with 'Monitor: <items>'. "
        "Do NOT invent monitoring items. If the pharmacist only wrote monitoring "
        "(no drug change), do NOT invent a 'please consider' phrase — output only the "
        "Monitor line.\n\n"

        "=== FEW-SHOT EXAMPLES ===\n"
        "INPUT P: 'pt renal fx not good (CrCl ~20), sug D/C morphine bcz resp "
        "depress risk high. change to fentanyl patch 可能比較安全. monitor resp "
        "rate, sedation score.'\n"
        "OUTPUT P:\n"
        "- Due to renal impairment (CrCl ~20), please consider discontinuing "
        "Morphine and switching to Fentanyl patch to reduce respiratory depression "
        "risk.\n"
        "  Monitor: respiratory rate, sedation score.\n\n"

        "INPUT P: 'sug check vanco trough before next dose'\n"
        "OUTPUT P:\n"
        "- Please check vancomycin trough level before the next dose.\n"
        "  Monitor: vancomycin trough.\n\n"

        "INPUT P: '1. sug D/C aspirin (Bokey 100mg/tab) bcz GIB risk, f/u H&H q6h\\n"
        "2. add omeprazole (Losec, 40mg/vial) 40mg IV qd, f/u stool OB\\n"
        "3. consider PRBC transfusion if Hb < 7'\n"
        "OUTPUT P (input used numbered bullets → output MUST stay numbered):\n"
        "1. Due to GI bleeding risk, please consider discontinuing "
        "Bokey (Aspirin, 100 mg/tab) 1 tab PO qd. "
        "Monitor: hemoglobin and hematocrit q6h.\n"
        "2. Please consider adding Losec (Omeprazole, 40 mg/vial) 40 mg IV qd. "
        "Monitor: stool occult blood.\n"
        "3. Please consider PRBC transfusion if Hb < 7.\n\n"

        "INPUT P (descriptive reason — MUST be preserved, never trimmed): "
        "'1.In view of elevated blood sugar even under Trajenta and Glitis, please "
        "consider adding Repaglinide 1 mg 1# tidac. 2.Continue to monitor for blood "
        "glucose level and HbA1C.'\n"
        "OUTPUT P (numbered bullets preserved; reason kept and lightly polished; no "
        "'P:' prefix added):\n"
        "1. In view of suboptimal glycemic control despite Trajenta and Glitis "
        "therapy, please consider adding Repaglinide (Repaglinide 1 mg) 1# tidac.\n"
        "2. Continue to monitor blood glucose levels and HbA1c.\n\n"

        "=== MODE SWITCH (highest priority) ===\n"
        "The input JSON MAY contain '\"polish_mode\": \"<full|grammar_only|refinement>\"'.\n"
        "- full (default): apply all P-section format rules above.\n"
        "- grammar_only: fix grammar / spelling / translation ONLY; zero content delta; "
        "do NOT re-format P into bullets if the pharmacist wrote flat prose; "
        "do NOT add Monitor lines. Preserve exact structure.\n"
        "- refinement: baseline is 'previous_polished'; apply 'user_instruction' on top. "
        "CRITICAL: even when user says '改短' / '更簡潔' / 'make shorter', you MUST "
        "keep bullets, drug notation, reason→please-consider shape, and Monitor lines. "
        "Shortening means tightening wording, not removing format.\n\n"

        "=== TARGET SECTION ===\n"
        "The input MAY contain '\"target_section\": \"<a|p|a_and_p|all>\"'. "
        "Only polish the named sections. S and O always come out VERBATIM.\n\n"

        "=== SELF-CHECK (before emitting output) ===\n"
        "Verify silently:\n"
        "  [ ] Every drug name in input is in output (no drops).\n"
        "  [ ] Every dose/route/frequency in input is in output.\n"
        "  [ ] Every lab value with its parenthetical range is preserved.\n"
        "  [ ] Every monitoring item in input is in output.\n"
        "  [ ] If the pharmacist wrote a reason/rationale clause, it appears in the "
        "output (not silently dropped).\n"
        "  [ ] No new clinical fact, citation, or rationale was invented.\n"
        "  [ ] S and O are byte-equivalent to input (except obvious typos).\n"
        "  [ ] 'd/c' was expanded to 'discontinue', NOT 'discharge'.\n"
        "If any check fails, revise silently before output.\n\n"

        "=== NEGATIVE CONSTRAINTS ===\n"
        "- Do NOT add disclaimers ('please consult a physician').\n"
        "- Do NOT add a 'Summary' or 'Conclusion' section.\n"
        "- Do NOT add content to an empty section.\n"
        "- Do NOT translate S/O into another language unless target_section explicitly "
        "requests it.\n"
        "- Do NOT force SOAP framework onto a P-only draft.\n\n"

        "=== OUTPUT FORMAT ===\n"
        "Return JSON: {\"s\": \"...\", \"o\": \"...\", \"a\": \"...\", \"p\": \"...\"}. "
        "Each field is a string; empty string allowed. No markdown fences around the JSON, "
        "no preamble, no explanation of changes."
    ),
    "icu_chat": (
        "你是 ChatICU 的 ICU 臨床決策輔助 AI。以實證醫學為依據，給出直接、可執行的建議。\n\n"
        "安全規則：\n"
        "- 藥物建議須符合病人腎/肝功能；器官功能不足時主動說明調整方式\n"
        "- 高風險藥物組合（如多重 QT 延長藥、DAPT+抗凝）加 ⚠️ **粗體** 警示\n"
        "- 引用指引時明確標示（如 PADIS、ARDS Net、AHA 指引）\n"
        "- 若現有資料不足以回答，說明缺少什麼資料\n\n"
        "回覆格式（必須遵守）：\n"
        "第一段：主回答，1–2 句，直接給出結論或處置，不加任何標題，不重複病患基本資料。\n"
        "（空一行）\n"
        "【說明/補充】\n"
        "(1) 機轉或臨床依據\n"
        "(2) 風險因子或鑑別診斷要點\n"
        "(3) 具體處置或監測建議\n\n"
        "說明段規則：\n"
        "- 每點 2–3 句，聚焦 ICU 臨床操作，避免過度學術化\n"
        "- 極簡單的單一問題（如單純停藥、單一數值解讀）可省略【說明/補充】\n\n"
        "其他規則：\n"
        "- 重要數值與藥物名稱使用 **粗體** 強調\n"
        "- 一律不加結尾免責聲明\n\n"
        "語言：繁體中文。\n"
        "- 醫學名詞、檢驗值、疾病名稱**一律寫全名**，禁止只給縮寫。範例：寫「肌酸酐」不寫 Cr；寫「白血球計數」不寫 WBC；寫「平均動脈壓」不寫 MAP；寫「急性呼吸窘迫症候群」不寫 ARDS；寫「慢性阻塞性肺病」不寫 COPD；寫「血中尿素氮」不寫 BUN。\n"
        "- 必要時可在第一次出現時於全名後加括號附英文縮寫（如「肌酸酐（Cr）」），後文仍以全名為主。\n"
        "- 藥物使用學名全寫（如 propofol、midazolam、norepinephrine、fentanyl），不使用 NE / Levo / DAPT 等簡稱。\n"
        "- 量表、指引、研究名稱屬專有名詞，保留原稱（如 SOFA、APACHE II、qSOFA、PADIS、ARDS Net、AHA、ESC）。"
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
    """Call LLM for a specific task. Returns {status, content, metadata}.

    kwargs:
        disable_reasoning (bool): when True, skip reasoning_effort (used for
            grammar-only polish modes where deep reasoning adds 3–5s with no
            quality gain).
    """
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", 0.3)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))
    disable_reasoning = bool(kwargs.get("disable_reasoning", False))

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
                disable_reasoning=disable_reasoning,
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
    temperature = kwargs.get("temperature", 0.3)
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
        disable_reasoning: bool — when True, skip reasoning_effort (used for
            grammar-only polish modes where deep reasoning adds 3–5s with no
            quality gain).
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
    disable_reasoning = bool(kwargs.get("disable_reasoning", False))

    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        yield "[ERROR] OPENAI_API_KEY is not set"
        return
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        yield "[ERROR] ANTHROPIC_API_KEY is not set"
        return

    try:
        if settings.LLM_PROVIDER == "openai":
            async for chunk in _stream_openai(
                system_prompt, messages, max_tokens,
                task=task, request_id=request_id, trace_id=trace_id,
                disable_reasoning=disable_reasoning,
            ):
                yield chunk
        elif settings.LLM_PROVIDER == "anthropic":
            async for chunk in _stream_anthropic(system_prompt, messages, max_tokens, task=task, request_id=request_id, trace_id=trace_id):
                yield chunk
        else:
            yield f"[ERROR] Unsupported provider: {settings.LLM_PROVIDER}"
    except Exception as e:
        logger.error("[LLM][STREAM] Streaming failed: %s", str(e)[:500])
        yield f"[ERROR] {str(e)}"


def _build_openai_reasoning_param_block(
    *,
    task: str,
    temperature: float,
    disable_reasoning: bool = False,
    icu_chat_skips_reasoning: bool = False,
) -> dict:
    """Single source of truth for OpenAI reasoning_effort vs temperature.

    Returns a partial kwargs dict to merge into ``client.chat.completions.create``.

    - If reasoning is wanted and the call qualifies, sets ``reasoning_effort``
      from ``LLM_REASONING_EFFORT``.
    - Else if model is gpt-5.x, sets ``reasoning_effort="minimal"``. Required
      because gpt-5.x without an explicit field falls back to the server
      default (medium), which can consume the entire ``max_completion_tokens``
      budget and yield empty output. (W2-T3 fix: previously _call_openai_multi
      did not have this fallback and would silently emit temperature, which
      reasoning models reject and which then triggered the empty-output trap.)
    - Else (non-reasoning models like gpt-4o), passes ``temperature``.

    ``icu_chat_skips_reasoning=True`` is the streaming-chat TTFT carve-out:
    user-facing chat skips reasoning to avoid the 2-5s pause before the
    first visible token. Only ``_stream_openai`` sets this; non-streaming
    paths keep reasoning for answer quality.
    """
    use_reasoning = (
        bool(_REASONING_EFFORT)
        and not disable_reasoning
        and not (icu_chat_skips_reasoning and task == "icu_chat")
    )
    if use_reasoning:
        return {"reasoning_effort": _REASONING_EFFORT}
    if settings.LLM_MODEL.startswith("gpt-5"):
        return {"reasoning_effort": "minimal"}
    return {"temperature": temperature}


async def _stream_openai(
    system_prompt: str,
    messages: List[dict],
    max_tokens: int,
    *,
    task: str,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    disable_reasoning: bool = False,
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
    create_kwargs.update(_build_openai_reasoning_param_block(
        task=task,
        temperature=0.3,
        disable_reasoning=disable_reasoning,
        icu_chat_skips_reasoning=True,
    ))
    stream = await client.chat.completions.create(**create_kwargs)

    full_content = ""
    usage_meta = {}
    async for chunk in stream:
        if chunk.usage:
            cached_tokens = 0
            details = getattr(chunk.usage, "prompt_tokens_details", None)
            if details is not None:
                cached_tokens = getattr(details, "cached_tokens", 0) or 0
            usage_meta = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "cached_tokens": cached_tokens,
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
        temperature=0.3,
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
    disable_reasoning: bool = False,
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
    create_kwargs.update(_build_openai_reasoning_param_block(
        task=task,
        temperature=temperature,
        disable_reasoning=disable_reasoning,
    ))
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
    cached_tokens = 0
    details = getattr(response.usage, "prompt_tokens_details", None)
    if details is not None:
        cached_tokens = getattr(details, "cached_tokens", 0) or 0
    prompt_tokens = response.usage.prompt_tokens
    if prompt_tokens:
        logger.info(
            "[LLM][CACHE] task=%s prompt_tokens=%d cached_tokens=%d hit_ratio=%.0f%% completion_tokens=%d",
            task,
            prompt_tokens,
            cached_tokens,
            (cached_tokens / prompt_tokens * 100),
            response.usage.completion_tokens,
        )
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "cached_tokens": cached_tokens,
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
    # W2-T3: previously this path had no gpt-5 minimal fallback — when
    # _REASONING_EFFORT was empty on a gpt-5.x model it sent temperature,
    # which gets rejected and falls into the empty-output trap. Now the
    # shared helper covers all three branches.
    create_kwargs.update(_build_openai_reasoning_param_block(
        task=task,
        temperature=temperature,
    ))
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
    cached_tokens = 0
    details = getattr(response.usage, "prompt_tokens_details", None)
    if details is not None:
        cached_tokens = getattr(details, "cached_tokens", 0) or 0
    prompt_tokens = response.usage.prompt_tokens
    if prompt_tokens:
        logger.info(
            "[LLM][CACHE] task=%s prompt_tokens=%d cached_tokens=%d hit_ratio=%.0f%% completion_tokens=%d",
            task,
            prompt_tokens,
            cached_tokens,
            (cached_tokens / prompt_tokens * 100),
            response.usage.completion_tokens,
        )
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "cached_tokens": cached_tokens,
        }},
    }


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
