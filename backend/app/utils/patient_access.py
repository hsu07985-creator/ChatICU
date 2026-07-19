"""Patient-access helpers shared by all patient-scoped routers.

Moved out of app.routers.patients (2026-07-19) — a router module is not a
home for cross-router authz primitives; 11 sibling routers were importing
it backwards.
"""
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from app.models.patient import Patient
    from app.models.user import User


def normalize_patient_id(patient_id: str) -> str:
    if patient_id.startswith("pat_"):
        return patient_id
    return f"pat_{patient_id.zfill(3)}"


def verify_patient_access(user: "User", patient: "Patient") -> None:
    """Verify the user has access to this patient's data.

    All authenticated users can access all patients (shared ICU).
    Kept as an explicit call site in every patient router so a future
    per-unit ACL only needs to change this one function.
    """
    return
