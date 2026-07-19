from datetime import datetime
from typing import Optional

from pydantic import Field, field_validator

from app.schemas.base import CamelModel


class AIMessageResponse(CamelModel):
    id: str
    role: Optional[str] = None
    content: Optional[str] = None
    # 契約鍵名是 timestamp,來源欄是 created_at
    created_at: Optional[datetime] = Field(None, serialization_alias="timestamp")


class AISessionResponse(CamelModel):
    """固定欄位;messageCount/snapshotTakenAt 由 router wrapper 附加。"""
    id: str
    user_id: Optional[str] = None
    patient_id: Optional[str] = None
    title: str = "新對話"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("title", mode="before")
    @classmethod
    def _title_default(cls, v):
        return v or "新對話"
