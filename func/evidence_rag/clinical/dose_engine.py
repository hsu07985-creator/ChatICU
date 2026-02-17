"""Deterministic dose calculation engine backed by JSON rules."""

from __future__ import annotations

from decimal import Decimal
from itertools import chain
from typing import Any

from .exceptions import ClinicalInputError, ClinicalRuleError
from .rule_loader import ClinicalRuleStore
from .utils import evaluate_condition, normalize_token, round_decimal, to_decimal


class DoseEngine:
    """Calculates dosage values from structured rules (no free-form LLM math)."""

    def __init__(self, store: ClinicalRuleStore):
        self.store = store

    def _rule_matches(self, rule: dict[str, Any], drug: str, indication: str | None) -> bool:
        drug_meta = rule.get("drug", {})
        names = list(
            chain(
                [str(drug_meta.get("generic_name", ""))],
                [str(x) for x in drug_meta.get("aliases", [])],
            )
        )
        name_hit = normalize_token(drug) in {normalize_token(x) for x in names if x}
        if not name_hit:
            return False
        if not indication:
            return True
        rule_indication = normalize_token(str(rule.get("indication", "")))
        return (not rule_indication) or (rule_indication in normalize_token(indication))

    def _pick_rule(
        self, rules: list[dict[str, Any]], drug: str, indication: str | None
    ) -> dict[str, Any]:
        candidates = [r for r in rules if self._rule_matches(r, drug=drug, indication=indication)]
        if not candidates:
            raise ClinicalRuleError(f"No dose rule found for drug={drug}, indication={indication}")
        # Keep deterministic behavior by selecting first matched rule in file order.
        return candidates[0]

    def _required_field_check(self, required: list[str], patient: dict[str, Any]) -> list[str]:
        missing = [k for k in required if patient.get(k) is None]
        return missing

    def _target_dose_value(
        self,
        *,
        dose_target: dict[str, Any],
        formula: dict[str, Any],
        min_dose: Decimal,
    ) -> Decimal:
        target_key = str(formula.get("target_key", "dose_mcg_per_kg_hr"))
        default_val = formula.get("default_dose", str(min_dose))
        return to_decimal(dose_target.get(target_key), str(default_val))

    def _apply_dose_range(
        self,
        *,
        target_dose: Decimal,
        min_dose: Decimal,
        max_dose: Decimal,
        unit: str,
        warnings: list[str],
    ) -> Decimal:
        out = target_dose
        if min_dose and out < min_dose:
            warnings.append(
                f"Requested dose below minimum; clamped from {out} to {min_dose} {unit}"
            )
            out = min_dose
        if max_dose and out > max_dose:
            warnings.append(
                f"Requested dose above maximum; clamped from {out} to {max_dose} {unit}"
            )
            out = max_dose
        return out

    def _compute_formula(
        self,
        *,
        formula: dict[str, Any],
        patient: dict[str, Any],
        dose_target: dict[str, Any],
        warnings: list[str],
    ) -> tuple[Decimal, Decimal, str, list[str]]:
        ftype = str(formula.get("type", "weight_based_rate"))
        dose_range = dict(formula.get("dose_range", {}))
        min_dose = to_decimal(dose_range.get("min"), "0")
        max_dose = to_decimal(dose_range.get("max"), "0")
        dose_unit = str(dose_range.get("unit", ""))
        steps: list[str] = []

        if ftype in {"weight_based_rate", "weight_based_dose", "weight_based_bolus"}:
            target = self._target_dose_value(
                dose_target=dose_target,
                formula=formula,
                min_dose=min_dose,
            )
            target = self._apply_dose_range(
                target_dose=target,
                min_dose=min_dose,
                max_dose=max_dose,
                unit=dose_unit,
                warnings=warnings,
            )
            multiplier_field = str(formula.get("multiplier_field", "weight_kg"))
            multiplier = to_decimal(patient.get(multiplier_field), "0")
            final = multiplier * target
            steps.append(
                f"base = {multiplier_field} * {formula.get('target_key', 'dose_mcg_per_kg_hr')} = {multiplier} * {target} = {final}"
            )
            return target, final, dose_unit, steps

        if ftype == "fixed_dose":
            target_key = str(formula.get("target_key", "dose_mg"))
            target = to_decimal(dose_target.get(target_key), str(formula.get("default_dose", "0")))
            target = self._apply_dose_range(
                target_dose=target,
                min_dose=min_dose,
                max_dose=max_dose,
                unit=dose_unit,
                warnings=warnings,
            )
            steps.append(f"fixed dose selected: {target} {dose_unit}")
            return target, target, dose_unit, steps

        if ftype == "infusion_ml_hr_from_mg_kg_hr":
            target_key = str(formula.get("target_key", "dose_mg_per_kg_hr"))
            target = to_decimal(dose_target.get(target_key), str(formula.get("default_dose", "0")))
            target = self._apply_dose_range(
                target_dose=target,
                min_dose=min_dose,
                max_dose=max_dose,
                unit=dose_unit or "mg/kg/hr",
                warnings=warnings,
            )
            weight = to_decimal(patient.get("weight_kg"), "0")
            mg_per_hr = weight * target
            conc = to_decimal(
                dose_target.get("concentration_mg_per_ml"),
                str(formula.get("default_concentration_mg_per_ml", "1")),
            )
            if conc <= 0:
                raise ClinicalRuleError("concentration_mg_per_ml must be > 0")
            final_ml_hr = mg_per_hr / conc
            steps.append(f"mg_per_hr = weight_kg * {target_key} = {weight} * {target} = {mg_per_hr}")
            steps.append(f"ml_per_hr = mg_per_hr / concentration_mg_per_ml = {mg_per_hr} / {conc} = {final_ml_hr}")
            return target, final_ml_hr, dose_unit or "mg/kg/hr", steps

        raise ClinicalRuleError(f"Unsupported formula type: {ftype}")

    def calculate(self, req: dict[str, Any]) -> dict[str, Any]:
        loaded = self.store.load()
        rules = loaded.dose.get("rules", [])
        version = str(loaded.dose.get("version", "0.0.0"))

        request_id = str(req.get("request_id", "dose-mock-request"))
        drug = str(req.get("drug", "")).strip()
        if not drug:
            raise ClinicalInputError("Missing required field: drug")

        indication = req.get("indication")
        patient = dict(req.get("patient_context", {}) or {})
        dose_target = dict(req.get("dose_target", {}) or {})

        rule = self._pick_rule(rules=rules, drug=drug, indication=indication)
        missing = self._required_field_check(list(rule.get("inputs_required", [])), patient)
        if missing:
            return {
                "request_id": request_id,
                "status": "refused",
                "error_code": "MISSING_REQUIRED_FIELDS",
                "message": f"Missing required patient fields: {missing}",
                "result_type": "dose_calculation",
                "applied_rules": [
                    {"rule_id": str(rule.get("rule_id", "")), "rule_version": version}
                ],
                "citations": rule.get("citations", []),
                "confidence": 0.0,
            }

        formula = dict(rule.get("formula", {}))
        output_unit = str(formula.get("output_unit", ""))
        warnings: list[str] = []
        target_dose, final_rate, dose_unit, calc_steps = self._compute_formula(
            formula=formula,
            patient=patient,
            dose_target=dose_target,
            warnings=warnings,
        )

        for adj in list(rule.get("adjustments", [])):
            when = str(adj.get("when", ""))
            factor = to_decimal(adj.get("factor"), "1")
            if when and evaluate_condition(when, patient):
                prev = final_rate
                final_rate = final_rate * factor
                calc_steps.append(
                    f"adjustment applied ({when}): {prev} * {factor} = {final_rate}"
                )
                note = str(adj.get("note", "")).strip()
                if note:
                    warnings.append(note)

        constraints = dict(rule.get("constraints", {}))
        max_abs = to_decimal(constraints.get("max_absolute_rate"), "0")
        if max_abs > 0 and final_rate > max_abs:
            warnings.append(f"Absolute max rate applied: {max_abs} {output_unit}")
            final_rate = max_abs

        rounding = dict(constraints.get("rounding", {}))
        scale = int(rounding.get("scale", 2))
        final_rate = round_decimal(final_rate, scale=scale)

        hard_stops = list(rule.get("safety", {}).get("hard_stop_conditions", []))
        stop_hits = [cond for cond in hard_stops if evaluate_condition(str(cond), patient)]
        if stop_hits:
            return {
                "request_id": request_id,
                "status": "refused",
                "error_code": "SAFETY_HARD_STOP",
                "message": "Hard stop condition triggered",
                "result_type": "dose_calculation",
                "computed_values": {},
                "calculation_steps": calc_steps,
                "applied_rules": [
                    {"rule_id": str(rule.get("rule_id", "")), "rule_version": version}
                ],
                "safety_warnings": [f"Hard stop triggered: {x}" for x in stop_hits],
                "citations": rule.get("citations", []),
                "confidence": 0.0,
            }

        return {
            "request_id": request_id,
            "status": "ok",
            "result_type": "dose_calculation",
            "drug": drug,
            "computed_values": {
                "input_dose": {"value": float(target_dose), "unit": dose_unit},
                "final_rate": {
                    "value": float(final_rate),
                    "unit": output_unit,
                },
            },
            "calculation_steps": calc_steps,
            "applied_rules": [{"rule_id": str(rule.get("rule_id", "")), "rule_version": version}],
            "safety_warnings": warnings,
            "citations": rule.get("citations", []),
            "confidence": 0.96,
        }
