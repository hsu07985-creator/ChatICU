"""aggregation — read-side catalog logic for the drug library.

Walks ``drug_interactions`` to build per-drug counters, plus the predicates
that decide whether a DDI row truly involves a target drug (vs. merely
matching a class-name substring).
"""
from __future__ import annotations

import json as _json
import re
from collections import Counter

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def parse_interacting_members(raw):
    """Normalise the ``interacting_members`` column to its decoded JSON value.

    The column may already be a Python list/dict, or a JSON string, or null.
    Returns the decoded structure (list/dict) or ``None`` when absent or
    unparseable.
    """
    if isinstance(raw, str):
        try:
            return _json.loads(raw)
        except Exception:
            return None
    return raw


async def aggregate_per_drug(db: AsyncSession) -> dict:
    """Walk drug_interactions and build per-drug counters.
    Dedup key = name.lower() so 'FentaNYL' and 'Fentanyl' merge into one
    entry. Display name = the most-frequent case form. Other forms saved
    as `aliases`.
    """
    r = await db.execute(text("""
        SELECT drug1, drug2, drug1_atc, drug2_atc, risk_rating, "references"
        FROM drug_interactions
        WHERE is_active = TRUE
    """))
    per_drug: dict = {}
    name_form_counts: dict = {}

    for row in r:
        for name, atc in ((row.drug1, row.drug1_atc), (row.drug2, row.drug2_atc)):
            if not name:
                continue
            key = name.strip().lower()
            entry = per_drug.setdefault(key, {
                "_lower_key": key,
                "atc_codes": set(),
                "ddi_counts": {"X": 0, "D": 0, "C": 0, "B": 0, "A": 0, "total": 0},
                "sources": set(),
                "recently_added_count": 0,
                "_unique_rule_ids": set(),
            })
            name_form_counts.setdefault(key, Counter())[name.strip()] += 1
            if atc:
                entry["atc_codes"].add(atc)
            risk = (row.risk_rating or "").upper()
            if risk in entry["ddi_counts"]:
                entry["ddi_counts"][risk] += 1
            entry["ddi_counts"]["total"] += 1
            if row.references:
                entry["sources"].add(row.references)
                if row.references == "Lexicomp 2026":
                    entry["recently_added_count"] += 1

    # Pick display name = most common case form; rest become aliases
    for key, entry in per_drug.items():
        forms = name_form_counts.get(key, Counter())
        if forms:
            display, _ = forms.most_common(1)[0]
            entry["name"] = display
            other_forms = sorted(f for f in forms.keys() if f != display)
            entry["aliases"] = other_forms
        else:
            entry["name"] = key
            entry["aliases"] = []

    return per_drug


def coverage_status(ddi_total: int, has_atc: bool) -> str:
    if ddi_total == 0:
        return "yellow"  # 缺資料
    if not has_atc:
        return "red"  # 待補 ATC
    return "green"


def drug_name_is(target: str, full_name: str) -> bool:
    """True iff `target` is a drug-level match for `full_name` — not a
    substring of a class name. Splits parens to handle 'Foo (Bar)' synonym
    forms but does NOT split slashes (which appear inside class names like
    'Serotonin/Norepinephrine Reuptake Inhibitor').
    """
    if not full_name or not target:
        return False
    target_l = target.strip().lower()
    full_l = full_name.strip().lower()
    if target_l == full_l:
        return True
    # Split parens: "Acetylsalicylic Acid (Aspirin)" → ["acetylsalicylic acid", "aspirin"]
    parts = [p.strip() for p in re.split(r"\s*[()]\s*", full_l) if p.strip()]
    return target_l in parts


def row_about_target(row, target: str) -> bool:
    """True iff DDI row truly involves `target` as a drug — either exactly
    on side 1 / side 2 / or as a member of a class group, NOT just as a
    substring of a class name.
    """
    if drug_name_is(target, row.drug1) or drug_name_is(target, row.drug2):
        return True
    raw = parse_interacting_members(row.interacting_members)
    members_lists: list = []
    if isinstance(raw, list):
        for grp in raw:
            if isinstance(grp, dict):
                members_lists.append(grp.get("members") or [])
    elif isinstance(raw, dict):
        members_lists.extend(raw.values())
    for ms in members_lists:
        if not isinstance(ms, list):
            continue
        for m in ms:
            if drug_name_is(target, m):
                return True
    return False
