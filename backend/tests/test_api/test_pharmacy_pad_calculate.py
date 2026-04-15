import pytest


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
