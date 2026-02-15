from typing import List

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    user: dict
    token: str
    refreshToken: str
    expiresIn: int


class RefreshRequest(BaseModel):
    refreshToken: str


class RefreshResponse(BaseModel):
    token: str
    refreshToken: str
    expiresIn: int


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(..., min_length=1)
    newPassword: str = Field(..., min_length=12)


class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str = Field(..., min_length=12)


class ResetPasswordInitRequest(BaseModel):
    username: str = Field(..., min_length=1)


class UserResponse(BaseModel):
    id: str
    name: str
    role: str
    unit: str
    email: str
    permissions: List[str] = []
