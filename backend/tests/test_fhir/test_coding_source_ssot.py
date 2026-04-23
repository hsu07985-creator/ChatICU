"""SSOT consistency tests for ``Medication.coding_source``.

Guards against drift between:
  - ``app.models.coding_source.VALID_CODING_SOURCES`` (Python SSOT)
  - ``drug_formulary.csv`` (upstream data file, column ``source``)
  - The Alembic CHECK constraint ``ck_medications_coding_source_valid``
    (migration 066)

If any of these three drift apart, this test fails in CI before the bad
value reaches the database.
"""
import csv
import re
from pathlib import Path

from app.models.coding_source import VALID_CODING_SOURCES


_REPO_BACKEND = Path(__file__).resolve().parents[2]
_FORMULARY_CSV = _REPO_BACKEND / "app" / "fhir" / "code_maps" / "drug_formulary.csv"
_MIGRATION_066 = _REPO_BACKEND / "alembic" / "versions" / "066_add_coding_source_check.py"


def test_formulary_csv_sources_match_enum():
    assert _FORMULARY_CSV.exists(), f"Missing formulary CSV: {_FORMULARY_CSV}"

    seen = set()
    with _FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            value = (row.get("source") or "").strip()
            if value:
                seen.add(value)

    unknown = seen - VALID_CODING_SOURCES
    assert not unknown, (
        f"drug_formulary.csv contains unknown coding_source values {sorted(unknown)}. "
        f"Either fix the CSV or extend app.models.coding_source.VALID_CODING_SOURCES "
        f"(and mirror the change in Alembic migration ck_medications_coding_source_valid)."
    )


def test_alembic_constraint_matches_enum():
    """Migration 066's CHECK constraint must list exactly the enum members."""
    assert _MIGRATION_066.exists(), f"Missing migration file: {_MIGRATION_066}"

    text = _MIGRATION_066.read_text(encoding="utf-8")
    match = re.search(r"_VALID_VALUES\s*=\s*\((.*?)\)", text, re.DOTALL)
    assert match, "Could not locate _VALID_VALUES tuple in migration 066"

    migration_values = set(re.findall(r"\"([^\"]+)\"", match.group(1)))
    assert migration_values == VALID_CODING_SOURCES, (
        "Migration 066 _VALID_VALUES drifted from VALID_CODING_SOURCES. "
        f"missing_in_migration={VALID_CODING_SOURCES - migration_values}, "
        f"extra_in_migration={migration_values - VALID_CODING_SOURCES}"
    )
