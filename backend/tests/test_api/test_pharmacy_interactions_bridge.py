import pytest

from app.models.drug_interaction import DrugInteraction, IVCompatibility


@pytest.mark.asyncio
async def test_drug_interactions_prefers_graph_when_resolved(client, monkeypatch):
    from app.routers.pharmacy_routes import interactions as interactions_router

    monkeypatch.setattr(interactions_router.drug_graph_bridge, "resolve_drug", lambda _raw: "ResolvedDrug")
    monkeypatch.setattr(
        interactions_router.drug_graph_bridge,
        "search_interactions",
        lambda **_kwargs: [
            {
                "id": "graphint_001",
                "drug1": "Propofol",
                "drug2": "Fentanyl",
                "severity": "major",
                "mechanism": "CNS depression",
                "clinicalEffect": "Increased sedation",
                "management": "Monitor",
                "references": "graph-source",
                "source": "drug_graph",
            }
        ],
    )

    response = await client.get(
        "/pharmacy/drug-interactions",
        params={"drugA": "Propofol", "drugB": "Fentanyl", "allowRag": False},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "drug_graph"
    assert data["total"] == 1
    assert data["interactions"][0]["id"] == "graphint_001"


@pytest.mark.asyncio
async def test_drug_interactions_fallbacks_to_database_when_graph_unresolved(client, seeded_db, monkeypatch):
    from app.routers.pharmacy_routes import interactions as interactions_router

    seeded_db.add(
        DrugInteraction(
            id="di_001",
            drug1="Propofol",
            drug2="Fentanyl",
            severity="major",
            mechanism="CNS depression",
            clinical_effect="Increased sedation",
            management="Monitor sedation",
            references="db-source",
        )
    )
    await seeded_db.commit()

    monkeypatch.setattr(interactions_router.drug_graph_bridge, "resolve_drug", lambda _raw: None)

    response = await client.get(
        "/pharmacy/drug-interactions",
        params={"drugA": "Propofol", "drugB": "Fentanyl", "allowRag": False},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "database"
    assert data["total"] == 1
    assert data["interactions"][0]["id"] == "di_001"


@pytest.mark.asyncio
async def test_drug_interactions_allow_rag_false_skips_drug_rag(client, monkeypatch):
    from app.routers.pharmacy_routes import interactions as interactions_router

    async def _unexpected_rag_call(*_args, **_kwargs):
        raise AssertionError("Drug RAG should not be called when allowRag=false")

    monkeypatch.setattr(interactions_router.drug_rag_client, "query", _unexpected_rag_call)
    monkeypatch.setattr(interactions_router.drug_graph_bridge, "resolve_drug", lambda _raw: "ResolvedDrug")
    monkeypatch.setattr(
        interactions_router.drug_graph_bridge,
        "search_interactions",
        lambda **_kwargs: [
            {
                "id": "graphint_002",
                "drug1": "Midazolam",
                "drug2": "Fentanyl",
                "severity": "moderate",
                "mechanism": "CNS depression",
                "clinicalEffect": "Increased sedation",
                "management": "Monitor",
                "references": "graph-source",
                "source": "drug_graph",
            }
        ],
    )

    response = await client.get(
        "/pharmacy/drug-interactions",
        params={"drugA": "Midazolam", "drugB": "Fentanyl", "allowRag": False},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "drug_graph"
    assert data["interactions"][0]["id"] == "graphint_002"


@pytest.mark.asyncio
async def test_iv_compatibility_prefers_graph_when_resolved(client, monkeypatch):
    from app.routers.pharmacy_routes import interactions as interactions_router

    monkeypatch.setattr(interactions_router.drug_graph_bridge, "resolve_drug", lambda _raw: "ResolvedDrug")
    monkeypatch.setattr(
        interactions_router.drug_graph_bridge,
        "check_compatibility",
        lambda **_kwargs: {
            "id": "graphcomp_001",
            "drug1": "Amiodarone HCl",
            "drug2": "Heparin sodium",
            "solution": "general y-site",
            "compatible": False,
            "timeStability": None,
            "notes": "Incompatible",
            "references": "graph-source",
            "source": "drug_graph",
        },
    )

    response = await client.get(
        "/pharmacy/iv-compatibility",
        params={"drugA": "Amiodarone HCl", "drugB": "Heparin sodium"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "drug_graph"
    assert data["total"] == 1
    assert data["compatibilities"][0]["id"] == "graphcomp_001"


@pytest.mark.asyncio
async def test_iv_compatibility_fallbacks_to_database_when_graph_unresolved(client, seeded_db, monkeypatch):
    from app.routers.pharmacy_routes import interactions as interactions_router

    seeded_db.add(
        IVCompatibility(
            id="iv_001",
            drug1="Amiodarone HCl",
            drug2="Heparin sodium",
            solution="NS",
            compatible=False,
            time_stability="2h",
            notes="Precipitation observed",
            references="db-source",
        )
    )
    await seeded_db.commit()

    monkeypatch.setattr(interactions_router.drug_graph_bridge, "resolve_drug", lambda _raw: None)

    response = await client.get(
        "/pharmacy/iv-compatibility",
        params={"drugA": "Amiodarone HCl", "drugB": "Heparin sodium"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "database"
    assert data["total"] == 1
    assert data["compatibilities"][0]["id"] == "iv_001"
