"""Audit-status contract (2026-07-19 backend probe finding).

ck_audit_logs_status_valid allows only success/failed/error/degraded.
observability.py used status="detected" — every citation-fabrication /
assertion-conflict audit row was silently dropped by the fire-and-forget
writer (CheckViolation swallowed). This test statically scans every
create_audit_log / schedule_audit_log call site so an invalid literal
status can never ship again.
"""

from __future__ import annotations

import ast
import pathlib
import re

APP_DIR = pathlib.Path(__file__).resolve().parents[2] / "app"

# Single source of truth: parse the allowed set out of the model constraint.
_MODEL = (APP_DIR / "models" / "audit_log.py").read_text()
_ALLOWED = set(re.findall(r"'(\w+)'", re.search(r"status IN \(([^)]*)\)", _MODEL).group(1)))


def _audit_status_literals():
    for py in APP_DIR.rglob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = getattr(func, "id", None) or getattr(func, "attr", None)
            if name not in {"create_audit_log", "schedule_audit_log"}:
                continue
            for kw in node.keywords:
                if kw.arg == "status" and isinstance(kw.value, ast.Constant) \
                        and isinstance(kw.value.value, str):
                    yield py.relative_to(APP_DIR), node.lineno, kw.value.value


def test_model_constraint_parsed():
    assert _ALLOWED == {"success", "failed", "error", "degraded"}


def test_every_literal_audit_status_is_constraint_valid():
    violations = [
        f"{path}:{lineno} status={value!r}"
        for path, lineno, value in _audit_status_literals()
        if value not in _ALLOWED
    ]
    assert not violations, (
        "audit status literal(s) violate ck_audit_logs_status_valid "
        f"(allowed: {sorted(_ALLOWED)}):\n" + "\n".join(violations)
    )


def test_scan_actually_finds_call_sites():
    # Guard against the scanner silently matching nothing.
    assert sum(1 for _ in _audit_status_literals()) >= 5
