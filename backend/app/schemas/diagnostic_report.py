from datetime import datetime
from typing import Optional

from app.schemas.base import CamelModel


class DiagnosticReportResponse(CamelModel):
    id: str
    patient_id: str
    report_type: Optional[str] = None
    exam_name: Optional[str] = None
    exam_date: Optional[datetime] = None
    body_text: Optional[str] = None
    impression: Optional[str] = None
    reporter_name: Optional[str] = None
    status: Optional[str] = None
