"""Clinical reference ranges used by the snapshot builder.

W3-T4: extracted from patient_context_builder.py so thresholds live in one
auditable place instead of being hardcoded across `_fmt_lab_section`,
`_fmt_vital_section`, `_fmt_vent_section`. Behaviour is unchanged — the
existing snapshot tests pin both the abnormal-flag positions and the
unflagged values.

Each entry is ``(low, high)`` where:
  - ``low``  — value strictly below this gets a "↓" mark (None to skip)
  - ``high`` — value strictly above this gets a "↑" mark (None to skip)

Units stay implicit (matches what the HIS/seed data ships):
  Cr mg/dL, K mmol/L, Na mmol/L, AST/ALT U/L, T-Bil mg/dL, Albumin g/dL,
  Hb g/dL, PLT 10⁹/L, INR ratio, aPTT s, D-Dimer mg/L, CRP mg/L, PCT ng/mL,
  pH, pO₂ mmHg, HCO₃ mmol/L, Lactate mmol/L,
  Temp °C, HR bpm, RR /min, MAP mmHg, SpO₂ %, CVP mmHg,
  FiO₂ %, PEEP cmH₂O, PIP cmH₂O, Compliance mL/cmH₂O, BUN mg/dL, eGFR mL/min/1.73m².
"""
from __future__ import annotations

from typing import Optional, Tuple

# (low, high). Either may be None.
ThresholdRange = Tuple[Optional[float], Optional[float]]

LAB_THRESHOLDS: dict[str, ThresholdRange] = {
    # Renal
    "BUN": (None, 20),
    "eGFR": (60, None),
    # Electrolytes
    "K": (3.5, 5.0),
    "Na": (135, 145),
    # Liver
    "AST": (None, 40),
    "ALT": (None, 40),
    "T-Bil": (None, 1.2),
    "Albumin": (3.5, None),
    # Hematology
    "Hb": (8, None),
    "PLT": (100, None),
    # Coagulation
    "INR": (None, 1.2),
    "aPTT": (None, 35),
    "D-Dimer": (None, 0.5),
    # Inflammatory
    "PCT": (None, 0.5),
    # Blood gas
    "pH": (7.35, 7.45),
    "pO2": (60, None),
    "HCO3": (22, None),
}

VITAL_THRESHOLDS: dict[str, ThresholdRange] = {
    "RR": (None, 20),
    "HR": (60, 100),
    "Temp": (36.0, 37.5),
    "MAP": (65, None),
    "SpO2": (92, None),
    "CVP": (None, 12),
}

VENT_THRESHOLDS: dict[str, ThresholdRange] = {
    "FiO2": (None, 50),
    "PEEP": (None, 8),
    "PIP": (None, 35),
    "Compliance": (40, None),
}


def mark(value: Optional[float], rng: ThresholdRange) -> str:
    """Format ``value`` with ↑/↓ when it falls outside ``rng``.

    Returns "—" for ``None`` so all sites can call this uniformly.
    """
    if value is None:
        return "—"
    low, high = rng
    if high is not None and value > high:
        return f"{value}↑"
    if low is not None and value < low:
        return f"{value}↓"
    return str(value)


def flag_only(value: Optional[float], rng: ThresholdRange) -> str:
    """Return just "↑" / "↓" / "" — caller stitches the value separately.

    Used at sites where the existing format embeds the value differently
    from ``mark()`` (e.g. ``Cl⁻ 102`` with no flag, or ``BUN 25↑``).
    """
    if value is None:
        return ""
    low, high = rng
    if high is not None and value > high:
        return "↑"
    if low is not None and value < low:
        return "↓"
    return ""
