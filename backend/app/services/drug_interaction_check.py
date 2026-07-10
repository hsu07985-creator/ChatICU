"""Pairwise drug-interaction lookup against the DrugInteraction table.

Extracted from routers/clinical.py `interaction_check` (B09) so the AI-chat
question prefetch can reuse the exact same matching semantics — word-boundary
regex on drug1/drug2/interacting_members plus the different-sides guard that
keeps e.g. two members of the same interaction side from pairing with itself.

Each checked drug is an *alias group*: a plain string, or a list of name
forms for the same drug (HIS names embed the generic in parentheses —
``Pantoloc 針劑 40mg(Pantoprazole)`` — while the Lexicomp table stores
generics, so brand-only matching finds nothing). Two aliases of the same
group never pair with each other.

Query shape is two-phase to keep round-trips flat regardless of drug count
(an ICU regimen is ~20-30 meds; per-pair queries would be O(n²) round-trips
in front of chat TTFT):
  1. one light query (id/drug1/drug2/interacting_members) for rows matching
     ANY alias, filtered to cross-group pairs in Python;
  2. one full-row fetch for the matched ids only.

ponytail: DB-only (Source C graph files live in `local/` and are absent on
prod; `/pharmacy/drug-interactions` already treats the DB as the canonical
fallback). If the graph becomes deployable, add a bridge-first path here.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.drug_interaction import DrugInteraction
from app.utils.drug_match import _word_pattern

logger = logging.getLogger("chaticu")

_SEVERITY_RANK = {"contraindicated": 5, "major": 4, "moderate": 3, "minor": 2}

DrugSpec = Union[str, Sequence[str]]

# In-process cache of the light interaction index (id + both side name
# sets + one lowercase searchable string per row). The table is reference
# data (~9k Lexicomp rows, re-imported offline), so a 1h TTL is generous.
# Rationale: the SQL alternative — dozens of POSIX regexes against a JSONB
# cast per row — measured ~7s for a 22-med regimen; one combined Python
# regex over the cached index is ~10ms.
_INDEX_TTL_SECONDS = 3600
_index_cache: Dict[str, Any] = {"rows": None, "loaded_at": 0.0}


class _IndexRow:
    __slots__ = ("id", "side1_text", "side2_text", "searchable")

    def __init__(self, row_id: str, side1: set, side2: set) -> None:
        self.id = row_id
        # Pre-joined lowercase side texts: the hot path runs ONE compiled
        # regex per drug group against these, instead of word_match per
        # (alias × member-name) which measured ~4s for a 22-med regimen.
        self.side1_text = " | ".join(sorted(side1))
        self.side2_text = " | ".join(sorted(side2))
        self.searchable = f"{self.side1_text} | {self.side2_text}"


async def _get_interaction_index(db: AsyncSession) -> List[_IndexRow]:
    now = time.monotonic()
    rows = _index_cache["rows"]
    if rows is not None and now - _index_cache["loaded_at"] < _INDEX_TTL_SECONDS:
        return rows

    raw = (await db.execute(
        select(
            DrugInteraction.id,
            DrugInteraction.drug1,
            DrugInteraction.drug2,
            DrugInteraction.interacting_members,
        )
    )).all()
    index = []
    for row_id, drug1, drug2, members in raw:
        side1, side2 = _interaction_sides(drug1, drug2, members)
        index.append(_IndexRow(row_id, side1, side2))
    _index_cache["rows"] = index
    _index_cache["loaded_at"] = now
    logger.info("[DDI] interaction index loaded: %d rows", len(index))
    return index


def invalidate_interaction_index() -> None:
    """For tests and re-import scripts."""
    _index_cache["rows"] = None
    _index_cache["loaded_at"] = 0.0


def _normalize_groups(drugs: Sequence[DrugSpec], max_drugs: int) -> List[List[str]]:
    groups: List[List[str]] = []
    for spec in drugs[:max_drugs]:
        aliases = [spec] if isinstance(spec, str) else list(spec)
        cleaned = []
        seen: set = set()
        for alias in aliases:
            token = str(alias or "").strip()
            if len(token) < 2 or token.lower() in seen:
                continue
            seen.add(token.lower())
            cleaned.append(token)
        if cleaned:
            groups.append(cleaned)
    return groups


def _interaction_sides(
    drug1: Optional[str],
    drug2: Optional[str],
    interacting_members: Any,
) -> Tuple[set, set]:
    members = interacting_members if isinstance(interacting_members, list) else (json.loads(interacting_members) if interacting_members else [])
    d1_l = (drug1 or "").lower()
    d2_l = (drug2 or "").lower()
    side1 = {d1_l}
    side2 = {d2_l}
    for g in members:
        gn = (g.get("group_name") or "").lower()
        member_set = {m.lower() for m in g.get("members", [])}
        if gn == d1_l:
            side1.update(member_set)
        elif gn == d2_l:
            side2.update(member_set)
    return side1, side2


def _compile_group_patterns(groups: List[List[str]]) -> List[Optional[re.Pattern]]:
    """One word-boundary alternation regex per alias group."""
    compiled: List[Optional[re.Pattern]] = []
    for aliases in groups:
        parts = [p for a in aliases if (p := _word_pattern(a))]
        compiled.append(re.compile("|".join(parts), re.IGNORECASE) if parts else None)
    return compiled


def _match_cross_group_pair(
    row: "_IndexRow",
    group_patterns: List[Optional[re.Pattern]],
) -> Optional[Tuple[int, int]]:
    """(group_a, group_b) when two DIFFERENT alias groups match different
    interaction sides; None otherwise.

    Word-boundary regex (inherits the conditional-boundary semantics of
    drug_match._word_pattern, so "prednisolone" still doesn't match
    "methylprednisolone")."""
    side1_groups: List[int] = []
    side2_groups: List[int] = []
    for idx, pattern in enumerate(group_patterns):
        if pattern is None:
            continue
        if pattern.search(row.side1_text):
            side1_groups.append(idx)
        if pattern.search(row.side2_text):
            side2_groups.append(idx)
    for a in side1_groups:
        for b in side2_groups:
            if a != b:
                return (a, b)
    return None


def _row_to_finding(row: DrugInteraction) -> Dict[str, Any]:
    return {
        "drug_a": row.drug1,
        "drug_b": row.drug2,
        "severity": row.severity or "unknown",
        "mechanism": row.mechanism or "",
        "clinical_effect": row.clinical_effect or "",
        "recommended_action": row.management or "",
        "dose_adjustment_hint": row.references or "",
        "risk_rating": row.risk_rating or "",
        "risk_rating_description": row.risk_rating_description or "",
        "severity_label": row.severity_label or "",
        "reliability_rating": row.reliability_rating or "",
        "route_dependency": row.route_dependency or "",
        "discussion": row.discussion or "",
        "footnotes": row.footnotes or "",
        "dependencies": row.dependencies if isinstance(row.dependencies, list) else (json.loads(row.dependencies) if row.dependencies else []),
        "dependency_types": row.dependency_types if isinstance(row.dependency_types, list) else (json.loads(row.dependency_types) if row.dependency_types else []),
        "interacting_members": row.interacting_members if isinstance(row.interacting_members, list) else (json.loads(row.interacting_members) if row.interacting_members else []),
        "pubmed_ids": row.pubmed_ids if isinstance(row.pubmed_ids, list) else (json.loads(row.pubmed_ids) if row.pubmed_ids else []),
        "source": "database",
    }


async def check_drug_interactions(
    db: AsyncSession,
    drugs: Sequence[DrugSpec],
    *,
    max_drugs: int = 10,
    max_findings: int = 50,
) -> Dict[str, Any]:
    """Pairwise-check `drugs` (strings or alias groups) against the
    DrugInteraction table.

    Returns ``{"overall_severity": str, "findings": [dict, ...]}`` with the
    same finding shape the /clinical/interactions endpoint responds with.
    """
    groups = _normalize_groups(drugs, max_drugs)
    if len(groups) < 2:
        return {"overall_severity": "none", "findings": []}

    index = await _get_interaction_index(db)

    # Prescreen: ONE combined word-boundary regex over the cached index —
    # rows that don't mention any alias at all are skipped before the
    # per-side group attribution (itself one regex per group).
    group_patterns = _compile_group_patterns(groups)
    all_parts = [p.pattern for p in group_patterns if p is not None]
    if not all_parts:
        return {"overall_severity": "none", "findings": []}
    combined_re = re.compile("|".join(all_parts), re.IGNORECASE)

    matched: List[Tuple[str, Tuple[int, int]]] = []  # (row_id, (ga, gb))
    for row in index:
        if not combined_re.search(row.searchable):
            continue
        pair = _match_cross_group_pair(row, group_patterns)
        if pair is not None:
            matched.append((row.id, pair))
            if len(matched) >= max_findings:
                break

    if not matched:
        return {"overall_severity": "none", "findings": []}

    # Fetch full rows for matched ids only.
    pair_by_id = dict(matched)
    full_rows = (await db.execute(
        select(DrugInteraction).where(DrugInteraction.id.in_(list(pair_by_id)))
    )).scalars().all()

    findings: List[Dict[str, Any]] = []
    max_sev = "none"
    for row in full_rows:
        finding = _row_to_finding(row)
        # Attribution: which of the CHECKED drugs triggered this row —
        # essential when the row is class-level (e.g. "CNS Depressants")
        # and the reader can't tell which regimen med it refers to.
        ga, gb = pair_by_id[row.id]
        finding["matched_a"] = groups[ga][0]
        finding["matched_b"] = groups[gb][0]
        sev = finding["severity"]
        if _SEVERITY_RANK.get(sev, 0) > _SEVERITY_RANK.get(max_sev, 0):
            max_sev = sev
        findings.append(finding)

    return {"overall_severity": max_sev, "findings": findings}
