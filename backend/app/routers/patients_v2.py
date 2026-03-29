from __future__ import annotations

import json as _json
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from sqlalchemy import select

from app.middleware.audit import create_audit_log
from app.middleware.auth import get_current_user
from app.middleware.auth import require_roles
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.user import User
from app.routers.lab_data import correct_lab_data as correct_lab_data_v1
from app.routers.medications import record_medication_administration as record_medication_administration_v1
from app.routers.medications import normalize_san_category
from app.routers.patients import archive_patient as archive_patient_v1
from app.routers.patients import create_patient as create_patient_v1
from app.routers.patients import update_patient as update_patient_v1
from app.schemas.lab_data import LabCorrectionRequest
from app.schemas.medication import MedicationUpdate
from app.schemas.medication import MedicationAdministrationUpdate
from app.schemas.patient import PatientArchiveUpdate, PatientCreate, PatientUpdate
from app.services.layer2_store import Layer2StoreError, layer2_store
from app.utils.response import success_response

router = APIRouter(prefix="/v2/patients", tags=["patients-v2"])


def _load_or_503() -> None:
    try:
        layer2_store.get_meta()
    except Layer2StoreError as exc:
        raise HTTPException(status_code=503, detail=f"Layer2 data unavailable: {exc}") from exc


def _profile_to_patient_api(row: Dict[str, Any]) -> Dict[str, Any]:
    patient_id = str(row.get("patientId", "")).strip()
    has_dnr = bool(row.get("hasDNR", False))
    height = row.get("height")
    weight = row.get("weight")
    bmi = row.get("bmi")
    if bmi in (None, "") and isinstance(height, (int, float)) and isinstance(weight, (int, float)) and height:
        bmi = round(float(weight) / ((float(height) / 100) ** 2), 1)
    return {
        "id": patient_id,
        "name": row.get("name") or "",
        "bedNumber": row.get("bedNumber") or "",
        "medicalRecordNumber": row.get("medicalRecordNumber") or patient_id,
        "age": int(row.get("age") or 0),
        "gender": row.get("gender") or "",
        "height": height,
        "weight": weight,
        "bmi": bmi,
        "diagnosis": row.get("diagnosis") or "",
        "symptoms": row.get("symptoms") if isinstance(row.get("symptoms"), list) else [],
        "intubated": bool(row.get("intubated", False)),
        "criticalStatus": row.get("criticalStatus") or "unknown",
        "sedation": row.get("sedation") if isinstance(row.get("sedation"), list) else [],
        "analgesia": row.get("analgesia") if isinstance(row.get("analgesia"), list) else [],
        "nmb": row.get("nmb") if isinstance(row.get("nmb"), list) else [],
        "admissionDate": row.get("admissionDate") or "",
        "icuAdmissionDate": row.get("icuAdmissionDate") or "",
        "ventilatorDays": int(row.get("ventilatorDays") or 0),
        "attendingPhysician": row.get("attendingPhysician") or "",
        "department": row.get("department") or "",
        "unit": row.get("unit") or row.get("department") or "",
        "alerts": row.get("alerts") or [],
        "consentStatus": row.get("consentStatus") or "unknown",
        "allergies": row.get("allergies") if isinstance(row.get("allergies"), list) else [],
        "bloodType": row.get("bloodType"),
        "codeStatus": row.get("codeStatus") or ("DNR" if has_dnr else "FULL"),
        "hasDNR": has_dnr,
        "isIsolated": bool(row.get("isIsolated", False)),
        "hasUnreadMessages": False,
        "lastUpdate": row.get("lastUpdate") or "",
    }


def _lab_row_to_api(row: Dict[str, Any]) -> Dict[str, Any]:
    patient_id = str(row.get("patientId", "")).strip()
    return {
        "id": f"lab_{patient_id}",
        "patientId": patient_id,
        "timestamp": row.get("timestamp") or "",
        "biochemistry": row.get("biochemistry") or {},
        "hematology": row.get("hematology") or {},
        "bloodGas": row.get("bloodGas") or {},
        "inflammatory": row.get("inflammatory") or {},
        "coagulation": row.get("coagulation") or {},
        "cardiac": row.get("cardiac") or {},
        "lipid": row.get("lipid") or {},
        "other": row.get("other") or {},
        "thyroid": row.get("thyroid") or {},
        "hormone": row.get("hormone") or {},
        "corrections": [],
    }


_log = logging.getLogger(__name__)

# ── FHIR Observation → Lab metric mapping ────────────────────────────
# Maps FHIR display names to (metric, category) matching layer2 schema.

_FHIR_METRIC_RULES: List[Dict[str, Any]] = [
    {"metric": "Na", "category": "biochemistry", "patterns": ["Sodium"], "exclude": ["Urine"]},
    {"metric": "K", "category": "biochemistry", "patterns": ["Potassium"], "exclude": ["Urine"]},
    {"metric": "Ca", "category": "biochemistry", "patterns": ["Calcium"], "exclude": ["Urine", "ionized"]},
    {"metric": "freeCa", "category": "biochemistry", "patterns": ["Calcium ionized"], "exclude": []},
    {"metric": "Mg", "category": "biochemistry", "patterns": ["Magnesium"], "exclude": ["Urine"]},
    {"metric": "WBC", "category": "hematology", "patterns": ["Leukocytes"], "exclude": []},
    {"metric": "RBC", "category": "hematology", "patterns": ["Erythrocytes"], "exclude": []},
    {"metric": "Hb", "category": "hematology", "patterns": ["Hemoglobin"], "exclude": ["A1c", "Urine"]},
    {"metric": "PLT", "category": "hematology", "patterns": ["Platelets"], "exclude": []},
    {"metric": "Alb", "category": "biochemistry", "patterns": ["Albumin"], "exclude": ["Urine", "ratio"]},
    {"metric": "CRP", "category": "inflammatory", "patterns": ["C reactive protein", "CRP"], "exclude": []},
    {"metric": "PCT", "category": "inflammatory", "patterns": ["Procalcitonin"], "exclude": []},
    {"metric": "pH", "category": "bloodGas", "patterns": ["pH (Venous blood)"], "exclude": ["Urine"]},
    {"metric": "PCO2", "category": "bloodGas", "patterns": ["pCO2 (Venous blood)", "pCO2 (Arterial blood)"], "exclude": []},
    {"metric": "PO2", "category": "bloodGas", "patterns": ["pO2 (Venous blood)", "pO2 (Arterial blood)"], "exclude": []},
    {"metric": "HCO3", "category": "bloodGas", "patterns": ["Bicarbonate (Venous blood)", "Bicarbonate"], "exclude": ["Standard"]},
    {"metric": "Lactate", "category": "bloodGas", "patterns": ["Lactate"], "exclude": []},
    {"metric": "AST", "category": "biochemistry", "patterns": ["AST"], "exclude": []},
    {"metric": "ALT", "category": "biochemistry", "patterns": ["ALT"], "exclude": []},
    {"metric": "TBil", "category": "biochemistry", "patterns": ["Total Bilirubin"], "exclude": ["direct"]},
    {"metric": "INR", "category": "coagulation", "patterns": ["INR"], "exclude": []},
    {"metric": "BUN", "category": "biochemistry", "patterns": ["BUN"], "exclude": []},
    {"metric": "Scr", "category": "biochemistry", "patterns": ["Creatinine"], "exclude": ["Urine"]},
    {"metric": "eGFR", "category": "biochemistry", "patterns": ["eGFR"], "exclude": []},
    {"metric": "TnT", "category": "cardiac", "patterns": ["Troponin T"], "exclude": []},
    {"metric": "CKMB", "category": "cardiac", "patterns": ["CK-MB", "CKMB"], "exclude": []},
    {"metric": "CK", "category": "cardiac", "patterns": ["Creatine kinase"], "exclude": ["MB"]},
    {"metric": "TCHO", "category": "lipid", "patterns": ["Cholesterol"], "exclude": ["LDL", "HDL"]},
    {"metric": "TG", "category": "lipid", "patterns": ["Triglyceride"], "exclude": []},
    {"metric": "LDLC", "category": "lipid", "patterns": ["LDL Cholesterol"], "exclude": []},
    {"metric": "HDLC", "category": "lipid", "patterns": ["HDL Cholesterol"], "exclude": []},
    {"metric": "UA", "category": "lipid", "patterns": ["Uric acid"], "exclude": []},
    {"metric": "P", "category": "lipid", "patterns": ["Phosphorus"], "exclude": ["Urine"]},
    {"metric": "HbA1C", "category": "other", "patterns": ["Hemoglobin A1c"], "exclude": []},
    {"metric": "TSH", "category": "thyroid", "patterns": ["TSH"], "exclude": []},
    {"metric": "freeT4", "category": "thyroid", "patterns": ["Free T4"], "exclude": []},
    {"metric": "Cortisol", "category": "hormone", "patterns": ["Cortisol"], "exclude": []},
]


def _match_fhir_metric(display_name: str) -> Optional[Tuple[str, str]]:
    """Match FHIR Observation display name to (metric, category)."""
    for rule in _FHIR_METRIC_RULES:
        for pattern in rule["patterns"]:
            if pattern.lower() in display_name.lower():
                if any(ex.lower() in display_name.lower() for ex in rule["exclude"]):
                    continue
                return (rule["metric"], rule["category"])
    return None


# Cache for parsed FHIR bundles (patient_id → observations list)
_fhir_obs_cache: Dict[str, List[Dict[str, Any]]] = {}

_FHIR_DIRS = [
    Path(__file__).resolve().parent.parent.parent.parent / "data" / "fhir-bundles",
    Path(__file__).resolve().parent.parent.parent.parent / "output" / "data_layers" / "layer1" / "batch_20260227_093722Z" / "raw" / "fhir-bundles",
]


def _load_fhir_observations(patient_id: str) -> List[Dict[str, Any]]:
    """Load and parse FHIR Observations for a patient.

    Returns list of {metric, category, value, unit, timestamp, referenceRange, isAbnormal}.
    """
    if patient_id in _fhir_obs_cache:
        return _fhir_obs_cache[patient_id]

    fhir_path = None
    for d in _FHIR_DIRS:
        candidate = d / f"FHIR_{patient_id}.json"
        if candidate.exists():
            fhir_path = candidate
            break

    if fhir_path is None:
        _fhir_obs_cache[patient_id] = []
        return []

    try:
        with open(fhir_path, "r", encoding="utf-8") as f:
            bundle = _json.load(f)
    except Exception as exc:
        _log.warning("Failed to load FHIR bundle for %s: %s", patient_id, exc)
        _fhir_obs_cache[patient_id] = []
        return []

    results: List[Dict[str, Any]] = []
    for entry in bundle.get("entry", []):
        resource = entry.get("resource", {})
        if resource.get("resourceType") != "Observation":
            continue

        # Get display name
        codes = resource.get("code", {}).get("coding", [])
        display = codes[0].get("display", "") if codes else ""
        if not display:
            display = resource.get("code", {}).get("text", "")
        if not display:
            continue

        # Match to our metric
        match = _match_fhir_metric(display)
        if not match:
            continue
        metric, category = match

        # Get numeric value
        vq = resource.get("valueQuantity", {})
        value = vq.get("value")
        if value is None:
            continue
        try:
            value = float(value)
        except (ValueError, TypeError):
            continue

        unit = vq.get("unit", "")

        # Get timestamp
        timestamp = (
            resource.get("effectiveDateTime", "")
            or resource.get("issued", "")
            or ""
        )
        if not timestamp:
            continue

        # Get reference range
        ref_ranges = resource.get("referenceRange", [])
        ref_str = ""
        if ref_ranges:
            rr = ref_ranges[0]
            low = rr.get("low", {}).get("value")
            high = rr.get("high", {}).get("value")
            rr_unit = rr.get("low", {}).get("unit", "") or rr.get("high", {}).get("unit", "") or unit
            if low is not None and high is not None:
                ref_str = f"{low}-{high} {rr_unit}"

        # Determine abnormality
        is_abnormal = False
        interp = resource.get("interpretation", [])
        if interp:
            interp_text = str(interp[0].get("text", "")).upper()
            if interp_text in ("H", "HH", "L", "LL", "A"):
                is_abnormal = True
        elif ref_ranges:
            rr = ref_ranges[0]
            low = rr.get("low", {}).get("value")
            high = rr.get("high", {}).get("value")
            if low is not None and value < low:
                is_abnormal = True
            if high is not None and value > high:
                is_abnormal = True

        results.append({
            "metric": metric,
            "category": category,
            "value": value,
            "unit": unit,
            "timestamp": timestamp,
            "referenceRange": ref_str,
            "isAbnormal": is_abnormal,
        })

    # Sort by timestamp descending
    results.sort(key=lambda x: x["timestamp"], reverse=True)
    _fhir_obs_cache[patient_id] = results
    _log.info("Loaded %d FHIR observations for patient %s", len(results), patient_id)
    return results


def _build_lab_trends(patient_id: str, days: int) -> List[Dict[str, Any]]:
    """Build multiple LabData snapshots from FHIR Observations.

    Groups observations by date, returns one snapshot per date (up to `days` most recent).
    Each snapshot follows the same schema as lab-data/latest.
    """
    observations = _load_fhir_observations(patient_id)
    if not observations:
        return []

    # Group by date (YYYY-MM-DD)
    by_date: Dict[str, Dict[str, Dict[str, Any]]] = {}  # date → metric → best_obs
    for obs in observations:
        date_key = obs["timestamp"][:10]
        if date_key not in by_date:
            by_date[date_key] = {}
        metric = obs["metric"]
        # Keep latest observation per metric per date
        existing = by_date[date_key].get(metric)
        if existing is None or obs["timestamp"] > existing["timestamp"]:
            by_date[date_key][metric] = obs

    # Sort dates descending, take the most recent N
    sorted_dates = sorted(by_date.keys(), reverse=True)[:days]
    sorted_dates.reverse()  # chronological order for chart

    snapshots: List[Dict[str, Any]] = []
    for date_key in sorted_dates:
        metrics = by_date[date_key]
        categories: Dict[str, Dict[str, Any]] = {
            "biochemistry": {}, "hematology": {}, "bloodGas": {},
            "inflammatory": {}, "coagulation": {}, "cardiac": {},
            "lipid": {}, "other": {}, "thyroid": {}, "hormone": {},
        }
        for metric, obs in metrics.items():
            cat = obs["category"]
            if cat in categories:
                categories[cat][metric] = {
                    "value": obs["value"],
                    "unit": obs["unit"],
                    "referenceRange": obs["referenceRange"],
                    "isAbnormal": obs["isAbnormal"],
                }

        snapshot = {
            "id": f"trend-{patient_id}-{date_key}",
            "patientId": patient_id,
            "timestamp": date_key,
            **categories,
        }
        snapshots.append(snapshot)

    return snapshots


def _normalize_san_key(value: Any) -> str:
    if not isinstance(value, str):
        return "other"
    normalized = value.strip().upper()
    if normalized == "S":
        return "sedation"
    if normalized == "A":
        return "analgesia"
    if normalized == "N":
        return "nmb"
    return "other"


def _normalize_status(value: Any) -> str:
    if not isinstance(value, str):
        return "active"
    raw = value.strip().lower()
    if raw in {"active", "completed", "on-hold"}:
        return raw
    if raw in {"discontinued", "stopped"}:
        return "discontinued"
    return "active"


def _is_medication_current(row: Dict[str, Any]) -> bool:
    """Determine if a medication is likely still in use.

    Logic:
    - endDate exists and < today → expired → False
    - endDate exists and >= today → still valid → True
    - No endDate + frequency=STAT → single-dose already administered → False
    - No endDate + frequency≠STAT → likely still in use → True
    """
    end_date_str = row.get("endDate")
    freq = (row.get("frequencyNormalized") or row.get("frequency") or "").strip().upper()

    if end_date_str:
        try:
            end_dt = datetime.fromisoformat(str(end_date_str).replace("Z", ""))
            if end_dt < datetime.now():
                return False  # expired
        except (ValueError, TypeError):
            pass  # unparseable → keep
        return True
    # No endDate
    if freq == "STAT":
        return False  # single-dose already completed
    return True  # ongoing prescription


def _normalize_medications_payload(payload: Dict[str, Any], status_filter: Optional[str]) -> Dict[str, Any]:
    meds_raw = payload.get("medications")
    rows = meds_raw if isinstance(meds_raw, list) else []
    medications: List[Dict[str, Any]] = []
    grouped = {"sedation": [], "analgesia": [], "nmb": [], "other": []}

    # Deduplicate by drug name — keep the most recent startDate per name
    by_name: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue
        status = _normalize_status(row.get("status"))
        if status_filter and status_filter != "all" and status != status_filter:
            continue

        # Filter out expired / single-dose completed medications
        if not _is_medication_current(row):
            continue

        name = (row.get("name") or "").strip()
        if not name:
            continue

        # Dedup: keep most recent startDate per drug name
        existing = by_name.get(name)
        if existing is not None:
            if (row.get("startDate") or "") <= (existing.get("startDate") or ""):
                continue  # older prescription, skip

        medication = {
            "id": row.get("id") or "",
            "patientId": row.get("patientId") or payload.get("patientId") or "",
            "name": name,
            "genericName": row.get("genericName") or "",
            "orderCode": row.get("orderCode"),
            "orderCodeDisplay": row.get("orderCodeDisplay"),
            "atcCode": row.get("atcCode"),
            "atcDisplay": row.get("atcDisplay"),
            "atcSource": row.get("atcSource"),
            "atcMappingVersion": row.get("atcMappingVersion"),
            "category": row.get("category") or "other",
            "categoryNormalized": row.get("categoryNormalized"),
            "sanCategory": row.get("sanCategory") if isinstance(row.get("sanCategory"), str) else None,
            "route": row.get("route") or "",
            "routeNormalized": row.get("routeNormalized"),
            "dose": str(row.get("dose") or ""),
            "unit": row.get("unit") or "",
            "concentration": str(row.get("concentration") or "") or None,
            "concentrationUnit": row.get("concentrationUnit") or None,
            "frequency": row.get("frequency") or "",
            "frequencyNormalized": row.get("frequencyNormalized"),
            "startDate": row.get("startDate") or "",
            "endDate": row.get("endDate"),
            "status": status,
            "prescribedBy": row.get("prescribedBy") or {"id": "", "name": ""},
            "prn": bool(row.get("prn", False)),
            "indication": row.get("indication"),
            "warnings": row.get("warnings") if isinstance(row.get("warnings"), list) else [],
            "isStandardized": bool(row.get("isStandardized", False)),
            "standardizationScore": row.get("standardizationScore"),
            "standardizationIssues": row.get("standardizationIssues") if isinstance(row.get("standardizationIssues"), list) else [],
        }
        by_name[name] = medication

    for medication in by_name.values():
        medications.append(medication)
        grouped[_normalize_san_key(medication.get("sanCategory"))].append(medication)

    medications.sort(key=lambda m: ((m.get("name") or "").lower(), m.get("id") or ""))
    return {"medications": medications, "grouped": grouped, "interactions": []}


@router.get("/meta")
async def get_layer2_meta(
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    return success_response(data=layer2_store.get_meta())


@router.get("")
async def list_patients(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    intubated: Optional[bool] = Query(default=None),
    criticalStatus: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    rows = layer2_store.list_patients()

    patients = [_profile_to_patient_api(row) for row in rows]

    if intubated is not None:
        patients = [p for p in patients if bool(p.get("intubated")) == intubated]
    if criticalStatus:
        target = criticalStatus.strip().lower()
        patients = [p for p in patients if str(p.get("criticalStatus", "")).lower() == target]
    if department:
        keyword = department.strip().lower()
        patients = [p for p in patients if keyword in str(p.get("department", "")).lower()]
    if search:
        keyword = search.strip().lower()
        patients = [
            p for p in patients
            if keyword in str(p.get("name", "")).lower()
            or keyword in str(p.get("medicalRecordNumber", "")).lower()
            or keyword in str(p.get("id", "")).lower()
        ]

    patients.sort(key=lambda p: (str(p.get("medicalRecordNumber", "")).lower(), str(p.get("id", "")).lower()))
    total = len(patients)
    offset = (page - 1) * limit
    paged = patients[offset: offset + limit]

    return success_response(
        data={
            "patients": paged,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if total else 0,
            },
        }
    )


@router.get("/{patient_id}")
async def get_patient(
    patient_id: str,
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    row = layer2_store.get_patient(patient_id.strip())
    if row is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return success_response(data=_profile_to_patient_api(row))


@router.get("/{patient_id}/lab-data/latest")
async def get_latest_lab_data(
    patient_id: str,
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    row = layer2_store.get_lab_latest(patient_id.strip())
    if row is None:
        return success_response(data=None, message="No lab data found")
    return success_response(data=_lab_row_to_api(row))


@router.get("/{patient_id}/lab-data/trends")
async def get_lab_trends(
    patient_id: str,
    days: int = Query(7, ge=1, le=90),
    items: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
):
    del items
    del user
    _load_or_503()
    pid = patient_id.strip()
    trends = _build_lab_trends(pid, days)
    if not trends:
        # Fallback: return the single latest snapshot
        row = layer2_store.get_lab_latest(pid)
        if row is not None:
            trends = [_lab_row_to_api(row)]
    return success_response(data={"trends": trends, "days": days})


@router.get("/{patient_id}/cultures")
async def get_culture_susceptibility(
    patient_id: str,
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    row = layer2_store.get_culture_susceptibility(patient_id.strip())
    if row is None:
        return success_response(data={"patientId": patient_id, "cultureCount": 0, "cultures": []})
    return success_response(data=row)


@router.get("/{patient_id}/medications")
async def list_medications(
    patient_id: str,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    row = layer2_store.get_medications_current(patient_id.strip())
    if row is None:
        return success_response(
            data={"medications": [], "grouped": {"sedation": [], "analgesia": [], "nmb": [], "other": []}, "interactions": []}
        )
    return success_response(data=_normalize_medications_payload(row, status_filter))


@router.get("/{patient_id}/medications/{medication_id}")
async def get_medication(
    patient_id: str,
    medication_id: str,
    user: User = Depends(get_current_user),
):
    del user
    _load_or_503()
    row = layer2_store.get_medications_current(patient_id.strip())
    if row is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    payload = _normalize_medications_payload(row, status_filter=None)
    for medication in payload["medications"]:
        if medication.get("id") == medication_id:
            return success_response(data=medication)
    raise HTTPException(status_code=404, detail="Medication not found")


@router.patch("/{patient_id}/medications/{medication_id}")
async def update_medication(
    patient_id: str,
    medication_id: str,
    body: MedicationUpdate,
    request: Request,
    user: User = Depends(require_roles("doctor", "pharmacist")),
    db: AsyncSession = Depends(get_db),
):
    _load_or_503()
    pid = patient_id.strip()
    row = layer2_store.get_medications_current(pid)
    if row is None:
        raise HTTPException(status_code=404, detail="Medication not found")

    payload = _normalize_medications_payload(row, status_filter=None)
    current = next((med for med in payload["medications"] if med.get("id") == medication_id), None)
    if current is None:
        raise HTTPException(status_code=404, detail="Medication not found")

    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return success_response(data=current, message="無變更")

    normalized_updates: Dict[str, Any] = {}
    for field_name, value in update_data.items():
        if field_name == "sanCategory":
            normalized_updates[field_name] = normalize_san_category(value)
            continue
        if isinstance(value, str):
            value = value.strip()
            if field_name in {
                "dose",
                "unit",
                "concentration",
                "concentrationUnit",
                "frequency",
                "route",
                "indication",
            } and value == "":
                value = None
        normalized_updates[field_name] = value

    updated_medication = layer2_store.update_medication_current(pid, medication_id, normalized_updates)
    if updated_medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")

    patient_obj = await db.get(Patient, pid)
    db_medication = await db.get(Medication, medication_id)
    if db_medication and db_medication.patient_id == pid:
        field_map = {
            "sanCategory": "san_category",
            "endDate": "end_date",
            "concentrationUnit": "concentration_unit",
        }
        for field_name, value in normalized_updates.items():
            mapped_field = field_map.get(field_name, field_name)
            setattr(db_medication, mapped_field, value)
    elif patient_obj is not None:
        db_payload = _normalize_medications_payload(
            {"patientId": pid, "medications": [updated_medication]},
            status_filter=None,
        )["medications"][0]
        db_medication = Medication(
            id=db_payload["id"],
            patient_id=pid,
            name=db_payload["name"],
            generic_name=db_payload.get("genericName"),
            order_code=db_payload.get("orderCode"),
            category=db_payload.get("category"),
            san_category=normalize_san_category(db_payload.get("sanCategory")),
            dose=db_payload.get("dose"),
            unit=db_payload.get("unit"),
            concentration=db_payload.get("concentration"),
            concentration_unit=db_payload.get("concentrationUnit"),
            frequency=db_payload.get("frequency"),
            route=db_payload.get("route"),
            prn=bool(db_payload.get("prn", False)),
            indication=db_payload.get("indication"),
            start_date=datetime.fromisoformat(db_payload["startDate"]).date() if db_payload.get("startDate") else None,
            end_date=datetime.fromisoformat(db_payload["endDate"]).date() if db_payload.get("endDate") else None,
            status=db_payload.get("status") or "active",
            prescribed_by=db_payload.get("prescribedBy"),
            warnings=db_payload.get("warnings") or [],
        )
        db.add(db_medication)

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="更新藥物",
        target=medication_id,
        status="success",
        ip=request.client.host if request.client else None,
        details={"fields_changed": list(normalized_updates.keys()), "source": "patients-v2"},
    )

    refreshed_row = layer2_store.get_medications_current(pid) or {"patientId": pid, "medications": []}
    refreshed_payload = _normalize_medications_payload(refreshed_row, status_filter=None)
    refreshed_medication = next(
        (med for med in refreshed_payload["medications"] if med.get("id") == medication_id),
        None,
    )
    if refreshed_medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    return success_response(data=refreshed_medication, message="藥物已更新")


@router.get("/{patient_id}/medications/{medication_id}/administrations")
async def list_medication_administrations(
    patient_id: str,
    medication_id: str,
    startDate: Optional[str] = Query(default=None),
    endDate: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
):
    del patient_id
    del medication_id
    del startDate
    del endDate
    del user
    _load_or_503()
    return success_response(data=[])


@router.post("")
async def create_patient(
    request: Request,
    body: PatientCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await create_patient_v1(request=request, body=body, user=user, db=db)


@router.patch("/{patient_id}")
async def update_patient(
    patient_id: str,
    body: PatientUpdate,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor", "nurse")),
    db: AsyncSession = Depends(get_db),
):
    return await update_patient_v1(
        patient_id=patient_id,
        body=body,
        request=request,
        user=user,
        db=db,
    )


@router.patch("/{patient_id}/archive")
async def archive_patient(
    patient_id: str,
    request: Request,
    body: Optional[PatientArchiveUpdate] = None,
    user: User = Depends(require_roles("admin", "doctor")),
    db: AsyncSession = Depends(get_db),
):
    return await archive_patient_v1(
        patient_id=patient_id,
        request=request,
        body=body,
        user=user,
        db=db,
    )


@router.patch("/{patient_id}/lab-data/{lab_data_id}/correct")
async def correct_lab_data(
    patient_id: str,
    lab_data_id: str,
    body: LabCorrectionRequest,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor")),
    db: AsyncSession = Depends(get_db),
):
    return await correct_lab_data_v1(
        patient_id=patient_id,
        lab_data_id=lab_data_id,
        body=body,
        request=request,
        user=user,
        db=db,
    )


@router.patch("/{patient_id}/medications/{medication_id}/administrations/{administration_id}")
async def record_medication_administration(
    patient_id: str,
    medication_id: str,
    administration_id: str,
    body: MedicationAdministrationUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await record_medication_administration_v1(
        patient_id=patient_id,
        medication_id=medication_id,
        administration_id=administration_id,
        body=body,
        request=request,
        user=user,
        db=db,
    )
