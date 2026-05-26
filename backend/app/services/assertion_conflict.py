"""LLM-free detector for user-vs-snapshot factual conflicts.

Step 2 of the AI-chat sycophancy mitigation plan: when the user says
something like "病人沒有 meropenem" while the snapshot still lists
meropenem as an active medication, we don't want the LLM to silently
agree. This module produces a deterministic [系統偵測] block that we
inject into the LLM-facing user_message — paired with the fact-checking
prompt rules added in step 1, it makes the conflict impossible to ignore.

Design choices:
- Pure Python, no LLM call. Cheap (sub-millisecond) and deterministic.
- Only flags negation + drug-name co-occurrence in the *same clause*
  (split on Chinese/English sentence delimiters). Avoids classic false
  positives like "病人沒有發燒，meropenem 是否繼續？" where 沒有 belongs
  to a different clause.
- Does NOT try to decide whether the user gave a valid stop-time/reason.
  That judgment stays with the LLM, which (per step 1's prompt) is told
  to accept verbal updates only when they include time / reason / order
  ID. Detector's job is purely "is there a surface-level conflict to
  surface?" — LLM resolves it.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional


# Negation cues that *precede* a drug name, both Chinese and English.
# Kept conservative — false positives erode user trust faster than misses.
_NEGATION_CUES = (
    # 中文
    "沒有", "目前沒有", "沒在用", "沒在使用", "不在使用", "不在用",
    "沒用", "沒打", "沒給", "沒吃", "未使用", "目前未使用",
    "已停", "停了", "停用", "停掉", "已停用", "未開", "沒開",
    "沒有開", "沒在開",
    # English (lowercased — message is lowercased before matching)
    "not on ", "not using ", "no ", "stopped ", "discontinued ",
    "off ", "not taking ", "isn't on ", "is not on ", "has stopped ",
    "no longer on ", "has been stopped ",
)

# Clause delimiters — we only consider a negation valid if it sits in
# the *same clause* as the drug name (no boundary between them).
_CLAUSE_BOUNDARY = re.compile(r"[，。！？；;,.!?\n\r]")

# Max distance (in chars) between negation cue and drug name within a
# clause. Tightened to avoid matches like "沒有 X 之外還有 Y" where Y
# isn't being negated.
_MAX_PROXIMITY = 18


def detect_med_negation_conflict(
    user_message: str,
    active_med_names: Iterable[str],
) -> List[Dict[str, Any]]:
    """Find active medications the user appears to be denying.

    Returns a list of {"med_name": str, "matched_cue": str, "snippet": str}
    where snippet is the original-case text fragment that triggered the
    match (handy for both audit logs and the warning block sent to the LLM).
    Empty list when no conflict found.
    """
    if not user_message or not active_med_names:
        return []

    original = user_message
    lower = user_message.lower()
    conflicts: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for med_name in active_med_names:
        if not med_name:
            continue
        m = med_name.strip().lower()
        if not m or m in seen:
            continue

        # Locate every occurrence of the drug name in the message.
        start = 0
        while True:
            idx = lower.find(m, start)
            if idx < 0:
                break

            # Look backwards within the same clause for a negation cue.
            # Build the clause-local prefix by trimming back to the
            # nearest clause boundary (or start of string).
            prefix_full = lower[max(0, idx - _MAX_PROXIMITY * 2): idx]
            boundary_match = list(_CLAUSE_BOUNDARY.finditer(prefix_full))
            clause_start = boundary_match[-1].end() if boundary_match else 0
            clause_prefix = prefix_full[clause_start:]

            cue = _first_cue_in(clause_prefix)
            if cue is not None:
                snippet_start = max(0, idx - (len(clause_prefix)))
                snippet_end = min(len(original), idx + len(m) + 4)
                conflicts.append({
                    "med_name": med_name,
                    "matched_cue": cue.strip(),
                    "snippet": original[snippet_start:snippet_end].strip(),
                })
                seen.add(m)
                break  # one conflict per drug is enough

            start = idx + len(m)

    return conflicts


def _first_cue_in(clause_prefix: str) -> Optional[str]:
    """Return the negation cue closest to the end of `clause_prefix`
    (i.e. closest to the drug name) if any cue is present.
    """
    best: Optional[str] = None
    best_pos = -1
    for cue in _NEGATION_CUES:
        pos = clause_prefix.rfind(cue)
        if pos > best_pos:
            best_pos = pos
            best = cue
    return best


def format_med_conflict_block(
    conflicts: List[Dict[str, Any]],
    med_records: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Render a [系統偵測] block suitable for injection into user_message.

    `med_records` (optional) gives extra context for each conflicting
    drug — list of dicts with keys: name, dose, unit, frequency, route,
    updated_at_str. When provided, we look up by name (case-insensitive)
    and append the snapshot's full active-medication entry.
    """
    if not conflicts:
        return ""

    records_by_name: Dict[str, Dict[str, Any]] = {}
    for rec in med_records or []:
        nm = (rec.get("name") or "").strip().lower()
        if nm:
            records_by_name[nm] = rec

    lines = ["[系統偵測：使用者聲明與臨床快照衝突]"]
    lines.append(
        "使用者本輪訊息含否定字樣，疑似主張病人未在使用以下藥物，"
        "但快照仍記載為 active："
    )
    for c in conflicts:
        med_name = c["med_name"]
        rec = records_by_name.get(med_name.strip().lower())
        if rec:
            detail_parts = []
            for k in ("dose", "unit", "frequency", "route"):
                v = rec.get(k)
                if v:
                    detail_parts.append(str(v))
            updated = rec.get("updated_at_str")
            detail = " ".join(detail_parts) if detail_parts else "（劑量/頻次/途徑未列）"
            tail = f"，最後更新 {updated}" if updated else ""
            lines.append(f"- {med_name}：{detail}{tail}")
        else:
            lines.append(f"- {med_name}（active 用藥清單中）")
        lines.append(
            f"  使用者語句線索：「{c['snippet']}」 (cue=「{c['matched_cue']}」)"
        )

    lines.append(
        "處理原則（依事實核對規則）：必須引用快照記錄、請使用者澄清停藥時間/"
        "原因或處方異動單號；在使用者明確說明前，不可撤回原本的風險評估。"
    )
    return "\n".join(lines)
