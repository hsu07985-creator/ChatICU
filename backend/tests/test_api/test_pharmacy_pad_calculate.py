import pytest

from app.main import app
from app.middleware.auth import get_current_user
from app.models.user import User


def _user_override(role: str):
    async def override_get_current_user():
        return User(
            id=f"usr_{role}",
            name=f"Test {role}",
            username=f"test_{role}",
            password_hash="",
            email=f"{role}@hospital.com",
            role=role,
            unit="ICU",
            active=True,
        )

    return override_get_current_user


@pytest.mark.asyncio
async def test_pad_calculate_normalizes_female_gender_and_uses_ibw_for_cisatracurium(client):
    response = await client.post(
        "/pharmacy/pad-calculate",
        json={
            "drug": "cisatracurium",
            "weight_kg": 62.2,
            "target_dose_per_kg_hr": 0.03,
            "concentration": 0.4,
            "sex": "F",
            "height_cm": 153,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    data = payload["data"]
    assert data["weight_basis"] == "IBW (肥胖調整)"
    assert data["dosing_weight_kg"] == 46.0
    assert data["dose_per_hr"] == 1.38
    assert data["rate_ml_hr"] == 3.4
    assert any("IBW (Devine) = 46.0 kg" in step for step in data["steps"])


@pytest.mark.asyncio
async def test_pad_endpoints_require_pharmacist_or_admin(client):
    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = _user_override("doctor")
    try:
        list_response = await client.get("/pharmacy/pad-drugs")
        assert list_response.status_code == 403

        calc_response = await client.post(
            "/pharmacy/pad-calculate",
            json={
                "drug": "fentanyl",
                "weight_kg": 70,
                "target_dose_per_kg_hr": 1,
                "concentration": 10,
                "sex": "male",
                "height_cm": 170,
            },
        )
        assert calc_response.status_code == 403
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override
