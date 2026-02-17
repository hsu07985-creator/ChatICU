"""Validation helpers for clinical JSON rule payloads."""

from __future__ import annotations

from typing import Any

from .exceptions import ClinicalRuleError


def _require_fields(row: dict[str, Any], fields: list[str], label: str) -> None:
    missing = [f for f in fields if f not in row]
    if missing:
        raise ClinicalRuleError(f"{label} missing required fields: {missing}")


def validate_dose_rules(payload: dict[str, Any]) -> None:
    if not isinstance(payload.get("rules"), list):
        raise ClinicalRuleError("Dose rule payload must contain list field `rules`")

    for i, rule in enumerate(payload["rules"], start=1):
        if not isinstance(rule, dict):
            raise ClinicalRuleError(f"Dose rule #{i} must be an object")
        _require_fields(rule, ["rule_id", "drug", "formula", "citations"], f"dose rule #{i}")
        if not isinstance(rule.get("drug"), dict):
            raise ClinicalRuleError(f"dose rule #{i} field `drug` must be object")
        if not isinstance(rule.get("formula"), dict):
            raise ClinicalRuleError(f"dose rule #{i} field `formula` must be object")
        if not isinstance(rule.get("citations"), list):
            raise ClinicalRuleError(f"dose rule #{i} field `citations` must be list")

        formula = rule["formula"]
        _require_fields(formula, ["type", "output_unit"], f"dose rule #{i}.formula")
        if str(formula.get("type", "")).strip() not in {
            "weight_based_rate",
            "weight_based_dose",
            "weight_based_bolus",
            "fixed_dose",
            "infusion_ml_hr_from_mg_kg_hr",
        }:
            raise ClinicalRuleError(
                f"dose rule #{i} unsupported formula type: {formula.get('type')}"
            )


def validate_interaction_rules(payload: dict[str, Any]) -> None:
    if not isinstance(payload.get("rules"), list):
        raise ClinicalRuleError("Interaction rule payload must contain list field `rules`")

    for i, rule in enumerate(payload["rules"], start=1):
        if not isinstance(rule, dict):
            raise ClinicalRuleError(f"interaction rule #{i} must be an object")
        _require_fields(
            rule,
            ["rule_id", "drug_pair", "severity", "recommended_action", "citations"],
            f"interaction rule #{i}",
        )
        pair = rule.get("drug_pair")
        if not isinstance(pair, dict):
            raise ClinicalRuleError(f"interaction rule #{i} field `drug_pair` must be object")
        _require_fields(pair, ["a", "b"], f"interaction rule #{i}.drug_pair")
        if not isinstance(rule.get("citations"), list):
            raise ClinicalRuleError(f"interaction rule #{i} field `citations` must be list")
