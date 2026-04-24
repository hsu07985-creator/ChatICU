from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    messageType: str = Field("general", max_length=50)
    linkedMedication: Optional[str] = Field(None, max_length=200)
    adviceCode: Optional[str] = Field(None, max_length=10)
    replyToId: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = None
    mentionedRoles: Optional[List[str]] = None
    adviceAction: Optional[str] = Field(None, description="accept or reject (doctor reply to pharmacy advice)")

    @field_validator("messageType")
    @classmethod
    def check_message_type(cls, v: str) -> str:
        allowed = {"general", "medication-advice", "urgent", "note", "progress-note", "nursing-record"}
        if v not in allowed:
            raise ValueError(f"messageType 須為 {', '.join(sorted(allowed))} 之一")
        return v

    @field_validator("adviceAction")
    @classmethod
    def check_advice_action(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("accept", "reject"):
            raise ValueError("adviceAction 須為 accept 或 reject")
        return v

    @field_validator("mentionedRoles")
    @classmethod
    def check_mentioned_roles(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            allowed = {"doctor", "np", "nurse", "pharmacist", "admin"}
            for role in v:
                if role not in allowed:
                    raise ValueError(f"角色須為 {', '.join(sorted(allowed))} 之一")
        return v


class MessageTagUpdate(BaseModel):
    add: Optional[List[str]] = None
    remove: Optional[List[str]] = None


class TeamChatCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    pinned: bool = False
    replyToId: Optional[str] = Field(None, max_length=50)
    mentionedRoles: Optional[List[str]] = None
    mentionedUserIds: Optional[List[str]] = None

    @field_validator("mentionedRoles")
    @classmethod
    def check_team_mentioned_roles(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            allowed = {"doctor", "np", "nurse", "pharmacist", "admin"}
            for role in v:
                if role not in allowed:
                    raise ValueError(f"角色須為 {', '.join(sorted(allowed))} 之一")
        return v

    @field_validator("mentionedUserIds")
    @classmethod
    def check_team_mentioned_user_ids(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            if len(v) > 50:
                raise ValueError("一次最多 @ 50 位使用者")
            for uid in v:
                if not uid or len(uid) > 50:
                    raise ValueError("使用者 ID 格式不正確")
        return v


class MessageResponse(BaseModel):
    id: str
    patientId: str
    authorId: str
    authorName: str
    authorRole: str
    messageType: str
    content: str
    timestamp: str
    isRead: bool
    linkedMedication: Optional[str] = None
    adviceCode: Optional[str] = None
    readBy: Optional[list] = None

    model_config = {"from_attributes": True}


class TeamChatResponse(BaseModel):
    id: str
    userId: str
    userName: str
    userRole: str
    content: str
    timestamp: str
    pinned: bool = False
    pinnedBy: Optional[dict] = None
    pinnedAt: Optional[str] = None

    model_config = {"from_attributes": True}


class CustomTagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
