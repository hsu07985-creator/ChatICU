"""Build FHIR R5 Bundle from ChatICU DB rows (PR-5).

Reads medications + lab_data + patient directly from Postgres and produces a
FHIR Bundle (type=collection) with Patient + MedicationRequest + Observation
resources. The ATC codes we populated in PR-1/PR-3.5 are the backbone of the
MedicationRequest.medicationCodeableConcept.coding entries.

Generated on demand — NOT cached. Use GET /patients/{id}/fhir-bundle.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

ATC_SYSTEM = "http://www.whocc.no/atc"
LOINC_SYSTEM = "http://loinc.org"
HIS_ODR_SYSTEM = "http://hospital.local/odr-code"
HIS_LAB_SYSTEM = "http://hospital.local/lab-code"
UCUM_SYSTEM = "http://unitsofmeasure.org"
OBS_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category"
BUNDLE_VERSION = "0.1.0"


def _patient_ref(patient_id: str) -> dict[str, str]:
    return {"reference": f"Patient/{patient_id}"}


def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return str(v)


async def _fetch_patient(session: AsyncSession, patient_id: str) -> Optional[dict[str, Any]]:
    r = await session.execute(
        text(
            "SELECT id, name, medical_record_number, age, gender, date_of_birth, "
            "diagnosis, attending_physician, department, blood_type "
            "FROM patients WHERE id = :id"
        ),
        {"id": patient_id},
    )
    row = r.mappings().first()
    return dict(row) if row else None


async def _fetch_medications(session: AsyncSession, patient_id: str) -> list[dict[str, Any]]:
    r = await session.execute(
        text(
            "SELECT id, name, generic_name, order_code, atc_code, dose, unit, "
            "frequency, route, prn, start_date, end_date, status, is_antibiotic, "
            "kidney_relevant, coding_source "
            "FROM medications WHERE patient_id = :pid "
            "ORDER BY start_date DESC NULLS LAST, name"
        ),
        {"pid": patient_id},
    )
    return [dict(row) for row in r.mappings()]


async def _fetch_lab_data(session: AsyncSession, patient_id: str, limit: int = 50) -> list[dict[str, Any]]:
    r = await session.execute(
        text(
            "SELECT id, timestamp, biochemistry, hematology, blood_gas, "
            "inflammatory, coagulation "
            "FROM lab_data WHERE patient_id = :pid "
            "ORDER BY timestamp DESC LIMIT :limit"
        ),
        {"pid": patient_id, "limit": limit},
    )
    return [dict(row) for row in r.mappings()]


def _build_patient_resource(p: dict[str, Any]) -> dict[str, Any]:
    gender_map = {"M": "male", "F": "female", "男": "male", "女": "female"}
    res: dict[str, Any] = {
        "resourceType": "Patient",
        "id": p["id"],
        "identifier": [
            {
                "system": "http://hospital.local/mrn",
                "value": p["medical_record_number"],
            }
        ],
        "name": [{"text": p["name"]}],
        "gender": gender_map.get(p.get("gender"), "unknown"),
    }
    if p.get("date_of_birth"):
        res["birthDate"] = _iso(p["date_of_birth"])
    return res


def _build_medication_resource(m: dict[str, Any], patient_id: str) -> dict[str, Any]:
    codings: list[dict[str, Any]] = []
    if m.get("atc_code"):
        codings.append(
            {
                "system": ATC_SYSTEM,
                "code": m["atc_code"],
                "display": m.get("generic_name") or m.get("name"),
            }
        )
    if m.get("order_code"):
        codings.append(
            {
                "system": HIS_ODR_SYSTEM,
                "code": m["order_code"],
                "display": m.get("name"),
            }
        )

    med_cc: dict[str, Any] = {"text": m.get("name", "")}
    if codings:
        med_cc["coding"] = codings

    status_map = {
        "active": "active",
        "inactive": "unknown",
        "discontinued": "stopped",
        "completed": "completed",
        "on-hold": "on-hold",
    }

    res: dict[str, Any] = {
        "resourceType": "MedicationRequest",
        "id": m["id"],
        "status": status_map.get(m.get("status"), "unknown"),
        "intent": "order",
        "subject": _patient_ref(patient_id),
        "medicationCodeableConcept": med_cc,
    }

    # dosageInstruction
    di: dict[str, Any] = {}
    if m.get("frequency"):
        di["timing"] = {
            "code": {
                "coding": [
                    {
                        "system": HIS_ODR_SYSTEM + "/freq",
                        "code": m["frequency"],
                        "display": m["frequency"],
                    }
                ]
            }
        }
    if m.get("route"):
        di["route"] = {
            "coding": [
                {
                    "system": HIS_ODR_SYSTEM + "/route",
                    "code": m["route"],
                    "display": m["route"],
                }
            ]
        }
    dose_value = m.get("dose")
    if dose_value is not None and str(dose_value).strip():
        try:
            val = float(str(dose_value).strip())
        except (ValueError, TypeError):
            val = None
        if val is not None:
            di["doseAndRate"] = [
                {
                    "doseQuantity": {
                        "value": val,
                        "unit": m.get("unit") or "",
                    }
                }
            ]
    if m.get("start_date") or m.get("end_date"):
        period: dict[str, str] = {}
        if m.get("start_date"):
            period["start"] = _iso(m["start_date"])
        if m.get("end_date"):
            period["end"] = _iso(m["end_date"])
        di.setdefault("timing", {}).setdefault("repeat", {})["boundsPeriod"] = period
    if di:
        res["dosageInstruction"] = [di]

    if m.get("prn"):
        res.setdefault("dosageInstruction", [{}])[0]["asNeededBoolean"] = True

    extensions = []
    if m.get("is_antibiotic"):
        extensions.append(
            {
                "url": "http://hospital.local/StructureDefinition/is-antibiotic",
                "valueBoolean": True,
            }
        )
    if m.get("kidney_relevant") is not None:
        extensions.append(
            {
                "url": "http://hospital.local/StructureDefinition/kidney-relevant",
                "valueBoolean": bool(m["kidney_relevant"]),
            }
        )
    if m.get("coding_source"):
        extensions.append(
            {
                "url": "http://hospital.local/StructureDefinition/coding-source",
                "valueString": m["coding_source"],
            }
        )
    if extensions:
        res["extension"] = extensions

    return res


def _build_observations_from_lab_data(
    lab_rows: list[dict[str, Any]], patient_id: str
) -> list[dict[str, Any]]:
    """Flatten JSONB lab columns into Observation resources, one per (row × key)."""
    from app.fhir.loinc_map import LOINC_MAP

    observations: list[dict[str, Any]] = []
    for row in lab_rows:
        ts = _iso(row.get("timestamp"))
        for column in ("biochemistry", "hematology", "blood_gas", "inflammatory", "coagulation"):
            data = row.get(column)
            if not data or not isinstance(data, dict):
                continue
            for key, value in data.items():
                if value is None:
                    continue
                obs_id = f"{row['id']}-{key}"
                coding: list[dict[str, Any]] = []
                if key in LOINC_MAP:
                    loinc_code, loinc_display, _cat = LOINC_MAP[key]
                    coding.append(
                        {"system": LOINC_SYSTEM, "code": loinc_code, "display": loinc_display}
                    )
                coding.append(
                    {"system": HIS_LAB_SYSTEM, "code": key, "display": key}
                )
                obs: dict[str, Any] = {
                    "resourceType": "Observation",
                    "id": obs_id,
                    "status": "final",
                    "category": [
                        {
                            "coding": [
                                {"system": OBS_CATEGORY_SYSTEM, "code": "laboratory"}
                            ]
                        }
                    ],
                    "code": {"coding": coding, "text": key},
                    "subject": _patient_ref(patient_id),
                }
                if ts:
                    obs["effectiveDateTime"] = ts

                try:
                    numeric = float(value) if not isinstance(value, dict) else None
                    obs["valueQuantity"] = {"value": numeric, "unit": ""}
                except (ValueError, TypeError):
                    obs["valueString"] = str(value)
                observations.append(obs)
    return observations


def _compute_coverage(medications: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(medications)
    with_atc = sum(1 for m in medications if m.get("atc_code"))
    return {
        "medications_total": total,
        "medications_with_atc": with_atc,
        "medications_coverage_pct": round(100 * with_atc / total, 1) if total else 0,
    }


async def build_bundle_for_patient(
    session: AsyncSession, patient_id: str, *, lab_limit: int = 50
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build FHIR R5 Bundle + conversion report for a single patient."""
    patient = await _fetch_patient(session, patient_id)
    if not patient:
        raise ValueError(f"Patient {patient_id} not found")

    medications = await _fetch_medications(session, patient_id)
    lab_rows = await _fetch_lab_data(session, patient_id, limit=lab_limit)

    patient_res = _build_patient_resource(patient)
    med_resources = [_build_medication_resource(m, patient_id) for m in medications]
    obs_resources = _build_observations_from_lab_data(lab_rows, patient_id)

    all_resources = [patient_res, *med_resources, *obs_resources]
    now_iso = datetime.now(timezone.utc).isoformat()

    bundle: dict[str, Any] = {
        "resourceType": "Bundle",
        "id": f"{patient_id}-{int(datetime.now(timezone.utc).timestamp())}",
        "type": "collection",
        "timestamp": now_iso,
        "meta": {
            "source": f"ChatICU DB snapshot for {patient_id}",
            "versionId": BUNDLE_VERSION,
        },
        "entry": [
            {"fullUrl": f"urn:uuid:{r['resourceType'].lower()}-{r['id']}", "resource": r}
            for r in all_resources
        ],
    }

    report: dict[str, Any] = {
        "patient_id": patient_id,
        "generated_at": now_iso,
        "bundle_version": BUNDLE_VERSION,
        "resource_counts": {
            "Patient": 1,
            "MedicationRequest": len(med_resources),
            "Observation": len(obs_resources),
        },
        "total_resources": len(all_resources),
        "coverage": _compute_coverage(medications),
    }

    return bundle, report
