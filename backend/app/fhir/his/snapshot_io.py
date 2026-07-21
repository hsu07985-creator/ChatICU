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


# --------------------------------------------------------------------------- #
# ALL_MERGED.json fallback (nested "Factories/ + Smartbed/" snapshot layout)
#
# The 2026-07-21 export dropped the flat per-source files (<dir>/getPatient.json
# and ExtraFactories/Factory_*/) in favour of nested Factories/<hosp>/ +
# Smartbed/<hosp>/ directories, shipping one ALL_MERGED.json that carries every
# source. To avoid changing behaviour for the flat/hourly-flat layouts still in
# production, ALL_MERGED is consulted ONLY as a last resort — after the existing
# filesystem attempts return nothing. It preserves the same campus-aware
# top-level + ExtraFactories_Factory_* flat keys, so single/all resolution is a
# straight key lookup.
# --------------------------------------------------------------------------- #

_ALL_MERGED_CACHE_KEY = "__ALL_MERGED__"
_EXTRA_PREFIX = "ExtraFactories_Factory_"


def _all_merged(cache: Dict[str, Any], patient_dir: str) -> Any:
    """Load + cache ALL_MERGED.json for ``patient_dir``; None when absent/bad."""
    if _ALL_MERGED_CACHE_KEY not in cache:
        path = os.path.join(patient_dir, "ALL_MERGED.json")
        data = None
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8-sig") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                data = None
        cache[_ALL_MERGED_CACHE_KEY] = data if isinstance(data, dict) else None
    return cache[_ALL_MERGED_CACHE_KEY]


def _envelope_rows(node: Any) -> list:
    """Rows from a REST envelope ``{"Data": [...]}`` or a bare list."""
    if isinstance(node, dict):
        data = node.get("Data")
        if isinstance(data, list):
            return data
        return [data] if data else []
    if isinstance(node, list):
        return node
    return []


def _base_names(candidates: Tuple[str, ...]) -> Tuple[str, ...]:
    """Strip the ``.json`` suffix so filenames map to ALL_MERGED top-level keys."""
    return tuple(c[:-5] if c.endswith(".json") else c for c in candidates)


def _merged_single(all_merged: dict, candidates: Tuple[str, ...]) -> list:
    """load_single semantics against ALL_MERGED: primary key, else any campus."""
    bases = _base_names(candidates)
    for base in bases:
        rows = _envelope_rows(all_merged.get(base))
        if rows:
            return rows
    for base in bases:
        for key, value in all_merged.items():
            if key.startswith(_EXTRA_PREFIX) and key.endswith("_" + base):
                rows = _envelope_rows(value)
                if rows:
                    return rows
    return []


def _merged_all(all_merged: dict, candidates: Tuple[str, ...]) -> list:
    """load_all semantics against ALL_MERGED: union primary + every campus key."""
    out: list = []
    for base in _base_names(candidates):
        for row in _envelope_rows(all_merged.get(base)):
            if isinstance(row, dict):
                row = dict(row)
                row.setdefault("_source_factory", "MAIN")
            out.append(row)
        for key, value in all_merged.items():
            if not (key.startswith(_EXTRA_PREFIX) and key.endswith("_" + base)):
                continue
            factory = key[len(_EXTRA_PREFIX):-(len(base) + 1)]
            for row in _envelope_rows(value):
                if isinstance(row, dict):
                    row = dict(row)
                    row.setdefault("_source_factory", f"Factory_{factory}")
                out.append(row)
    return out


def load_smartbed(cache: Dict[str, Any], patient_dir: str, sb_name: str) -> list:
    """Flatten a SMARTBED source to a row list, across both snapshot layouts.

    Flat layout: ``<patient_dir>/<sb_name>.json`` (shape-1/2/3). Nested layout:
    ``ALL_MERGED.json`` › ``Smartbed`` › ``<hosp>`` › ``<sb_name>`` where the
    value is either ``{seq: [rows]}`` (per-visit) or a bare ``[rows]`` list.
    SMARTBED is main-campus-only, so campus iteration is a formality.
    """
    cache_key = f"__SB__{sb_name}"
    if cache_key in cache:
        return cache[cache_key]

    result = _load_from_dir(patient_dir, (f"{sb_name}.json",))
    if not result:
        all_merged = _all_merged(cache, patient_dir)
        smartbed = (all_merged or {}).get("Smartbed") or {}
        rows: list = []
        for hosp_block in smartbed.values():
            node = hosp_block.get(sb_name) if isinstance(hosp_block, dict) else None
            if isinstance(node, dict):
                for seq_rows in node.values():
                    if isinstance(seq_rows, list):
                        rows.extend(r for r in seq_rows if isinstance(r, dict))
            elif isinstance(node, list):
                rows.extend(r for r in node if isinstance(r, dict))
        result = rows

    cache[cache_key] = result
    return result


def load_seq(cache: Dict[str, Any], patient_dir: str, tool: str) -> list:
    """Flatten a ``<tool>_AllPatientSeq`` envelope's Responses[].Data[] to rows.

    Covers getSO / getTPR / getMedicine / getStatOrder in both layouts (flat
    file ``<tool>_AllPatientSeq.json`` or the same key inside ALL_MERGED.json).
    """
    key = f"{tool}_AllPatientSeq"
    cache_key = f"__SEQ__{tool}"
    if cache_key in cache:
        return cache[cache_key]

    env: Any = None
    path = os.path.join(patient_dir, f"{key}.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8-sig") as f:
                env = json.load(f)
        except (json.JSONDecodeError, OSError):
            env = None
    if not isinstance(env, dict):
        env = (_all_merged(cache, patient_dir) or {}).get(key)

    rows: list = []
    if isinstance(env, dict):
        for resp in env.get("Responses") or []:
            for row in (resp or {}).get("Data") or []:
                if isinstance(row, dict):
                    rows.append(row)

    cache[cache_key] = rows
    return rows


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

    if not result:
        all_merged = _all_merged(cache, patient_dir)
        if all_merged is not None:
            result = _merged_single(all_merged, candidates)

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

    # Nested layout (no flat files / ExtraFactories dir): union the campus keys
    # carried inside ALL_MERGED.json instead.
    if not merged:
        all_merged = _all_merged(cache, patient_dir)
        if all_merged is not None:
            merged = _merged_all(all_merged, candidates)

    cache[cache_key] = merged
    return merged
