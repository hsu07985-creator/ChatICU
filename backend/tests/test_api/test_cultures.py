from datetime import datetime, timezone

import pytest

from app.models.culture_result import CultureResult


pytestmark = pytest.mark.anyio


@pytest.fixture
async def seeded_cultures(seeded_db):
    common = {
        "patient_id": "pat_001",
        "specimen_code": "SP",
        "department": "ICU",
        "collected_at": datetime(2026, 7, 2, 8, 0, tzinfo=timezone.utc),
        "reported_at": datetime(2026, 7, 2, 12, 0, tzinfo=timezone.utc),
    }
    seeded_db.add_all([
        CultureResult(
            **common,
            id="cul_positive",
            sheet_number="CULT-1",
            specimen="Blood",
            isolates=[{"code": "XORG1", "organism": "E. coli", "colonies": "Many"}],
            susceptibility=[{
                "antibiotic": "Ciprofloxacin", "code": "CIP",
                "result": "R", "mic": "4",
            }],
            source_campus="Factory_H",
            source_details={"alerts": ["Critical result"]},
        ),
        CultureResult(
            **common,
            id="cul_stain",
            sheet_number="STAIN-1",
            specimen="Sputum",
            isolates=[],
            susceptibility=[],
            q_score=3,
            source_campus="MAIN",
            source_details={"items": [{
                "LAB_CODE": "13A03", "RESULT": "1+",
            }]},
        ),
        CultureResult(
            **common,
            id="cul_metadata",
            sheet_number="META-1",
            specimen="Urine",
            isolates=[],
            susceptibility=[],
            source_campus="MAIN",
            source_details={"items": [{
                "LAB_CODE": "XEOD", "RESULT": "Completed request",
            }]},
        ),
    ])
    await seeded_db.commit()


async def test_cultures_api_is_compact_and_preserves_clinical_fields(
    client, seeded_cultures,
):
    response = await client.get("/patients/pat_001/cultures")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["cultureCount"] == 2

    culture = next(row for row in data["cultures"] if row["recordType"] == "culture")
    assert culture["status"] == "positive"
    assert culture["campusName"] == "和平"
    assert culture["susceptibility"][0]["mic"] == "4"
    assert culture["alerts"] == ["Critical result"]

    stain = next(row for row in data["cultures"] if row["recordType"] == "gram_stain")
    assert stain["status"] == "reported"
    assert stain["stainResults"] == [{
        "code": "13A03", "label": "G(-) bacillus", "value": "1+",
    }]
    assert stain["qScore"] == 3
    assert all("sourceDetails" not in row for row in data["cultures"])
