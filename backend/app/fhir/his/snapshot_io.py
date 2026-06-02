"""Filesystem snapshot reading + per-converter caching.

These functions implement the campus-aware HIS JSON loading strategy. They are
parameterized on an explicit ``cache`` dict and ``patient_dir`` so the
:class:`~app.fhir.his.converter.HISConverter` instance can delegate to them
while keeping its public ``_load`` / ``_load_all`` / ``_load_from_dir`` methods.
"""

import json
import os
from typing import Any, Dict, Tuple

from app.fhir.his.resources import _FILENAME_ALIASES


def _load_from_dir(dir_path: str, candidates: Tuple[str, ...]) -> list:
    """Try each candidate filename in ``dir_path``; return its Data array.

    Returns an empty list when no candidate exists or when the payload
    has no ``Data`` key / empty array. utf-8-sig tolerates the leading
    BOM that HIS flat-layout exports ship with (patients 50911741 /
    70117162 on 2026-04-14); see snapshot_resolver._load_json_file for
    the matching fix at the resolver stage.
    """
    data = None
    for candidate in candidates:
        path = os.path.join(dir_path, candidate)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        break
    if data is None:
        return []
    result = data.get("Data", []) if isinstance(data, dict) else data
    if not isinstance(result, list):
        result = [result] if result else []
    return result


def load_single(cache: Dict[str, Any], patient_dir: str, filename: str) -> list:
    """Load a HIS JSON file for single-record types (patient demographics).

    Resolution order:
      1. Top-level ``<patient_dir>/<filename>`` (the common case).
      2. If step 1 yields nothing (file missing OR ``Data: []``), walk
         ``<patient_dir>/ExtraFactories/Factory_*/`` in sorted order and
         return the first non-empty one.

    Use this for data where exactly ONE answer is expected (Patient
    demographics). For additive data (meds, labs, orders, visits) that
    can legitimately exist across multiple campuses, use `load_all()`.

    Rationale: the HIS fetcher probes every hospital campus (HospId =
    M, G, H, Q, F) and only stores non-empty responses. For most
    patients, the primary campus returns everything and top-level wins.
    But patients whose data is split across campuses (e.g. 70117162 on
    2026-04-14 — admitted at M, but all 28 lab results live at F)
    leave top-level empty for the missing data types and the real
    payload sits under ``ExtraFactories/Factory_F/``. Without this
    fallback, HISConverter would silently skip that data.
    """
    if filename in cache:
        return cache[filename]
    candidates = _FILENAME_ALIASES.get(filename, (filename,))

    result = _load_from_dir(patient_dir, candidates)

    if not result:
        extras_dir = os.path.join(patient_dir, "ExtraFactories")
        if os.path.isdir(extras_dir):
            for factory_name in sorted(os.listdir(extras_dir)):
                factory_dir = os.path.join(extras_dir, factory_name)
                if not os.path.isdir(factory_dir):
                    continue
                result = _load_from_dir(factory_dir, candidates)
                if result:
                    break

    cache[filename] = result
    return result


def load_all(cache: Dict[str, Any], patient_dir: str, filename: str) -> list:
    """Load a HIS JSON file across ALL campuses and concatenate.

    For additive data types (medications, labs, orders, visits) a patient
    may legitimately have records at multiple hospital campuses — e.g.
    70117162 admitted at the main campus (M) but has 35 extra labs + 10
    extra outpatient meds stored at Factory_F. The legacy `load_single()` only
    returns top-level data, silently dropping Factory_F records.

    This method unions top-level + every ExtraFactory, tagging each row
    with `_source_factory` so downstream analytics can surface the
    cross-campus origin.

    Downstream id generation (e.g. `_gen_id("med", MRN, ODR_SEQ, ODR_CODE)`)
    de-duplicates rows that happen to appear in both top-level and a
    factory, so a simple concat is safe.

    Note: cached rows are shallow-copied before the ``_source_factory`` tag is
    injected, so the per-converter cache is never mutated in place.
    """
    cache_key = f"__ALL__{filename}"
    if cache_key in cache:
        return cache[cache_key]
    candidates = _FILENAME_ALIASES.get(filename, (filename,))

    merged: list = []
    # Top-level
    top = _load_from_dir(patient_dir, candidates)
    for row in top:
        if isinstance(row, dict):
            row = dict(row)
            row.setdefault("_source_factory", "MAIN")
        merged.append(row)

    # Every ExtraFactory
    extras_dir = os.path.join(patient_dir, "ExtraFactories")
    if os.path.isdir(extras_dir):
        for factory_name in sorted(os.listdir(extras_dir)):
            factory_dir = os.path.join(extras_dir, factory_name)
            if not os.path.isdir(factory_dir):
                continue
            rows = _load_from_dir(factory_dir, candidates)
            for row in rows:
                if isinstance(row, dict):
                    row = dict(row)
                    row.setdefault("_source_factory", factory_name)
                merged.append(row)

    cache[cache_key] = merged
    return merged
