"""Pure helpers behind /api/v1/clinical — parsing, hashing, guardrail
sectioning and polish request/response shaping.

Extracted from app.routers.clinical (2026-07-19) so the logic is unit-testable
without HTTP. The SSE generators stay in the router: they are bound to
Request/StreamingResponse. Serializer-dependent _get_patient_dict also stays
until the shared response-schema layer (B2) exists.
"""
from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from app.config import settings
from app.services.safety_guardrail import apply_safety_guardrail

if TYPE_CHECKING:  # pragma: no cover
    from app.models.user import User
    from app.schemas.clinical import PolishRequest


def _try_parse_soap_json(text: str) -> Optional[Dict[str, str]]:
    """Best-effort JSON parse for pharmacist_polish output ({s,o,a,p}).

    Returns the parsed dict on success, None otherwise. Strips markdown fences
    and surrounding whitespace.
    """
    if not text:
        return None
    raw = text.strip()
    if raw.startswith("```"):
        # Strip ```json ... ``` or ``` ... ``` fences.
        raw = raw.lstrip("`")
        # Drop an optional language tag line.
        first_newline = raw.find("\n")
        if first_newline != -1 and raw[:first_newline].strip().isalpha():
            raw = raw[first_newline + 1 :]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    out: Dict[str, str] = {}
    for key in ("s", "o", "a", "p"):
        value = data.get(key, "")
        out[key] = value if isinstance(value, str) else ""
    return out


def _polish_input_sha256(req: "PolishRequest") -> str:
    """P2.15: stable hash of the polish inputs for repro. Order-independent
    over dict keys; None-safe on optional fields."""
    canonical = json.dumps(
        {
            "content": req.content or "",
            "polish_type": req.polish_type,
            "polish_mode": req.polish_mode,
            "task": req.task,
            "target_section": req.target_section,
            "soap_sections": req.soap_sections or None,
            "instruction": req.instruction or None,
            "previous_polished": req.previous_polished or None,
            "template_content": req.template_content or None,
            "format_constraints": req.format_constraints or None,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _guardrail_sections(
    sections: Dict[str, str],
    user_role: Optional[str],
) -> Dict[str, Any]:
    """P2.16: run apply_safety_guardrail per S/O/A/P so warnings can be
    attributed to the section that triggered them. Returns the section-keyed
    content dict plus a merged warnings list (each prefixed with [section])."""
    per_section_content: Dict[str, str] = {}
    merged_warnings: List[str] = []
    any_flagged = False
    for key in ("s", "o", "a", "p"):
        value = sections.get(key, "") or ""
        result = apply_safety_guardrail(
            value, user_role=user_role, include_disclaimer=False
        )
        per_section_content[key] = result["content"]
        if result["flagged"]:
            any_flagged = True
            for w in result["warnings"]:
                merged_warnings.append(f"[{key.upper()}] {w}")
    return {
        "content": per_section_content,
        "warnings": merged_warnings,
        "flagged": any_flagged,
    }


def _trim_patient_for_pharmacist(patient_data: Dict[str, Any], target_section: Optional[str]) -> Dict[str, Any]:
    """P5: reduce patient context based on which SOAP section the AI will touch.

    Pharmacist_polish preserves S and O verbatim and only rewrites A/P. Vital
    signs and ventilator settings are irrelevant to medication-advice polish
    for every target_section; dropping them shaves ~30% prompt tokens and
    improves cache stability.
    """
    if not patient_data:
        return patient_data
    trimmed = dict(patient_data)
    # Always drop bedside telemetry / ventilator — pharmacist medication advice
    # does not reference these and they change on every visit (cache-unfriendly).
    trimmed.pop("vital_signs", None)
    trimmed.pop("ventilator_settings", None)
    if target_section in ("s", "o"):
        # S/O are pasted verbatim from HIS and echoed back untouched. The model
        # needs only the minimum identity fields for context — strip labs/meds.
        for k in ("lab_data", "medications", "symptoms"):
            trimmed.pop(k, None)
    return trimmed


def _extract_json_string_value(buf: str, key: str) -> Optional[str]:
    """Best-effort streaming extractor for a top-level string value in a JSON
    buffer that's still being assembled. Returns the decoded chars seen so
    far for ``key`` (may be partial — caller should keep calling as buf grows),
    or ``None`` if the key marker has not arrived yet.

    Handles standard JSON escapes including ``\\uXXXX``.

    P1-C7: surrogate pairs are now decoded as a single non-BMP code point
    (e.g. ``"\\uD83D\\uDC8A"`` → "💊", ``"\\uD842\\uDF9F"`` → "𠀋"). The
    previous version emitted each half as ``chr(0xD83D)`` which is an
    invalid code point that the frontend's TextDecoder either rendered as
    U+FFFD or threw on. When a buffer ends after a high-surrogate but
    before its low-surrogate arrives, we stop and let the next call resume
    from the same position — the partial result so far is still safe.
    """
    marker = f'"{key}":"'
    idx = buf.find(marker)
    if idx < 0:
        return None
    out: List[str] = []
    i = idx + len(marker)
    n = len(buf)
    while i < n:
        ch = buf[i]
        if ch == '\\':
            if i + 1 >= n:
                break
            nxt = buf[i + 1]
            if nxt == 'n':
                out.append('\n')
                i += 2
            elif nxt == 't':
                out.append('\t')
                i += 2
            elif nxt == 'r':
                out.append('\r')
                i += 2
            elif nxt == 'b':
                out.append('\b')
                i += 2
            elif nxt == 'f':
                out.append('\f')
                i += 2
            elif nxt == '/':
                out.append('/')
                i += 2
            elif nxt == '\\':
                out.append('\\')
                i += 2
            elif nxt == '"':
                out.append('"')
                i += 2
            elif nxt == 'u':
                if i + 6 > n:  # need 4 hex chars
                    break
                try:
                    cp = int(buf[i + 2 : i + 6], 16)
                except ValueError:
                    out.append(nxt)
                    i += 2
                    continue
                # P1-C7: surrogate-pair handling. High surrogate alone is
                # invalid — wait for the matching \\uYYYY and combine.
                if 0xD800 <= cp <= 0xDBFF:
                    if i + 12 > n or buf[i + 6 : i + 8] != '\\u':
                        # Low half not in buffer yet — stop and resume next call.
                        break
                    try:
                        low = int(buf[i + 8 : i + 12], 16)
                    except ValueError:
                        out.append(nxt)
                        i += 2
                        continue
                    if 0xDC00 <= low <= 0xDFFF:
                        combined = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00)
                        out.append(chr(combined))
                        i += 12
                        continue
                    # Malformed — fall through and emit as-is.
                if 0xDC00 <= cp <= 0xDFFF:
                    # Stray low surrogate — emit U+FFFD replacement.
                    out.append('�')
                    i += 6
                    continue
                out.append(chr(cp))
                i += 6
            else:
                out.append(nxt)
                i += 2
            continue
        if ch == '"':
            return ''.join(out)
        out.append(ch)
        i += 1
    return ''.join(out)


def _build_polish_context(req: PolishRequest, patient_data: Dict[str, Any], user: User):
    """Shared input-construction for both sync and streaming polish endpoints."""
    task_name = req.task or "clinical_polish"
    is_pharmacist = task_name == "pharmacist_polish"
    is_refinement = (req.polish_mode == "refinement") or bool(
        req.instruction and req.previous_polished
    )

    if is_pharmacist:
        trimmed_patient = _trim_patient_for_pharmacist(patient_data, req.target_section)
        input_data: Dict[str, Any] = {
            "patient": trimmed_patient,
            "polish_type": req.polish_type,
            "polish_mode": req.polish_mode or "full",
            "soap_sections": req.soap_sections or {"s": "", "o": "", "a": "", "p": ""},
            "target_section": req.target_section or "a_and_p",
            "format_constraints": req.format_constraints or {},
            "user_role": user.role,
        }
        if is_refinement:
            input_data["user_instruction"] = req.instruction or ""
            input_data["previous_polished"] = req.previous_polished or ""
        if req.content:
            input_data["draft_content"] = req.content
    elif is_refinement:
        input_data = {
            "mode": "REFINEMENT",
            "user_instruction": req.instruction,
            "previous_polished": req.previous_polished,
            "polish_type": req.polish_type,
            "draft_content": req.content,
            "patient": patient_data,
            "user_role": user.role,
        }
    else:
        input_data = {
            "patient": patient_data,
            "draft_content": req.content,
            "polish_type": req.polish_type,
            "user_role": user.role,
        }
        if req.template_content:
            input_data["template_format"] = req.template_content

    # grammar_only mode only fixes typos/grammar — reasoning tokens add 3–5s
    # with no quality gain, so skip them. full / refinement keep reasoning.
    disable_reasoning = (req.polish_mode == "grammar_only")

    return task_name, is_pharmacist, is_refinement, input_data, disable_reasoning


def _build_polish_response_data(
    req: PolishRequest,
    *,
    task_name: str,
    is_pharmacist: bool,
    raw_content: str,
    usage_meta: Dict[str, Any],
    user_role: Optional[str],
    data_freshness: Any,
):
    """Shared post-LLM processing: guardrail + JSON parse + response shape."""
    guardrail = apply_safety_guardrail(raw_content, user_role=user_role, include_disclaimer=False)

    polished_sections: Optional[Dict[str, str]] = None
    parse_ok: Optional[bool] = None
    if is_pharmacist:
        polished_sections = _try_parse_soap_json(guardrail["content"])
        parse_ok = polished_sections is not None
        if polished_sections is not None:
            sectioned = _guardrail_sections(polished_sections, user_role=user_role)
            polished_sections = sectioned["content"]
            guardrail = {
                **guardrail,
                "warnings": sectioned["warnings"],
                "flagged": sectioned["flagged"],
                "requiresExpertReview": sectioned["flagged"],
            }

    metadata: Dict[str, Any] = {"model": settings.LLM_MODEL, "usage": usage_meta}
    if parse_ok is not None:
        metadata["parse_ok"] = parse_ok

    response_data: Dict[str, Any] = {
        "patient_id": req.patient_id,
        "polish_type": req.polish_type,
        "task": task_name,
        "polish_mode": req.polish_mode,
        "original": req.content,
        "polished": guardrail["content"],
        "metadata": metadata,
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    }
    if polished_sections is not None:
        response_data["polished_sections"] = polished_sections
    return response_data, guardrail
