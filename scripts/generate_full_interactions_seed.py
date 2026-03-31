#!/usr/bin/env python3
"""
Generate full drug interaction seed JSON from MICROMEDEX DrugData.

Uses parse_interactions.load_and_dedup() to parse all 8,787 unique monographs,
then serializes to backend/seeds/drug_interactions_full.json.
"""

import json
import sys
import os
from pathlib import Path

# Add the parser module to sys.path
PARSER_DIR = Path(__file__).resolve().parents[1] / "1_藥物＿季"
sys.path.insert(0, str(PARSER_DIR))

from parse_interactions import load_and_dedup, create_chunks, ParsedInteraction

DATA_DIR = str(PARSER_DIR / "drug_data_uptodate")
OUTPUT = Path(__file__).resolve().parents[1] / "backend" / "seeds" / "drug_interactions_full.json"


def parsed_to_seed(parsed: ParsedInteraction) -> dict:
    """Convert a ParsedInteraction to the seed JSON format."""
    # Map severity
    sev_label = parsed.severity.lower() if parsed.severity else "moderate"
    if parsed.risk_rating == "X":
        severity = "contraindicated"
    elif sev_label in ("major", "moderate", "minor"):
        severity = sev_label
    else:
        severity = "moderate"

    # Extract route dependency from dependencies
    route_dep = ""
    for dep in parsed.dependencies:
        if dep.lower().startswith("route:"):
            route_dep = dep.split(":", 1)[1].strip()
            break

    # Serialize interacting members
    im_list = []
    for group in parsed.interacting_members:
        im_list.append({
            "group_name": group.group_name,
            "members": group.members,
            "exceptions": group.exceptions,
            "exceptions_note": group.exceptions_note,
        })

    return {
        "drug1": parsed.drug_a,
        "drug2": parsed.drug_b,
        "severity": severity,
        "mechanism": parsed.summary,
        "clinical_effect": parsed.summary,
        "management": parsed.patient_management,
        "references": f"MICROMEDEX DrugDex (Risk {parsed.risk_rating})" if parsed.risk_rating else "",
        "risk_rating": parsed.risk_rating,
        "risk_rating_description": parsed.risk_description,
        "severity_label": parsed.severity,
        "reliability_rating": parsed.reliability,
        "route_dependency": route_dep,
        "discussion": parsed.discussion,
        "footnotes": parsed.footnotes,
        "dependencies": parsed.dependencies,
        "dependency_types": parsed.dependency_types,
        "interacting_members": im_list,
        "pubmed_ids": parsed.pubmed_ids,
        "dedup_key": parsed.dedup_key,
        "body_hash": parsed.body_hash,
    }


def main():
    if not os.path.isdir(DATA_DIR):
        print(f"ERROR: Data directory not found: {DATA_DIR}")
        sys.exit(1)

    print(f"Loading and deduplicating from {DATA_DIR}...")
    interactions = load_and_dedup(DATA_DIR)
    print(f"Unique monographs: {len(interactions)}")

    # Convert to seed format
    seed_data = []
    for key, parsed in interactions.items():
        entry = parsed_to_seed(parsed)
        if entry["drug1"] and entry["drug2"]:  # skip entries without valid drug pair
            seed_data.append(entry)

    # Sort by severity rank then drug names
    sev_rank = {"contraindicated": 0, "major": 1, "moderate": 2, "minor": 3}
    seed_data.sort(key=lambda x: (sev_rank.get(x["severity"], 9), x["drug1"], x["drug2"]))

    # Stats
    by_sev = {}
    by_risk = {}
    has_discussion = 0
    has_footnotes = 0
    has_deps = 0
    has_members = 0
    has_pubmed = 0

    for ix in seed_data:
        by_sev[ix["severity"]] = by_sev.get(ix["severity"], 0) + 1
        by_risk[ix["risk_rating"]] = by_risk.get(ix["risk_rating"], 0) + 1
        if ix["discussion"]:
            has_discussion += 1
        if ix["footnotes"]:
            has_footnotes += 1
        if ix["dependencies"]:
            has_deps += 1
        if ix["interacting_members"]:
            has_members += 1
        if ix["pubmed_ids"]:
            has_pubmed += 1

    print(f"\nTotal seed entries: {len(seed_data)}")
    print(f"\nSeverity distribution:")
    for sev in ["contraindicated", "major", "moderate", "minor"]:
        print(f"  {sev}: {by_sev.get(sev, 0)}")

    print(f"\nRisk Rating distribution:")
    for risk in ["X", "D", "C", "B", "A"]:
        print(f"  {risk}: {by_risk.get(risk, 0)}")

    print(f"\nEnrichment coverage:")
    print(f"  discussion:          {has_discussion}/{len(seed_data)}")
    print(f"  footnotes:           {has_footnotes}/{len(seed_data)}")
    print(f"  dependencies:        {has_deps}/{len(seed_data)}")
    print(f"  interacting_members: {has_members}/{len(seed_data)}")
    print(f"  pubmed_ids:          {has_pubmed}/{len(seed_data)}")

    # Extract unique drug names for drug-list.ts update
    drug_names = set()
    for ix in seed_data:
        drug_names.add(ix["drug1"])
        drug_names.add(ix["drug2"])
    print(f"\nUnique drug names: {len(drug_names)}")

    # Write output
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(seed_data, indent=2, ensure_ascii=False), encoding="utf-8")
    file_size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"\nWritten to {OUTPUT} ({file_size_mb:.1f} MB)")

    # Also write drug names list for frontend
    drug_list_path = OUTPUT.parent / "drug_names_from_interactions.json"
    drug_list_path.write_text(json.dumps(sorted(drug_names), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Drug names written to {drug_list_path}")


if __name__ == "__main__":
    main()
