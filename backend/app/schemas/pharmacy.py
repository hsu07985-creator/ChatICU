from pydantic import BaseModel, Field


class CompatibilityFavoriteCreate(BaseModel):
    drugA: str = Field(..., min_length=1, max_length=200)
    drugB: str = Field(..., min_length=1, max_length=200)
    solution: str = Field("none", max_length=20)

