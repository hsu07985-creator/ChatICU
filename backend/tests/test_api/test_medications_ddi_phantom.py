"""Regression tests for phantom DDI alerts caused by ATC backfill pollution.

Scenario reproduced on 2026-04-23 for patient pat_a86cb503 (I-05 吳○旺):
``backfill_drug_interactions_atc.py`` mapped every drug name whose first
word was "Sodium" to ``B05XA03`` (saline), so any patient on N.S. 0.9% +
Furosemide surfaced a phantom "Sodium Zirconium Cyclosilicate ↔ Furosemide"
alert even though Lokelma was never prescribed.

These tests lock the fix at two layers:

* ``_ddi_drug_polluted`` — the runtime filter applied to both Path 1
  (name-based) and Path 2 (ATC-based) DDI query results.
* ``lookup_atc`` + ``build_name_to_atc`` — the write-time defense that
  prevents ambiguous first-words from polluting ATC assignments in the
  first place.

Both are pure-function checks (no DB) so they run on SQLite test envs.
"""
import sys
from pathlib import Path

import pytest

# Make the scripts/ folder importable for backfill helpers
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_BACKEND_ROOT / "scripts"))

from app.routers.medications import (  # noqa: E402
    _DDI_AMBIGUOUS_PREFIXES,
    _ddi_drug_polluted,
)
from backfill_drug_interactions_atc import (  # noqa: E402
    _AMBIGUOUS_FIRST_WORDS,
    build_name_to_atc,
    lookup_atc,
)


# --- Runtime filter: _ddi_drug_polluted -------------------------------


class TestDdiDrugPolluted:
    """Rules whose drug name starts with an ambiguous ion/element/class
    prefix may only pass through if the patient actually has that drug."""

    def test_sodium_zirconium_not_on_patient_is_polluted(self):
        # Patient is on saline + furosemide, no zirconium.
        names = {"sodium chloride", "uretropic", "plavix"}
        assert _ddi_drug_polluted("Sodium Zirconium Cyclosilicate", names) is True

    def test_sodium_zirconium_when_patient_actually_has_it(self):
        # Legitimate Lokelma user — rule must pass.
        names = {"sodium zirconium cyclosilicate", "uretropic"}
        assert _ddi_drug_polluted("Sodium Zirconium Cyclosilicate", names) is False

    def test_different_sodium_drug_is_still_polluted(self):
        # Patient on Sodium Bicarbonate is NOT enough to justify a Sodium
        # Phosphate rule — the filter must require name overlap, not just
        # shared first-word. (This was the exact failure mode of the bug.)
        names = {"sodium bicarbonate", "uretropic"}
        assert _ddi_drug_polluted("Sodium Phosphate", names) is True

    def test_formulation_drift_accepted(self):
        # Patient's actual medication name often carries a formulation
        # suffix (e.g. "Sodium Bicarbonate Tab"); the rule uses the plain
        # generic. Substring match lets the legitimate rule through.
        names = {"sodium bicarbonate tab", "uretropic"}
        assert _ddi_drug_polluted("Sodium Bicarbonate", names) is False

    def test_non_ambiguous_rule_always_passes(self):
        # Furosemide doesn't start with an ambiguous prefix — the filter
        # must never block it, regardless of patient.
        assert _ddi_drug_polluted("Furosemide", set()) is False
        assert _ddi_drug_polluted("Clopidogrel", {"takepron"}) is False

    def test_empty_drug_name_passes(self):
        assert _ddi_drug_polluted("", {"anything"}) is False
        assert _ddi_drug_polluted(None, {"anything"}) is False  # type: ignore[arg-type]

    @pytest.mark.parametrize(
        "prefix",
        [p.strip() for p in _DDI_AMBIGUOUS_PREFIXES],
    )
    def test_every_blocklisted_prefix_blocks_phantom(self, prefix):
        """Every prefix in the blocklist must block an unknown multi-word
        drug when the patient is not on anything starting with that prefix."""
        rule_drug = f"{prefix.capitalize()} Unknown Blocker"
        # Patient has no drug with this prefix, but shares an ATC upstream.
        names = {"acetaminophen", "uretropic"}
        assert _ddi_drug_polluted(rule_drug, names) is True


# --- Write-time defense: lookup_atc / build_name_to_atc ---------------


@pytest.fixture(scope="module")
def name_to_atc():
    return build_name_to_atc()


class TestBackfillBlocklist:
    def test_sodium_zirconium_yields_none_not_saline(self, name_to_atc):
        # The original bug: first-word "sodium" → sodium chloride → B05XA03
        # (saline) polluted every Sodium-* rule. Must now return None.
        assert lookup_atc("Sodium Zirconium Cyclosilicate", name_to_atc) is None

    def test_sodium_chloride_exact_match_still_works(self, name_to_atc):
        # Exact lowercase lookup is unaffected — saline itself still resolves.
        assert lookup_atc("Sodium chloride", name_to_atc) == "B05XA03"

    def test_calcium_polystyrene_yields_none(self, name_to_atc):
        # Another ion-prefix drug that previously inherited whichever
        # calcium-* ATC came first.
        assert lookup_atc("Calcium Polystyrene Sulfonate", name_to_atc) is None

    def test_regular_generic_first_word_still_resolves(self, name_to_atc):
        # Non-ambiguous generics must still benefit from first-word
        # fallback (e.g. "Morphine (Systemic)" → N02AA01).
        atc = lookup_atc("Morphine (Systemic)", name_to_atc)
        assert atc is not None and atc.startswith("N02A")

    def test_all_blocklisted_prefixes_return_none_for_multi_word_unknowns(
        self, name_to_atc
    ):
        # Any multi-word drug starting with a blocklisted prefix but not
        # present exactly in the formulary must resolve to None.
        for word in _AMBIGUOUS_FIRST_WORDS:
            fake = f"{word.capitalize()} Nonexistent Test Drug"
            assert lookup_atc(fake, name_to_atc) is None, f"leaked for {word!r}"
