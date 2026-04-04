from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


RecordType = Literal["progress-note", "medication-advice", "nursing-record"]
RoleScope = Literal["doctor", "nurse", "pharmacist", "admin", "all"]


class RecordTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    record_type: RecordType
    role_scope: RoleScope
    content: str = Field(..., min_length=1, max_length=10000)
    is_system: bool = False
    sort_order: int = Field(0, ge=0, le=999)


class RecordTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    role_scope: Optional[RoleScope] = None
    content: Optional[str] = Field(None, min_length=1, max_length=10000)
    is_system: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0, le=999)


class RecordTemplateResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    recordType: RecordType
    roleScope: RoleScope
    content: str
    isSystem: bool
    isActive: bool
    sortOrder: int
    createdById: str
    createdByName: str
    updatedById: Optional[str] = None
    updatedByName: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime
    canEdit: bool
    canDelete: bool
