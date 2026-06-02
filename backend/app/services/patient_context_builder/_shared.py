"""Shared primitives for the patient_context_builder package.

Houses the cross-cutting constants and helpers used by repository / lab_values
/ safety / formatters / builders. Kept tiny and dependency-light so every
submodule can import it without circular-import risk.
"""

import logging
from datetime import datetime, timezone, timedelta  # noqa: F401 (re-exported)
from typing import Any, Dict, List, Optional  # noqa: F401 (re-exported)

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python <3.9 fallback (project pins 3.12+)
    from backports.zoneinfo import ZoneInfo  # type: ignore

# W3-T3: snapshot-facing timestamps run in Asia/Taipei. Internal DB columns
# stay UTC; only display strings (snapshot header, ICU-day calc, delta block)
# get converted. Keeps chronological reasoning consistent with what clinicians
# read on bedside HIS / nursing systems.
TAIPEI_TZ = ZoneInfo("Asia/Taipei")

logger = logging.getLogger("chaticu")


def _now_taipei() -> datetime:
    return datetime.now(TAIPEI_TZ)


# ── Trend thresholds ──────────────────────────────────────────────────────────
_TREND_THRESHOLD = 0.20  # 20% change → show arrow
