"""Deterministic drug-drug interaction checker backed by JSON rules."""

from __future__ import annotations

from itertools import combinations
from typing import Any

from .exceptions import ClinicalInputError
from .rule_loader import ClinicalRuleStore
from .utils import normalize_token


SEVERITY_RANK = {
    "contraindicated": 4,
    "major": 3,
    "moderate": 2,
    "minor": 1,
}


class InteractionEngine:
    """Checks interactions using deterministic pair matching from rules."""

    def __init__(self, store: ClinicalRuleStore):
        self.store = store

    def _build_alias_map(self, rules: list[dict[str, Any]]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for r in rules:
            pair = dict(r.get("drug_pair", {}))
            a = normalize_token(str(pair.get("a", "")))
            b = normalize_token(str(pair.get("b", "")))
            if a:
                mapping[a] = a
            if b:
                mapping[b] = b
            for alias in pair.get("aliases_a", []) or []:
                mapping[normalize_token(str(alias))] = a
            for alias in pair.get("aliases_b", []) or []:
                mapping[normalize_token(str(alias))] = b
        return mapping

    def _canonicalize_drugs(self, drugs: list[str], alias_map: dict[str, str]) -> list[str]:
        out: list[str] = []
        for x in drugs:
            t = normalize_token(x)
            if not t:
                continue
            out.append(alias_map.get(t, t))
        # keep deterministic unique order
        seen: set[str] = set()
        uniq: list[str] = []
        for d in out:
            if d in seen:
                continue
            seen.add(d)
            uniq.append(d)
        return uniq

    def _pair_match(self, pair_rule: dict[str, Any], x: str, y: str) -> bool:
        a = normalize_token(str(pair_rule.get("a", "")))
        b = normalize_token(str(pair_rule.get("b", "")))
        unordered = bool(pair_rule.get("unordered", True))
        if unordered:
            return {x, y} == {a, b}
        return x == a and y == b

    def check(self, req: dict[str, Any]) -> dict[str, Any]:
        loaded = self.store.load()
        rules = loaded.interaction.get("rules", [])
        version = str(loaded.interaction.get("version", "0.0.0"))

        request_id = str(req.get("request_id", "interaction-mock-request"))
        raw_drugs = list(req.get("drug_list", []) or [])
        if len(raw_drugs) < 2:
            raise ClinicalInputError("`drug_list` must contain at least 2 drugs")

        alias_map = self._build_alias_map(rules)
        drugs = self._canonicalize_drugs(raw_drugs, alias_map=alias_map)

        findings: list[dict[str, Any]] = []
        applied: list[dict[str, str]] = []
        citations: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        pair_rule_index: dict[tuple[str, str], list[dict[str, Any]]] = {}
        top_severity = "none"
        top_rank = 0

        for x, y in combinations(drugs, 2):
            for rule in rules:
                pair = dict(rule.get("drug_pair", {}))
                if not self._pair_match(pair_rule=pair, x=x, y=y):
                    continue
                sev = normalize_token(str(rule.get("severity", "minor")))
                rank = SEVERITY_RANK.get(sev, 1)
                if rank > top_rank:
                    top_rank = rank
                    top_severity = sev

                findings.append(
                    {
                        "rule_id": str(rule.get("rule_id", "")),
                        "pair": [x, y],
                        "severity": sev,
                        "mechanism": str(rule.get("mechanism", "")),
                        "clinical_effect": str(rule.get("clinical_effect", "")),
                        "recommended_action": str(rule.get("recommended_action", "")),
                        "dose_adjustment_hint": str(rule.get("dose_adjustment_hint", "")),
                        "monitoring": list(rule.get("monitoring", [])),
                    }
                )
                applied.append({"rule_id": str(rule.get("rule_id", "")), "rule_version": version})
                citations.extend(list(rule.get("citations", [])))
                pair_key = tuple(sorted([x, y]))
                pair_rule_index.setdefault(pair_key, []).append(
                    {
                        "rule_id": str(rule.get("rule_id", "")),
                        "severity": sev,
                    }
                )

        for pair_key, hit_rows in pair_rule_index.items():
            severity_set = sorted({str(r.get("severity", "")) for r in hit_rows})
            if len(severity_set) > 1:
                conflicts.append(
                    {
                        "pair": list(pair_key),
                        "severities": severity_set,
                        "rule_ids": [str(r.get("rule_id", "")) for r in hit_rows],
                        "message": "Conflicting interaction severities for same drug pair.",
                    }
                )

        if not findings:
            return {
                "request_id": request_id,
                "status": "ok",
                "result_type": "interaction_check",
                "overall_severity": "none",
                "findings": [],
                "applied_rules": [],
                "citations": [],
                "conflicts": [],
                "confidence": 0.75,
            }

        return {
            "request_id": request_id,
            "status": "ok",
            "result_type": "interaction_check",
            "overall_severity": top_severity,
            "findings": findings,
            "applied_rules": applied,
            "citations": citations,
            "conflicts": conflicts,
            "confidence": 0.7 if conflicts else 0.94,
        }
