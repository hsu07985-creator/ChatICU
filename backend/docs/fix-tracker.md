# Test Failure Fix Tracker

> Created: 2026-04-08
> Total failures to fix: 33 (5 items) — **ALL DONE**
> Skipped: 15 (RAG/embedding — needs OPENAI_API_KEY)
> Round 1 result: 390 → 422 passed
> Round 2 result: 422 → **537 passed**, 0 collection errors, **15 failed** (all RAG D+E — skipped by user)

| # | Item | Failures | Status | Files Changed | Notes |
|---|------|----------|--------|---------------|-------|
| 1 | team_chat schema + endpoints | 12 | DONE | `models/chat_message.py`, `schemas/message.py`, `routers/team_chat.py` | 14/14 pass |
| 2 | clinical NHI endpoint | 14 | DONE | `config.py`, `schemas/clinical.py`, `routers/clinical.py`, `services/nhi_client.py` (existed) | 13/13 pass (1 skipped: no real_auth fixture) |
| 3 | pharmacy interactions bridge | 5 | DONE | `pharmacy_routes/interactions.py`, `config.py` (+SOURCE_A/B_URL) | 5/5 pass |
| 4 | dashboard jsonb compat | 1 | DONE | `routers/dashboard.py` | `jsonb_array_length` → `json_array_length` |
| 5 | ai_readiness feature gate | 1 | DONE | `routers/ai_readiness.py` | chat requires `knowledge_ready` |

## Round 2

| # | Item | Failures | Status | Files Changed | Notes |
|---|------|----------|--------|---------------|-------|
| B | citation_builder collection error | blocked→0 | DONE | `schemas/clinical.py` (+UnifiedCitationItem) | 24/24 pass |
| C | orchestrator + source_registry collection | blocked→0 | DONE | `config.py` (+SOURCE_PRIORITIES_PATH, ORCHESTRATOR_ENABLED) | 41/41 pass |
| A | clinical unified-query endpoint | 13 | DONE | `routers/clinical.py` (+POST /query, +settings import) | 13/13 pass |

## Feature: Medication Source & Outpatient Import (048-049)

| # | Item | Status | Files Changed | Notes |
|---|------|--------|---------------|-------|
| 048 | DDL: 7 cols medications + campus patients | DONE | `alembic/versions/048_medication_source_columns.py` | batch_alter_table, index on source_type |
| M1 | Model: Medication + Patient | DONE | `models/medication.py`, `models/patient.py` | +Integer import, +7 cols, +campus |
| S1 | Schema: MedicationResponse + OutpatientImportRequest | DONE | `schemas/medication.py` | +7 response fields, +OutpatientMedicationItem |
| R1 | Router: med_to_dict + grouped + import endpoint | DONE | `routers/medications.py` | outpatient group, POST import-outpatient |
| 049 | Seed: 4 demo outpatient meds | DONE | `alembic/versions/049_seed_outpatient_demo.py` | Tamsulosin/Amlodipine/Metformin/Atorvastatin |

Tests: **522 passed** (excl. RAG), 0 failed, 0 regressions.

## Progress Log

- **[A] unified-query DONE** (2026-04-08): Added `POST /clinical/query` endpoint with orchestrator integration, LLM synthesis, citation building, graceful fallback. 13/13 tests pass.
- **[B] citation_builder DONE** (2026-04-08): Added `UnifiedCitationItem` + `UnifiedQueryRequest` to schemas/clinical.py. 24 citation_builder tests + all related now pass.
- **[C] config collection DONE** (2026-04-08): Added `SOURCE_PRIORITIES_PATH`, `ORCHESTRATOR_ENABLED` to config. Unblocked orchestrator + source_registry tests (41 pass).
- **[5] ai_readiness DONE** (2026-04-08): `chat` feature gate now requires `knowledge_ready`. 4/4 tests pass.
- **[4] dashboard jsonb DONE** (2026-04-08): `jsonb_array_length` → `json_array_length` for SQLite compat. 1/1 pass.
- **[3] interactions bridge DONE** (2026-04-08): Imported `drug_graph_bridge` + `drug_rag_client` into interactions router. Graph-first → DB fallback pattern. Added `SOURCE_A_URL`/`SOURCE_B_URL` to config. Added `source` field + `allowRag` param. 5/5 tests pass.
- **[2] clinical NHI DONE** (2026-04-08): Added `NHI_SERVICE_URL` to config, `NhiRequest` schema, `POST /clinical/nhi` endpoint with NHI service + LLM fallback, drug name zh mapping. 13/13 tests pass.
- **[1] team_chat DONE** (2026-04-08): Added `reply_to_id`, `is_read`, `read_by`, `mentioned_roles` to model. Added `replyToId`/`mentionedRoles` to schema with validation. Rewrote router: reply threading with flatten, `/read` endpoint, `/mentions/count` endpoint, top-level-only listing. 14/14 tests pass.
