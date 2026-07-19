"""B3 (2026-07-20): patient authz is structural, not remembered.

get_accessible_patient (app/dependencies.py) replaced 13 hand-rolled
「normalize → fetch → 404 → verify_patient_access」 blocks. This static
guard keeps new routers from reverting to the imperative pattern, where
forgetting the call silently ships without an access check.
"""
from __future__ import annotations

import pathlib

APP_DIR = pathlib.Path(__file__).resolve().parents[2] / "app"

# verify_patient_access 只准出現在這些檔案:
ALLOWED = {
    "utils/patient_access.py",   # 定義
    "dependencies.py",           # 唯一合法呼叫點(dependency)
    # B3 exception:layer2(JSON mode)病人不在 DB,shortcut 分支無法用
    # path-param dependency;檔內有註解說明。
    "routers/scores.py",
}


def test_verify_patient_access_only_called_via_dependency():
    offenders = []
    for py in APP_DIR.rglob("*.py"):
        rel = str(py.relative_to(APP_DIR))
        if rel in ALLOWED:
            continue
        text = py.read_text()
        if "verify_patient_access(" in text:
            offenders.append(rel)
    assert not offenders, (
        "verify_patient_access called imperatively outside the dependency — "
        f"use get_accessible_patient instead: {offenders}"
    )


def test_dependency_exists_and_is_used_widely():
    dep_src = (APP_DIR / "dependencies.py").read_text()
    assert "def get_accessible_patient" in dep_src
    users = [
        py for py in (APP_DIR / "routers").rglob("*.py")
        if "get_accessible_patient" in py.read_text()
    ]
    # 13 個 handler 分佈在 10 個 router 檔;低於 8 表示有人大規模退回舊樣式
    assert len(users) >= 8, f"only {len(users)} routers use the dependency"
