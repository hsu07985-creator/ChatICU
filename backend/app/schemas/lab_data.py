from typing import Optional

from pydantic import BaseModel


class LabCorrectionRequest(BaseModel):
    category: str
    item: str
    correctedValue: float
    reason: Optional[str] = None


