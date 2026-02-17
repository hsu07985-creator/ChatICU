#!/usr/bin/env python3
"""Run deterministic golden tests for clinical dose and interaction engines."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from evidence_rag.clinical import ClinicalRuleStore, DoseEngine, InteractionEngine
from evidence_rag.clinical.exceptions import ClinicalInputError, ClinicalRuleError


@dataclass
class CaseResult:
    case_id: str
    passed: bool
    errors: list[str]
    expected: dict[str, Any]
    actual: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "passed": self.passed,
            "errors": self.errors,
            "expected": self.expected,
            "actual": self.actual,
        }


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Invalid JSON file: {path}: {exc}") from exc


def _approx_equal(actual: Any, expected: Any, tolerance: float) -> bool:
    try:
        return abs(float(actual) - float(expected)) <= tolerance
    except Exception:
        return False


def _normalize_dose_error(exc: Exception, request_id: str) -> dict[str, Any]:
    return {
        "request_id": request_id,
        "status": "refused",
        "result_type": "dose_calculation",
        "error_code": "RULE_OR_INPUT_ERROR",
        "message": str(exc),
        "computed_values": {},
        "calculation_steps": [],
        "applied_rules": [],
        "safety_warnings": [str(exc)],
        "citations": [],
        "confidence": 0.0,
    }


def _normalize_interaction_error(exc: Exception, request_id: str) -> dict[str, Any]:
    return {
        "request_id": request_id,
        "status": "refused",
        "result_type": "interaction_check",
        "error_code": "RULE_OR_INPUT_ERROR",
        "overall_severity": "none",
        "findings": [],
        "applied_rules": [],
        "citations": [],
        "confidence": 0.0,
        "message": str(exc),
    }


def _validate_dose_case(result: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if result.get("status") != expected.get("status"):
        errors.append(
            f"status mismatch: expected={expected.get('status')} actual={result.get('status')}"
        )
        return errors

    if expected.get("status") == "ok":
        final_rate = dict((result.get("computed_values") or {}).get("final_rate") or {})
        expected_value = expected.get("final_rate_value")
        expected_unit = expected.get("final_rate_unit")
        tolerance = float(expected.get("tolerance", 0.01))
        if expected_value is not None and not _approx_equal(
            final_rate.get("value"), expected_value, tolerance
        ):
            errors.append(
                f"final_rate value mismatch: expected={expected_value} actual={final_rate.get('value')}"
            )
        if expected_unit is not None and final_rate.get("unit") != expected_unit:
            errors.append(
                f"final_rate unit mismatch: expected={expected_unit} actual={final_rate.get('unit')}"
            )
        if not result.get("applied_rules"):
            errors.append("applied_rules must not be empty when status=ok")
        if not result.get("citations"):
            errors.append("citations must not be empty when status=ok")
    else:
        expected_error = expected.get("error_code")
        if expected_error and result.get("error_code") != expected_error:
            errors.append(
                f"error_code mismatch: expected={expected_error} actual={result.get('error_code')}"
            )
    return errors


def _validate_interaction_case(result: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if result.get("status") != expected.get("status"):
        errors.append(
            f"status mismatch: expected={expected.get('status')} actual={result.get('status')}"
        )
        return errors

    if expected.get("status") == "ok":
        expected_severity = expected.get("overall_severity")
        if expected_severity and result.get("overall_severity") != expected_severity:
            errors.append(
                "overall_severity mismatch: "
                f"expected={expected_severity} actual={result.get('overall_severity')}"
            )

        findings = list(result.get("findings", []))
        expected_count = expected.get("finding_count")
        if expected_count is not None and len(findings) != int(expected_count):
            errors.append(f"finding_count mismatch: expected={expected_count} actual={len(findings)}")

        if "rule_ids" in expected:
            expected_rule_ids = sorted([str(x) for x in expected.get("rule_ids", [])])
            actual_rule_ids = sorted([str(x.get("rule_id", "")) for x in findings])
            if expected_rule_ids != actual_rule_ids:
                errors.append(
                    f"rule_ids mismatch: expected={expected_rule_ids} actual={actual_rule_ids}"
                )

        if findings:
            if not result.get("applied_rules"):
                errors.append("applied_rules must not be empty when findings exist")
            if not result.get("citations"):
                errors.append("citations must not be empty when findings exist")
    else:
        expected_error = expected.get("error_code")
        if expected_error and result.get("error_code") != expected_error:
            errors.append(
                f"error_code mismatch: expected={expected_error} actual={result.get('error_code')}"
            )
    return errors


def _run_dose_cases(engine: DoseEngine, payload: dict[str, Any]) -> dict[str, Any]:
    rows: list[CaseResult] = []
    cases = list(payload.get("cases", []))
    for case in cases:
        case_id = str(case.get("case_id", "dose-unknown"))
        request = dict(case.get("request", {}))
        expected = dict(case.get("expected", {}))
        request_id = str(request.get("request_id", case_id))
        try:
            actual = engine.calculate({**request, "request_id": request_id})
        except (ClinicalInputError, ClinicalRuleError) as exc:
            actual = _normalize_dose_error(exc=exc, request_id=request_id)

        errors = _validate_dose_case(actual, expected)
        rows.append(
            CaseResult(
                case_id=case_id,
                passed=not errors,
                errors=errors,
                expected=expected,
                actual=actual,
            )
        )

    passed = sum(1 for r in rows if r.passed)
    total = len(rows)
    return {
        "suite": "dose",
        "version": str(payload.get("version", "")),
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": round((passed / total) if total else 0.0, 4),
        "cases": [r.to_dict() for r in rows],
    }


def _run_interaction_cases(engine: InteractionEngine, payload: dict[str, Any]) -> dict[str, Any]:
    rows: list[CaseResult] = []
    cases = list(payload.get("cases", []))
    for case in cases:
        case_id = str(case.get("case_id", "interaction-unknown"))
        request = dict(case.get("request", {}))
        expected = dict(case.get("expected", {}))
        request_id = str(request.get("request_id", case_id))
        try:
            actual = engine.check({**request, "request_id": request_id})
        except (ClinicalInputError, ClinicalRuleError) as exc:
            actual = _normalize_interaction_error(exc=exc, request_id=request_id)

        errors = _validate_interaction_case(actual, expected)
        rows.append(
            CaseResult(
                case_id=case_id,
                passed=not errors,
                errors=errors,
                expected=expected,
                actual=actual,
            )
        )

    passed = sum(1 for r in rows if r.passed)
    total = len(rows)
    return {
        "suite": "interaction",
        "version": str(payload.get("version", "")),
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": round((passed / total) if total else 0.0, 4),
        "cases": [r.to_dict() for r in rows],
    }


def _write_suite_markdown(path: Path, title: str, suite_report: dict[str, Any]) -> None:
    today = date.today().isoformat()
    lines = [
        f"# {title}",
        "",
        f"Date: {today}",
        "",
        "## Summary",
        f"- Total cases: {suite_report['total']}",
        f"- Passed: {suite_report['passed']}",
        f"- Failed: {suite_report['failed']}",
        f"- Pass rate: {suite_report['pass_rate']:.4f}",
        "",
        "## Failed Cases",
    ]
    failures = [c for c in suite_report["cases"] if not c["passed"]]
    if not failures:
        lines.append("- None")
    else:
        for row in failures:
            lines.append(f"- {row['case_id']}: {'; '.join(row['errors'])}")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run clinical golden tests")
    parser.add_argument(
        "--manifest",
        default="clinical_rules/release_manifest.json",
        help="Path to clinical release manifest JSON",
    )
    parser.add_argument(
        "--dose-cases",
        default="clinical_rules/golden/dose_cases.v1.mock.json",
        help="Path to dose golden cases JSON",
    )
    parser.add_argument(
        "--interaction-cases",
        default="clinical_rules/golden/interaction_cases.v1.mock.json",
        help="Path to interaction golden cases JSON",
    )
    parser.add_argument(
        "--output-dir",
        default="evidence_rag_data/logs",
        help="Directory for report outputs",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print full per-case payload to stdout",
    )
    parser.add_argument(
        "--min-pass-rate",
        type=float,
        default=float(os.environ.get("GOLDEN_MIN_PASS_RATE", "1.0")),
        help="Minimum overall pass rate required (0~1, default from GOLDEN_MIN_PASS_RATE or 1.0)",
    )
    parser.add_argument(
        "--min-dose-pass-rate",
        type=float,
        default=None,
        help="Minimum dose suite pass rate required (0~1, default=min-pass-rate)",
    )
    parser.add_argument(
        "--min-interaction-pass-rate",
        type=float,
        default=None,
        help="Minimum interaction suite pass rate required (0~1, default=min-pass-rate)",
    )
    args = parser.parse_args()

    min_pass_rate = float(args.min_pass_rate)
    min_dose_pass_rate = (
        float(args.min_dose_pass_rate)
        if args.min_dose_pass_rate is not None
        else min_pass_rate
    )
    min_interaction_pass_rate = (
        float(args.min_interaction_pass_rate)
        if args.min_interaction_pass_rate is not None
        else min_pass_rate
    )

    for name, value in (
        ("min-pass-rate", min_pass_rate),
        ("min-dose-pass-rate", min_dose_pass_rate),
        ("min-interaction-pass-rate", min_interaction_pass_rate),
    ):
        if value < 0 or value > 1:
            raise ValueError(f"{name} must be within [0, 1], got {value}")

    manifest_path = Path(args.manifest).resolve()
    dose_cases_path = Path(args.dose_cases).resolve()
    interaction_cases_path = Path(args.interaction_cases).resolve()
    out_dir = Path(args.output_dir).resolve()

    store = ClinicalRuleStore(manifest_path)
    dose_engine = DoseEngine(store)
    interaction_engine = InteractionEngine(store)

    dose_payload = _read_json(dose_cases_path)
    interaction_payload = _read_json(interaction_cases_path)
    rules_snapshot = store.snapshot()

    dose_report = _run_dose_cases(dose_engine, dose_payload)
    interaction_report = _run_interaction_cases(interaction_engine, interaction_payload)
    total = dose_report["total"] + interaction_report["total"]
    passed = dose_report["passed"] + interaction_report["passed"]
    failed = total - passed
    overall_pass_rate = round((passed / total) if total else 0.0, 4)

    report_paths = {
        "clinical_golden_report": str(out_dir / "clinical_golden_report.json"),
        "dose_engine_eval": str(out_dir / "dose_engine_eval_v1.md"),
        "interaction_engine_eval": str(out_dir / "interaction_engine_eval_v1.md"),
    }

    quality_violations: list[str] = []
    if overall_pass_rate < min_pass_rate:
        quality_violations.append(
            f"overall pass_rate below threshold: actual={overall_pass_rate} required={min_pass_rate}"
        )
    if dose_report["pass_rate"] < min_dose_pass_rate:
        quality_violations.append(
            f"dose pass_rate below threshold: actual={dose_report['pass_rate']} required={min_dose_pass_rate}"
        )
    if interaction_report["pass_rate"] < min_interaction_pass_rate:
        quality_violations.append(
            "interaction pass_rate below threshold: "
            f"actual={interaction_report['pass_rate']} required={min_interaction_pass_rate}"
        )

    summary = {
        "date": date.today().isoformat(),
        "manifest_path": str(manifest_path),
        "dose_cases_path": str(dose_cases_path),
        "interaction_cases_path": str(interaction_cases_path),
        "rules_snapshot": rules_snapshot,
        "dose": dose_report,
        "interaction": interaction_report,
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": overall_pass_rate,
        "quality_gate": {
            "passed": len(quality_violations) == 0,
            "violations": quality_violations,
            "thresholds": {
                "overall_min_pass_rate": min_pass_rate,
                "dose_min_pass_rate": min_dose_pass_rate,
                "interaction_min_pass_rate": min_interaction_pass_rate,
            },
        },
        "report_paths": report_paths,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "clinical_golden_report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _write_suite_markdown(out_dir / "dose_engine_eval_v1.md", "Dose Engine Eval v1", dose_report)
    _write_suite_markdown(
        out_dir / "interaction_engine_eval_v1.md",
        "Interaction Engine Eval v1",
        interaction_report,
    )

    if args.verbose:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        compact = {
            "date": summary["date"],
            "rules_snapshot": {
                "active_release": rules_snapshot.get("active_release", ""),
                "dose_version": rules_snapshot.get("dose_version", ""),
                "interaction_version": rules_snapshot.get("interaction_version", ""),
            },
            "dose": {
                "total": dose_report["total"],
                "passed": dose_report["passed"],
                "failed": dose_report["failed"],
                "pass_rate": dose_report["pass_rate"],
            },
            "interaction": {
                "total": interaction_report["total"],
                "passed": interaction_report["passed"],
                "failed": interaction_report["failed"],
                "pass_rate": interaction_report["pass_rate"],
            },
            "total": summary["total"],
            "passed": summary["passed"],
            "failed": summary["failed"],
            "pass_rate": summary["pass_rate"],
            "quality_gate": summary["quality_gate"],
            "report_paths": report_paths,
        }
        print(json.dumps(compact, ensure_ascii=False, indent=2))
    return 0 if summary["quality_gate"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
