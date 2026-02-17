from typing import Optional

from pydantic import BaseModel, Field, field_validator


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    messageType: str = Field("general", max_length=50)
    linkedMedication: Optional[str] = Field(None, max_length=200)
    adviceCode: Optional[str] = Field(None, max_length=10)

    @field_validator("messageType")
    @classmethod
    def check_message_type(cls, v: str) -> str:
        allowed = {"general", "medication-advice", "urgent", "note", "progress-note", "nursing-record"}
        if v not in allowed:
            raise ValueError(f"messageType 須為 {', '.join(sorted(allowed))} 之一")
        return v


class TeamChatCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    pinned: bool = False


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
