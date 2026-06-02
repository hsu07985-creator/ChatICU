"""HIS JSON → ChatICU DB converter package.

Public API is re-exported from :mod:`app.fhir.his_converter` for backward
compatibility; new code may import directly from this package.
"""

from app.fhir.his.converter import HISConverter

__all__ = ["HISConverter"]
