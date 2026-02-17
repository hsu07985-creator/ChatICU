"""Domain exceptions for clinical deterministic engines."""

from __future__ import annotations


class ClinicalRuleError(Exception):
    """Raised when rule loading or rule execution fails."""


class ClinicalInputError(Exception):
    """Raised when required input fields are missing or invalid."""
