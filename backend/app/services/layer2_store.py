from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional

from app.config import settings


class Layer2StoreError(RuntimeError):
    """Raised when Layer2 data cannot be loaded from disk."""


class Layer2Store:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded_batch_id: str = ""
        self._loaded_batch_dir: str = ""
        self._patients_by_id: Dict[str, Dict[str, Any]] = {}
        self._patient_rows: List[Dict[str, Any]] = []
        self._labs_by_patient: Dict[str, Dict[str, Any]] = {}
        self._meds_by_patient: Dict[str, Dict[str, Any]] = {}
        self._cultures_by_patient: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        if not path.exists():
            raise Layer2StoreError(f"layer2 dataset not found: {path}")
        with path.open("r", encoding="utf-8") as f:
            for line_no, raw in enumerate(f, start=1):
                line = raw.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise Layer2StoreError(f"invalid jsonl at {path}:{line_no}: {exc}") from exc
                if isinstance(parsed, dict):
                    rows.append(parsed)
        return rows

    @staticmethod
    def _write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
        with path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                f.write("\n")

    @staticmethod
    def _safe_batch_id_from_manifest(manifest_path: Path, default: str) -> str:
        if not manifest_path.exists():
            return default
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return default
        value = manifest.get("batchId")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return default

    @staticmethod
    def _require_root(path: Path) -> None:
        if not path.exists():
            raise Layer2StoreError(f"layer2 root not found: {path}")
        if not path.is_dir():
            raise Layer2StoreError(f"layer2 root is not a directory: {path}")

    def _resolve_batch_dir(self) -> Path:
        root = Path(settings.LAYER2_ROOT).expanduser().resolve()
        self._require_root(root)

        current = root / "current"
        if current.exists():
            if current.is_symlink():
                return current.resolve()
            if current.is_dir():
                return current

        candidates = sorted([p for p in root.glob("batch_*") if p.is_dir()], key=lambda p: p.name)
        if not candidates:
            raise Layer2StoreError(f"no layer2 batch found under: {root}")
        return candidates[-1]

    def _reload_locked(self, batch_dir: Path, batch_id: str) -> None:
        data_dir = batch_dir / "data"
        patient_path = data_dir / "patient_profile.jsonl"
        lab_path = data_dir / "lab_latest.jsonl"
        med_path = data_dir / "medications_current.jsonl"
        culture_path = data_dir / "culture_susceptibility.jsonl"

        patient_rows = self._read_jsonl(patient_path)
        lab_rows = self._read_jsonl(lab_path)
        med_rows = self._read_jsonl(med_path)
        culture_rows: List[Dict[str, Any]] = []
        if culture_path.exists():
            culture_rows = self._read_jsonl(culture_path)

        patients_by_id: Dict[str, Dict[str, Any]] = {}
        for row in patient_rows:
            pid = str(row.get("patientId", "")).strip()
            if not pid:
                continue
            patients_by_id[pid] = row

        labs_by_patient: Dict[str, Dict[str, Any]] = {}
        for row in lab_rows:
            pid = str(row.get("patientId", "")).strip()
            if not pid:
                continue
            labs_by_patient[pid] = row

        meds_by_patient: Dict[str, Dict[str, Any]] = {}
        for row in med_rows:
            pid = str(row.get("patientId", "")).strip()
            if not pid:
                continue
            meds_by_patient[pid] = row

        cultures_by_patient: Dict[str, Dict[str, Any]] = {}
        for row in culture_rows:
            pid = str(row.get("patientId", "")).strip()
            if not pid:
                continue
            cultures_by_patient[pid] = row

        self._patient_rows = patient_rows
        self._patients_by_id = patients_by_id
        self._labs_by_patient = labs_by_patient
        self._meds_by_patient = meds_by_patient
        self._cultures_by_patient = cultures_by_patient
        self._loaded_batch_id = batch_id
        self._loaded_batch_dir = str(batch_dir)

    def _load_if_needed(self) -> None:
        batch_dir = self._resolve_batch_dir()
        batch_id = self._safe_batch_id_from_manifest(
            batch_dir / "metadata" / "manifest.json",
            batch_dir.name,
        )

        with self._lock:
            if self._loaded_batch_id == batch_id and self._loaded_batch_dir == str(batch_dir):
                return
            self._reload_locked(batch_dir, batch_id)

    def get_meta(self) -> Dict[str, Any]:
        self._load_if_needed()
        return {
            "batchId": self._loaded_batch_id,
            "batchDir": self._loaded_batch_dir,
            "patientCount": len(self._patient_rows),
            "labPatientCount": len(self._labs_by_patient),
            "medicationPatientCount": len(self._meds_by_patient),
            "culturePatientCount": len(self._cultures_by_patient),
        }

    def list_patients(self) -> List[Dict[str, Any]]:
        self._load_if_needed()
        return deepcopy(self._patient_rows)

    def get_patient(self, patient_id: str) -> Optional[Dict[str, Any]]:
        self._load_if_needed()
        row = self._patients_by_id.get(patient_id)
        if row is None:
            return None
        return deepcopy(row)

    def get_lab_latest(self, patient_id: str) -> Optional[Dict[str, Any]]:
        self._load_if_needed()
        row = self._labs_by_patient.get(patient_id)
        if row is None:
            return None
        return deepcopy(row)

    def get_medications_current(self, patient_id: str) -> Optional[Dict[str, Any]]:
        self._load_if_needed()
        row = self._meds_by_patient.get(patient_id)
        if row is None:
            return None
        return deepcopy(row)

    def get_culture_susceptibility(self, patient_id: str) -> Optional[Dict[str, Any]]:
        self._load_if_needed()
        row = self._cultures_by_patient.get(patient_id)
        if row is None:
            return None
        return deepcopy(row)

    def update_medication_current(
        self,
        patient_id: str,
        medication_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        self._load_if_needed()
        with self._lock:
            batch_dir = Path(self._loaded_batch_dir)
            med_path = batch_dir / "data" / "medications_current.jsonl"
            med_rows = self._read_jsonl(med_path)

            patient_row: Optional[Dict[str, Any]] = None
            updated_medication: Optional[Dict[str, Any]] = None
            for row in med_rows:
                pid = str(row.get("patientId", "")).strip()
                if pid != patient_id:
                    continue
                patient_row = row
                medications = row.get("medications")
                if not isinstance(medications, list):
                    break
                for medication in medications:
                    if str(medication.get("id", "")).strip() != medication_id:
                        continue
                    for key, value in updates.items():
                        medication[key] = value
                    updated_medication = deepcopy(medication)
                    break
                break

            if patient_row is None or updated_medication is None:
                return None

            self._write_jsonl(med_path, med_rows)
            self._meds_by_patient[patient_id] = deepcopy(patient_row)
            return updated_medication


layer2_store = Layer2Store()
