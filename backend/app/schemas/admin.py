import re
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.utils.security import validate_password_strength

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


class UserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=12)
    email: str = Field(..., max_length=254)
    role: str  # nurse, doctor, admin, pharmacist
    unit: str = Field(..., min_length=1, max_length=100)

    @field_validator("username")
    @classmethod
    def check_username_chars(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError("帳號僅允許英數字、點(.)、底線(_)、連字號(-)")
        return v

    @field_validator("email")
    @classmethod
    def check_email_format(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("Email 格式不正確")
        return v

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, v):
        error = validate_password_strength(v)
        if error:
            raise ValueError(error)
        return v

    @field_validator("role")
    @classmethod
    def check_valid_role(cls, v):
        allowed = {"nurse", "doctor", "admin", "pharmacist"}
        if v not in allowed:
            raise ValueError(f"角色須為 {', '.join(sorted(allowed))} 之一")
        return v


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    email: Optional[str] = Field(None, max_length=254)
    role: Optional[str] = None
    unit: Optional[str] = Field(None, max_length=100)
    active: Optional[bool] = None
    password: Optional[str] = None

    @field_validator("email")
    @classmethod
    def check_email_format(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _EMAIL_RE.match(v):
            raise ValueError("Email 格式不正確")
        return v

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, v):
        if v is not None:
            error = validate_password_strength(v)
            if error:
                raise ValueError(error)
        return v

    @field_validator("role")
    @classmethod
    def check_valid_role(cls, v):
        if v is not None:
            allowed = {"nurse", "doctor", "admin", "pharmacist"}
            if v not in allowed:
                raise ValueError(f"角色須為 {', '.join(sorted(allowed))} 之一")
        return v


class UserListResponse(BaseModel):
    id: str
    name: str
    username: str
    email: str
    role: str
    unit: str
    active: bool
    lastLogin: Optional[str] = None
    createdAt: Optional[str] = None

    model_config = {"from_attributes": True}


class VectorUploadRequest(BaseModel):
    databaseId: str
    fileName: str
    fileSize: int


class ErrorReportCreate(BaseModel):
    patientId: Optional[str] = None
    errorType: str = Field(..., min_length=1, max_length=100)
    severity: str = Field(..., pattern=r"^(low|moderate|high|critical)$")
    medicationName: Optional[str] = Field(None, max_length=200)
    description: str = Field(..., min_length=1, max_length=5000)
    actionTaken: Optional[str] = Field(None, max_length=5000)


class ErrorReportUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern=r"^(pending|reviewing|resolved|closed)$")
    resolution: Optional[str] = Field(None, max_length=5000)


_ADVICE_CODE_RE = re.compile(r"^\d{1,2}-[A-Z]$|^\d{1,2}-\d{1,2}$")
_ADVICE_CATEGORIES = {
    "1. 建議處方", "2. 主動建議", "3. 建議監測", "4. 用藥連貫性",
    # legacy alias
    "4. 用藥適從性",
}


class AdviceRecordCreate(BaseModel):
    patientId: str = Field(..., min_length=1, max_length=50)
    adviceCode: str = Field(..., min_length=1, max_length=10)
    adviceLabel: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=5000)
    linkedMedications: Optional[List[str]] = None
    accepted: Optional[bool] = None

    @field_validator("adviceCode")
    @classmethod
    def check_advice_code_format(cls, v: str) -> str:
        if not _ADVICE_CODE_RE.match(v):
            raise ValueError("建議代碼格式不正確，應為 X-Y（如 1-A、3-R）")
        return v

    @field_validator("category")
    @classmethod
    def check_category(cls, v: str) -> str:
        if v not in _ADVICE_CATEGORIES:
            raise ValueError(f"類別須為 {', '.join(sorted(_ADVICE_CATEGORIES))} 之一")
        return v
