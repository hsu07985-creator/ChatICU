# Phase 5 Prioritized Fix Backlog

Generated at: 2026-02-17 13:11 CST
Input baselines:
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-4-mock-fake-risk-register.md`
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-2-contract-matrix.md`
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-3-field-lineage-matrix.md`

## 1) Scope for This Phase-5 Slice

This backlog slice only covers requested P0 items:
1. `administrations` real persistence (replace synthetic/in-memory behavior)
2. docker default mode safety (`db` by default; explicit offline opt-in)

Covered Phase-4 risks:
- `R-MF-002` (Medication administration semantic-fake)
- `R-MF-001` (Docker json default contamination)

## 2) P0 Backlog Overview

| Epic | Priority | Goal | Risk Covered | Status |
|---|---|---|---|---|
| P0-A | P0 | Medication administrations become DB-persisted, queryable, auditable | R-MF-002 | Completed (A1/A2/A3/A4/A5/A6 implemented) |
| P0-B | P0 | Docker default runtime uses `DATA_SOURCE_MODE=db`; json mode explicit only | R-MF-001 | Completed (B1/B2/B3/B4/B5 implemented) |

## 3) Epic P0-A: Administrations 真實持久化

### 3.1 Current gap evidence

Legacy gaps were:
- Synthetic rows generated in router code instead of database records.
- Patch writing to in-memory override map (state lost after restart).
- Missing persisted administration table/relationship (already solved by P0-A1).

Current status:
- Resolved in `P0-A3`: administrations now read/write `medication_administrations` via SQLAlchemy in `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py`.

### 3.2 Work items (implementation-ready)

| ID | Work item | Files to change | Depends on | Acceptance criteria |
|---|---|---|---|---|
| P0-A1 | Add persisted table `medication_administrations` + ORM model | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/alembic/versions/007_medication_administrations.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/models/medication_administration.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/models/medication.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/models/patient.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/models/__init__.py` | None | Migration up/down passes; table has FK to `medications.id` and indexed query keys (`medication_id`, `patient_id`, `scheduled_time`). |
| P0-A2 | Define API schema for administration record and patch payload (contract explicit) | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/schemas/medication.py` | P0-A1 | `MedicationAdministrationResponse` exists and aligns with FE `src/lib/api/medications.ts` fields; OpenAPI shows stable schema. |
| P0-A3 | Refactor medication router to DB reads/writes (remove in-memory overrides and runtime synthetic source) | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py` | P0-A1, P0-A2 | `GET .../administrations` reads DB rows with `startDate/endDate`; `PATCH .../administrations/{id}` updates DB row and survives service restart. |
| P0-A4 | Seed path for offline/dev data so administrations exist deterministically | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/seeds/seed_data.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/seeds/validate_datamock.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/datamock/medications.json` (or new `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/datamock/medicationAdministrations.json`) | P0-A1 | Fresh seed run creates administration rows for active meds in offline mode; validation script catches malformed administration payloads. |
| P0-A5 | Contract + persistence tests | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/test_api/test_medications_api.py`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/conftest.py` | P0-A3 | Tests verify update persists via DB query (not same-process memory), and date filter returns expected subset. |
| P0-A6 | Manual API evidence package for real persistence | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-administrations-persistence-<timestamp>/` | P0-A3, P0-A4 | Evidence contains: before/after GET, PATCH response, restart, post-restart GET showing unchanged update. |

P0-A implementation progress (this round):
- [x] P0-A1 completed: added migration + ORM model + relationships for `medication_administrations`.
- [x] P0-A2 completed: added explicit response schemas (`MedicationAdministrationResponse` + list/item envelopes) and applied endpoint `response_model` in medication router.
- [x] P0-A3 completed: `medications` router now reads/writes `medication_administrations` table directly (removed synthetic schedule and in-memory overrides).
- [x] P0-A4 completed: added `datamock/medicationAdministrations.json`, wired seed ingestion in `backend/seeds/seed_data.py`, and added validator structure/reference checks in `backend/seeds/validate_datamock.py`.
- [x] P0-A5 completed: added persistence-focused tests in `backend/tests/test_api/test_medications_api.py` (DB query verification and `startDate/endDate` subset assertions).
- [x] P0-A6 completed: manual API persistence evidence archived at `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-administrations-persistence-20260217T062059Z/`.

### 3.3 Data model contract (target)

Recommended minimum columns for `medication_administrations`:
- `id` (string PK)
- `medication_id` (FK)
- `patient_id` (denormalized FK-supporting query)
- `scheduled_time` (timezone-aware datetime)
- `administered_time` (timezone-aware datetime, nullable)
- `status` (`scheduled|administered|missed|held|refused`)
- `dose` (string)
- `route` (string)
- `administered_by` (JSON `{id,name}`, nullable)
- `notes` (text, nullable)
- `created_at`, `updated_at`

## 4) Epic P0-B: Docker 預設 mode 安全化（db default）

### 4.1 Current gap evidence

- Compose default currently sets json mode when env missing:
  - `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.yml:22`
- Startup path in json mode validates and seeds datamock automatically:
  - `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/main.py:80`
  - `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/seeds/seed_if_empty.py:33`

### 4.2 Work items (implementation-ready)

| ID | Work item | Files to change | Depends on | Acceptance criteria |
|---|---|---|---|---|
| P0-B1 | Change docker default from `json` to `db` | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.yml` | None | `DATA_SOURCE_MODE` fallback in compose is `db`; plain `docker compose up --build` boots in db mode. |
| P0-B2 | Provide explicit offline override profile/file | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.offline.yml` (new) | P0-B1 | Running with override file enables json mode explicitly; default file alone does not. |
| P0-B3 | Add startup guardrail log for mode source (explicit vs defaulted) | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/main.py` | P0-B1 | Startup log clearly shows selected mode and warns when json mode is active. |
| P0-B4 | Update operator docs (README + runbook) to separate default db vs explicit offline flows | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/README.md`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/operations/json-offline-dev-runbook.md`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/.env.example` | P0-B1, P0-B2 | Docs no longer imply json as default quickstart; offline mode documented as opt-in command path. |
| P0-B5 | Add regression checks for compose mode and freshness mode output | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-docker-mode-<timestamp>/` | P0-B1, P0-B2 | Evidence shows default run returns `dataFreshness.mode=db`; offline override run returns `mode=json`. |

P0-B implementation progress (this round):
- [x] P0-B1 completed: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.yml` default changed to `DATA_SOURCE_MODE=${DATA_SOURCE_MODE:-db}`.
- [x] P0-B2 completed: added `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.offline.yml` for explicit offline opt-in.
- [x] P0-B3 completed: startup now logs `DATA_SOURCE_MODE` with source (`env` / `.env path` / `default`) in `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/main.py`.
- [x] P0-B4 completed: docker usage docs now clearly separate default db mode and explicit offline override in `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/README.md` and `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/operations/json-offline-dev-runbook.md`.
- [x] Compose static validation done: `docker compose ... config` confirms db default and json override behavior.
- [x] P0-B5 completed: manual docker regression evidence archived at `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-docker-mode-20260217T061536Z/`.

## 5) Execution Order (recommended)

1. `P0-B1` -> `P0-B2` -> `P0-B3` -> `P0-B4`
2. `P0-A1` -> `P0-A2` -> `P0-A3` -> `P0-A4`
3. `P0-A5` and `P0-B5` in parallel after code changes
4. Final manual API evidence + report update

Reason: docker mode safety can ship independently and immediately reduces accidental json contamination; administrations persistence is broader DB/API refactor.

## 6) Test and Validation Gate (for implementation PR)

Required automated checks:
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api/test_medications_api.py -q`
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api/test_contract.py -q`
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run typecheck && npm run build`

Required manual checks:
- Patch administration, restart backend, re-query administration row, verify persisted state unchanged.
- Default docker up path uses `db` mode.
- Offline override path uses `json` mode and shows expected freshness hint.

## 7) Phase-5 Slice Exit Criteria

This backlog slice is complete when:
- [x] P0-A and P0-B are decomposed into implementation-ready work items.
- [x] Each item has concrete file targets and acceptance criteria.
- [x] Execution order and validation gate are defined.

## 8) Current Gate

- `Phase 5`: Completed for this P0 slice (P0-A1~A6 and P0-B1~B5 implemented with evidence).

## 9) Next Steps (A2~A6 + B5)

1. Move to `Phase 6`: consolidate final verification plan and release checklist.
2. Keep issue registry synchronized with final close states and commit links.

## 10) GitHub Issue Traceability

- Umbrella: [#25](https://github.com/ZymoMed/ChatICU_YU/issues/25) (Open)
- P0-A4: [#26](https://github.com/ZymoMed/ChatICU_YU/issues/26) (Closed)
- P0-A5: [#27](https://github.com/ZymoMed/ChatICU_YU/issues/27) (Closed)
- P0-A6: [#28](https://github.com/ZymoMed/ChatICU_YU/issues/28) (Open)
- P0-B5: [#29](https://github.com/ZymoMed/ChatICU_YU/issues/29) (Open)
- Registry snapshot: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/github-issues-phase5-20260217T1404Z.md`
- Docker regression evidence: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-docker-mode-20260217T061536Z/`
- Administrations persistence evidence: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/manual-api-phase5-administrations-persistence-20260217T062059Z/`
