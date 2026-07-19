"""B2 batch 3: med_to_dict golden parity.

med_to_dict is the most widely consumed serializer (patients page, meds
tab, clinical snapshot, pharmacy pages). This golden test freezes the
exact payload of the pre-migration hand-rolled dict so the CamelModel
swap — and any future schema edit — cannot silently change the contract.
"""
from __future__ import annotations

from datetime import date

from app.models.medication import Medication
from app.routers.medications import med_to_dict


def _full_med() -> Medication:
    return Medication(
        id="med_001", patient_id="pat_001", name="Vancomycin",
        generic_name="vancomycin", order_code="VAN01", category="抗生素",
        san_category=" s ", dose="1000", unit="mg", frequency="q12h",
        route="IV", prn=False, indication="MRSA pneumonia",
        start_date=date(2026, 7, 1), end_date=None, status="active",
        prescribed_by={"id": "usr_002", "name": "李穎灝"},
        warnings=["腎功能監測"], notes="trough 目標 15-20",
        concentration="5", concentration_unit="mg/ml",
        source_type=None, source_campus="仁愛", prescribing_hospital=None,
        prescribing_department=None, prescribing_doctor_name=None,
        days_supply=7, is_external=None, atc_code="J01XA01",
        is_antibiotic=True, kidney_relevant=True, coding_source="rxnorm",
    )


GOLDEN = {
    "id": "med_001", "patientId": "pat_001", "name": "Vancomycin",
    "genericName": "vancomycin", "orderCode": "VAN01", "category": "抗生素",
    "sanCategory": "S",             # normalize:strip+upper
    "dose": "1000", "unit": "mg", "frequency": "q12h", "route": "IV",
    "prn": False, "indication": "MRSA pneumonia",
    "startDate": "2026-07-01", "endDate": None, "status": "active",
    "prescribedBy": {"id": "usr_002", "name": "李穎灝"},
    "warnings": ["腎功能監測"], "notes": "trough 目標 15-20",
    "concentration": "5", "concentrationUnit": "mg/ml",
    "sourceType": "inpatient",      # None → 預設
    "sourceCampus": "仁愛", "prescribingHospital": None,
    "prescribingDepartment": None, "prescribingDoctorName": None,
    "daysSupply": 7, "isExternal": False,  # None → False
    "atcCode": "J01XA01", "isAntibiotic": True,
    "kidneyRelevant": True, "codingSource": "rxnorm",
}


def test_med_to_dict_golden_parity():
    assert med_to_dict(_full_med()) == GOLDEN


def test_med_to_dict_invalid_san_category_dropped():
    med = _full_med()
    med.san_category = "X"
    assert med_to_dict(med)["sanCategory"] is None


def test_med_to_dict_none_warnings_becomes_empty_list():
    med = _full_med()
    med.warnings = None
    assert med_to_dict(med)["warnings"] == []
