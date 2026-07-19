#!/usr/bin/env python3
"""AI 迴歸 eval runner(AI-OPT #3,2026-07-20)。

對本機棧(docs/qa/local-ui-walkthrough-runbook.md)執行
backend/evals/ai_regression_cases.yaml 的案例,deterministic 斷言,
任一 FAIL 以非零碼結束。模型升級 / prompt 改動 / 降級路由前必跑。

用法:
    cd backend && .venv312/bin/python scripts/eval_ai_regression.py
    EVAL_BASE_URL=http://127.0.0.1:18100 EVAL_USER=admin EVAL_PASS=admin \\
        .venv312/bin/python scripts/eval_ai_regression.py --only chat_potassium_grounding
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx
import yaml

BASE = os.environ.get("EVAL_BASE_URL", "http://127.0.0.1:18100")
CASES_PATH = Path(__file__).resolve().parent.parent / "evals" / "ai_regression_cases.yaml"


def _login(client: httpx.Client) -> None:
    r = client.post(BASE + "/auth/login", json={
        "username": os.environ.get("EVAL_USER", "admin"),
        "password": os.environ.get("EVAL_PASS", "admin"),
    })
    r.raise_for_status()
    client.headers["Authorization"] = f"Bearer {r.json()['data']['token']}"


def _run_sse(client: httpx.Client, url: str, payload: dict, timeout: float):
    """Collect a delta/done/error SSE stream. Returns (text, done_payload, err)."""
    text, done_payload, err, event = "", None, None, None
    with client.stream("POST", url, json=payload, timeout=timeout) as r:
        for line in r.iter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
                if event == "delta":
                    try:
                        text += json.loads(data).get("chunk", "")
                    except Exception:
                        pass
                elif event == "done":
                    done_payload = json.loads(data)
                elif event == "error":
                    err = data[:300]
    return text, done_payload, err


def _execute(client: httpx.Client, case: dict):
    """Run one case. Returns (full_text, payload_fields, elapsed, err)."""
    t0 = time.time()
    ctype = case["type"]
    timeout = float(case.get("assertions", {}).get("max_seconds", 90)) + 30

    if ctype == "chat":
        text, done, err = _run_sse(client, BASE + "/ai/chat/stream", {
            "message": case["message"], "patientId": case.get("patient_id"),
        }, timeout)
        msg = (done or {}).get("message", {})
        full = (msg.get("content") or "") + "\n" + (msg.get("explanation") or "") or text
        fields = {
            "explanation": msg.get("explanation"),
            "citations": msg.get("citations"),
            "requiresExpertReview": msg.get("requiresExpertReview"),
            "graphMeta": msg.get("graphMeta"),
        }
    elif ctype == "summary":
        text, done, err = _run_sse(client, BASE + "/api/v1/clinical/summary/stream", {
            "patient_id": case["patient_id"],
            "summary_depth": case.get("summary_depth", "brief"),
        }, timeout)
        data = (done or {}).get("data", {})
        full = data.get("summary") or text
        fields = {
            "safetyWarnings": data.get("safetyWarnings"),
            "summary_structured": data.get("summary_structured"),
        }
    elif ctype == "polish":
        body = {
            "patient_id": case["patient_id"],
            "content": case.get("content", ""),
            "polish_type": case["polish_type"],
        }
        if case.get("polish_mode"):
            body["polish_mode"] = case["polish_mode"]
        if case.get("task"):
            body["task"] = case["task"]
        if case.get("soap_sections"):
            body["soap_sections"] = case["soap_sections"]
        r = client.post(BASE + "/api/v1/clinical/polish", json=body, timeout=timeout)
        err = None if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:200]}"
        data = r.json().get("data", {}) if r.status_code == 200 else {}
        full = data.get("polished") or ""
        fields = {"polished_sections": data.get("polished_sections")}
    else:
        raise ValueError(f"unknown case type: {ctype}")

    return full, fields, time.time() - t0, err


def _assert_case(case: dict, full: str, fields: dict, elapsed: float, err):
    a = case.get("assertions", {})
    failures = []
    low = (full or "").lower()

    if err:
        failures.append(f"stream/request error: {err}")
    if not (full or "").strip():
        failures.append("empty output")
    for needle in a.get("contains", []):
        if needle.lower() not in low:
            failures.append(f"missing required text: {needle!r}")
    for key in ("contains_any", "contains_any_2"):
        group = a.get(key, [])
        if group and not any(n.lower() in low for n in group):
            failures.append(f"{key} all missed: {group}")
    for needle in a.get("not_contains", []):
        if needle.lower() in low:
            failures.append(f"forbidden text present: {needle!r}")
    if a.get("max_seconds") and elapsed > float(a["max_seconds"]):
        failures.append(f"too slow: {elapsed:.1f}s > {a['max_seconds']}s")
    if a.get("expect_guardrail") and not fields.get("safetyWarnings"):
        failures.append("expected safetyWarnings, got none")
    if a.get("expect_structured") and not fields.get("summary_structured"):
        failures.append("expected summary_structured, got none")
    if a.get("expect_polished_sections") and not fields.get("polished_sections"):
        failures.append("expected polished_sections (SOAP JSON parse), got none")
    if a.get("expect_explanation") is True and not fields.get("explanation"):
        failures.append("expected explanation (B14 split), got none")
    if a.get("expect_citations") and not fields.get("citations"):
        failures.append("expected non-empty citations (F02), got none")
    if a.get("expect_graph_meta") and not (fields.get("graphMeta") or {}).get("interactions"):
        failures.append("expected graphMeta.interactions (F19), got none")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="run a single case by name")
    args = parser.parse_args()

    cases = yaml.safe_load(CASES_PATH.read_text())["cases"]
    if args.only:
        cases = [c for c in cases if c["name"] == args.only]
        if not cases:
            print(f"no case named {args.only}")
            return 2

    n_fail = 0
    with httpx.Client(timeout=120) as client:
        _login(client)
        for case in cases:
            try:
                full, fields, elapsed, err = _execute(client, case)
                failures = _assert_case(case, full, fields, elapsed, err)
            except Exception as exc:  # noqa: BLE001 — a broken case is a FAIL, not a crash
                failures, elapsed = [f"exception: {type(exc).__name__}: {exc}"], 0.0
            status = "PASS" if not failures else "FAIL"
            if failures:
                n_fail += 1
            print(f"{status}  {case['name']}  ({elapsed:.1f}s)")
            for f in failures:
                print(f"      - {f}")

    print(f"\n===== {len(cases) - n_fail}/{len(cases)} PASS =====")
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
