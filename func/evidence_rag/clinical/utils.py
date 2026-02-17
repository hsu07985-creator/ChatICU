"""Helpers for canonicalization and simple rule condition evaluation."""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


COND_RE = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|\"([^\"]*)\"|[-+]?[0-9]*\.?[0-9]+)\s*$"
)


def normalize_token(value: str) -> str:
    return value.strip().lower()


def to_decimal(value: Any, default: str = "0") -> Decimal:
    try:
        if value is None:
            return Decimal(default)
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def round_decimal(value: Decimal, scale: int = 2) -> Decimal:
    q = Decimal(1).scaleb(-scale)
    return value.quantize(q, rounding=ROUND_HALF_UP)


def evaluate_condition(expr: str, context: dict[str, Any]) -> bool:
    m = COND_RE.match(expr or "")
    if not m:
        return False
    field = m.group(1)
    op = m.group(2)
    rhs_raw = m.group(3)
    ctx_val = context.get(field)
    if ctx_val is None:
        return False

    if rhs_raw.startswith(("'", '"')):
        rhs_val: Any = rhs_raw[1:-1]
        lhs_val = str(ctx_val)
    else:
        rhs_val = to_decimal(rhs_raw)
        lhs_val = to_decimal(ctx_val)

    if op == "==":
        return lhs_val == rhs_val
    if op == "!=":
        return lhs_val != rhs_val
    if op == ">":
        return lhs_val > rhs_val
    if op == "<":
        return lhs_val < rhs_val
    if op == ">=":
        return lhs_val >= rhs_val
    if op == "<=":
        return lhs_val <= rhs_val
    return False
