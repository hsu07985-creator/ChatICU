"""Drug-drug interaction auto-check for active patient medications."""

from typing import Any, Dict, List, Optional

from app.services.drug_graph_bridge import drug_graph_bridge

HIGH_RISK_RATINGS = {"X", "D", "C"}


def extract_ddi_warnings(patient_context: Optional[dict]) -> List[Dict[str, Any]]:
    """Extract high-risk (X/D/C) drug-drug interactions from active medications.

    Uses the local drug graph bridge to check all unique medication pairs.
    Returns a list of interaction dicts with risk info for LLM injection.
    """
    if not patient_context or not drug_graph_bridge.is_ready():
        return []
    meds = patient_context.get("medications") or []
    if len(meds) < 2:
        return []

    # Collect unique drug names (prefer genericName, fallback to name).
    # Combination drugs imported from HIS store multiple DDI names joined
    # by " / " (e.g., "Ampicillin / Sulbactam") — expand them here.
    drug_names: List[str] = []
    seen: set = set()
    for m in meds:
        raw = (m.get("genericName") or m.get("name") or "").strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split(" / ") if p.strip()]
        for name in parts:
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            drug_names.append(name)

    if len(drug_names) < 2:
        return []

    warnings: List[Dict[str, Any]] = []
    seen_pairs: set = set()

    for i in range(len(drug_names)):
        for j in range(i + 1, len(drug_names)):
            pair_key = tuple(sorted([drug_names[i].lower(), drug_names[j].lower()]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            try:
                hits = drug_graph_bridge.search_interactions(
                    drug_a=drug_names[i], drug_b=drug_names[j],
                    page=1, limit=3,
                )
            except Exception:
                continue
            for hit in hits:
                risk = (hit.get("riskLevel") or "").upper()
                if risk in HIGH_RISK_RATINGS:
                    warnings.append(hit)

    return warnings


def format_ddi_metadata(ddi_warnings: List[Dict[str, Any]]) -> str:
    """Format DDI warnings as a metadata block for LLM context."""
    if not ddi_warnings:
        return ""
    lines = [f"\n[藥物交互作用警示] (共 {len(ddi_warnings)} 筆高風險)"]
    for w in ddi_warnings[:10]:
        risk = w.get("riskLevel", "?")
        d1 = w.get("drug1", "?")
        d2 = w.get("drug2", "?")
        sev = w.get("severity", "?")
        mgmt = (w.get("management") or "")[:120]
        lines.append(f"  ⚠ [{risk}] {d1} ↔ {d2} ({sev}): {mgmt}")
    return "\n".join(lines)
