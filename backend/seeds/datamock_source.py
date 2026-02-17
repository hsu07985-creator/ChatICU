"""Shared datamock JSON source helpers for offline/json mode."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Union

from app.config import settings


def _candidate_datamock_dirs() -> list[Path]:
    candidates: list[Path] = []
    env_dir = (settings.DATAMOCK_DIR or "").strip()
    if env_dir:
        candidates.append(Path(env_dir).expanduser())

    # Docker compose mount path
    candidates.append(Path("/datamock"))
    # Repository local path
    candidates.append(Path(__file__).resolve().parents[2] / "datamock")

    dedup: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        dedup.append(path)
        seen.add(key)
    return dedup


def get_datamock_dir() -> Path:
    for path in _candidate_datamock_dirs():
        if path.exists() and path.is_dir():
            return path
    candidate_str = ", ".join(str(p) for p in _candidate_datamock_dirs())
    raise FileNotFoundError(
        "datamock directory not found. "
        f"Checked: {candidate_str}. "
        "Set DATAMOCK_DIR in backend/.env when running outside docker."
    )


def load_json(filename: str, *, required: bool = False) -> Union[list, dict]:
    filepath = get_datamock_dir() / filename
    if not filepath.exists():
        if required:
            raise FileNotFoundError(f"Required datamock file missing: {filepath}")
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def unwrap_list(raw: Union[list, dict], key: str) -> list:
    """Return list payload from either raw list or wrapped dict {key: [...]}."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        value = raw.get(key)
        if isinstance(value, list):
            return value
        # Fallback: return the first list-like value in dict if key is absent.
        for v in raw.values():
            if isinstance(v, list):
                return v
    return []

