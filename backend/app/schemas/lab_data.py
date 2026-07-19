from typing import Optional

from pydantic import BaseModel


class LabCorrectionRequest(BaseModel):
    category: str
    item: str
    correctedValue: float
    reason: Optional[str] = None




from datetime import datetime as _datetime
from typing import Optional as _Optional

from pydantic import field_validator as _field_validator

from app.schemas.base import CamelModel as _CamelModel


class LabDataResponse(_CamelModel):
    id: str
    patient_id: str
    timestamp: _Optional[_datetime] = None
    biochemistry: _Optional[dict] = None
    hematology: _Optional[dict] = None
    blood_gas: _Optional[dict] = None
    venous_blood_gas: _Optional[dict] = None
    inflammatory: _Optional[dict] = None
    coagulation: _Optional[dict] = None
    cardiac: _Optional[dict] = None
    thyroid: _Optional[dict] = None
    hormone: _Optional[dict] = None
    lipid: _Optional[dict] = None
    other: _Optional[dict] = None
    corrections: _Optional[list] = None

    @_field_validator("venous_blood_gas", mode="before")
    @classmethod
    def _empty_dict_default(cls, v):
        # 舊 serializer 對 venousBloodGas 用 `or {}`,維持契約
        return v or {}
