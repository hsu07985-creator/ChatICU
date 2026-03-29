from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ScoreCreate(BaseModel):
    score_type: str = Field(..., pattern=r"^(pain|rass)$")
    value: int
    notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_range(self):
        if self.score_type == "pain" and not (0 <= self.value <= 10):
            raise ValueError("Pain score must be 0-10")
        if self.score_type == "rass" and not (-5 <= self.value <= 4):
            raise ValueError("RASS score must be -5 to +4")
        return self
