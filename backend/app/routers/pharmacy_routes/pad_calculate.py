"""PAD ICU Drug Dosing Calculator — deterministic, no external API needed.

Implements weight-adjusted infusion rate calculation for 9 PAD drugs.
Based on: 陽明院區 PAD guideline (Devine formula, IBW/AdjBW obesity adjustment).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter()

# ── Drug reference data ──────────────────────────────────────────────────

DRUG_WEIGHT_BASIS = {
    "cisatracurium": "IBW",
    "rocuronium": "IBW",
    "morphine": "IBW",
    "fentanyl": "AdjBW",
    "dexmedetomidine": "AdjBW",
    "propofol": "AdjBW",
    "midazolam": "AdjBW",
    "lorazepam": "AdjBW",
    "haloperidol": "fixed",
}

# Default concentration (from PAD guideline formulation)
PAD_DRUG_DEFAULTS = {
    "cisatracurium": {
        "label": "Cisatracurium",
        "concentration": 2.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.03–0.6",
        "weight_basis": "IBW",
    },
    "rocuronium": {
        "label": "Rocuronium",
        "concentration": 2.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.18–0.96",
        "weight_basis": "IBW",
    },
    "fentanyl": {
        "label": "Fentanyl",
        "concentration": 10.0,
        "concentration_unit": "mcg/ml",
        "dose_unit": "mcg/kg/hr",
        "dose_range": "0.7–10",
        "weight_basis": "AdjBW",
    },
    "morphine": {
        "label": "Morphine",
        "concentration": 1.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.07–0.5",
        "weight_basis": "IBW",
    },
    "dexmedetomidine": {
        "label": "Dexmedetomidine",
        "concentration": 4.0,
        "concentration_unit": "mcg/ml",
        "dose_unit": "mcg/kg/hr",
        "dose_range": "0.2–1.5",
        "weight_basis": "AdjBW",
    },
    "propofol": {
        "label": "Propofol",
        "concentration": 10.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.3–3",
        "weight_basis": "AdjBW",
    },
    "midazolam": {
        "label": "Midazolam",
        "concentration": 1.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.01–0.2",
        "weight_basis": "AdjBW",
        "concentration_range": [1.0, 5.0],
    },
    "lorazepam": {
        "label": "Lorazepam",
        "concentration": 1.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "mg/kg/hr",
        "dose_range": "0.01–0.1",
        "weight_basis": "AdjBW",
    },
    "haloperidol": {
        "label": "Haloperidol",
        "concentration": 5.0,
        "concentration_unit": "mg/ml",
        "dose_unit": "",
        "dose_range": "0.5–20 mg bolus",
        "weight_basis": "fixed",
    },
}


# ── Request / Response models ────────────────────────────────────────────

class PadCalculateRequest(BaseModel):
    drug: str = Field(..., description="藥物名稱（9 種 PAD 藥物之一）")
    weight_kg: float = Field(..., gt=0, description="體重 (kg)")
    target_dose_per_kg_hr: float = Field(..., ge=0, description="目標劑量 (per kg per hr)")
    concentration: float = Field(..., gt=0, description="藥物濃度")
    sex: Optional[str] = Field(None, description="性別 (male/female)")
    height_cm: Optional[float] = Field(None, gt=0, description="身高 (cm)")


class PadCalculateResponse(BaseModel):
    drug: str
    BMI: Optional[float] = None
    IBW_kg: Optional[float] = None
    AdjBW_kg: Optional[float] = None
    pct_IBW: Optional[float] = None
    is_obese: Optional[bool] = None
    weight_basis: str = "TBW"
    dosing_weight_kg: float
    dose_per_hr: float
    rate_ml_hr: float
    concentration: str
    note: Optional[str] = None
    steps: list = Field(default_factory=list)


# ── Calculation logic (from structured.py) ───────────────────────────────

def _calculate_weight(sex: str, height_cm: float, TBW_kg: float) -> dict:
    """Devine formula for IBW + AdjBW."""
    height_in = height_cm / 2.54
    if sex == "male":
        IBW = max(50 + 2.3 * (height_in - 60), 50.0)
    else:
        IBW = max(45.5 + 2.3 * (height_in - 60), 45.5)

    pct_IBW = TBW_kg / IBW * 100
    BMI = TBW_kg / (height_cm / 100) ** 2
    AdjBW = IBW + 0.4 * (TBW_kg - IBW)

    return {
        "IBW_kg": round(IBW, 1),
        "AdjBW_kg": round(AdjBW, 1),
        "pct_IBW": round(pct_IBW, 1),
        "BMI": round(BMI, 1),
        "is_obese": pct_IBW > 120,
    }


def _normalize_pad_sex(sex: Optional[str]) -> Optional[str]:
    if not sex:
        return None
    raw = str(sex).strip().lower()
    if raw in {"m", "male", "男"}:
        return "male"
    if raw in {"f", "female", "女"}:
        return "female"
    return None


def _pad_calculate(req: PadCalculateRequest) -> PadCalculateResponse:
    drug_lower = req.drug.lower().strip()
    defaults = PAD_DRUG_DEFAULTS.get(drug_lower)
    if not defaults:
        return PadCalculateResponse(
            drug=drug_lower,
            dosing_weight_kg=req.weight_kg,
            dose_per_hr=0,
            rate_ml_hr=0,
            concentration=str(req.concentration),
            note=f"不支援的藥物：{req.drug}。支援：{', '.join(PAD_DRUG_DEFAULTS.keys())}",
        )

    # Fixed-dose drugs
    if DRUG_WEIGHT_BASIS.get(drug_lower) == "fixed":
        return PadCalculateResponse(
            drug=drug_lower,
            dosing_weight_kg=req.weight_kg,
            dose_per_hr=0,
            rate_ml_hr=0,
            concentration=f"{req.concentration} {defaults['concentration_unit']}",
            note="固定劑量藥物（非體重依賴），請依臨床反應滴定。建議劑量：0.5–20 mg IV bolus。",
            steps=["Haloperidol 為固定劑量藥物，不需要 weight-based 計算。"],
        )

    steps = []
    weight_info = {}
    dosing_weight = req.weight_kg
    weight_basis = "TBW"
    normalized_sex = _normalize_pad_sex(req.sex)

    steps.append(f"實際體重 (TBW) = {req.weight_kg} kg")

    if normalized_sex and req.height_cm:
        weight_info = _calculate_weight(normalized_sex, req.height_cm, req.weight_kg)
        steps.append(
            f"IBW (Devine) = {weight_info['IBW_kg']} kg, "
            f"AdjBW = {weight_info['AdjBW_kg']} kg, "
            f"%IBW = {weight_info['pct_IBW']}%, "
            f"BMI = {weight_info['BMI']}"
        )

        if weight_info["is_obese"] and req.weight_kg > weight_info["IBW_kg"]:
            basis = DRUG_WEIGHT_BASIS.get(drug_lower, "TBW")
            if basis == "IBW":
                dosing_weight = weight_info["IBW_kg"]
                weight_basis = "IBW (肥胖調整)"
                steps.append(f"肥胖 (%IBW > 120%)，{drug_lower} 使用 IBW = {dosing_weight} kg")
            elif basis == "AdjBW":
                dosing_weight = weight_info["AdjBW_kg"]
                weight_basis = "AdjBW (肥胖調整)"
                steps.append(f"肥胖 (%IBW > 120%)，{drug_lower} 使用 AdjBW = {dosing_weight} kg")
        elif weight_info["pct_IBW"] < 90:
            weight_basis = "TBW (體重偏低)"
            steps.append(f"體重偏低 (%IBW={weight_info['pct_IBW']}% < 90%)，使用實際體重 (TBW)")
        else:
            steps.append("非肥胖，使用實際體重 (TBW)")
    else:
        missing_fields = []
        if not normalized_sex:
            missing_fields.append("性別")
        if not req.height_cm:
            missing_fields.append("身高")
        steps.append(f"未提供{'/'.join(missing_fields)}，使用實際體重 (TBW)")

    dose_per_hr = dosing_weight * req.target_dose_per_kg_hr
    rate_ml_hr = round(dose_per_hr / req.concentration, 1)

    # e.g. "mcg/kg/hr" → "mcg/hr", "mg/kg/hr" → "mg/hr"
    dose_unit_total = defaults['dose_unit'].replace('/kg', '')
    steps.append(
        f"劑量 = {round(dosing_weight, 1)} kg × {req.target_dose_per_kg_hr} "
        f"{defaults['dose_unit']} = {round(dose_per_hr, 2)} {dose_unit_total}"
    )
    steps.append(
        f"輸注速率 = {round(dose_per_hr, 2)} / {req.concentration} "
        f"{defaults['concentration_unit']} = {rate_ml_hr} ml/hr"
    )

    return PadCalculateResponse(
        drug=drug_lower,
        BMI=weight_info.get("BMI"),
        IBW_kg=weight_info.get("IBW_kg"),
        AdjBW_kg=weight_info.get("AdjBW_kg"),
        pct_IBW=weight_info.get("pct_IBW"),
        is_obese=weight_info.get("is_obese"),
        weight_basis=weight_basis,
        dosing_weight_kg=round(dosing_weight, 1),
        dose_per_hr=round(dose_per_hr, 2),
        rate_ml_hr=rate_ml_hr,
        concentration=f"{req.concentration} {defaults['concentration_unit']}",
        steps=steps,
    )


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/pad-drugs")
async def list_pad_drugs(user: User = Depends(get_current_user)):
    """List all 9 PAD drugs with default parameters."""
    return {
        "success": True,
        "data": {
            "drugs": [
                {
                    "key": k,
                    "label": v["label"],
                    "concentration": v["concentration"],
                    "concentration_unit": v["concentration_unit"],
                    "dose_unit": v["dose_unit"],
                    "dose_range": v["dose_range"],
                    "weight_basis": v["weight_basis"],
                    **({"concentration_range": v["concentration_range"]} if "concentration_range" in v else {}),
                }
                for k, v in PAD_DRUG_DEFAULTS.items()
            ]
        },
    }


@router.post("/pad-calculate")
async def pad_calculate(req: PadCalculateRequest, user: User = Depends(get_current_user)):
    """Calculate PAD drug infusion rate (deterministic, no external service)."""
    result = _pad_calculate(req)
    return {
        "success": True,
        "data": result.model_dump(exclude_none=True),
    }
