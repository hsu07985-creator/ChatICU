# Phase 0 Project Map

Generated at: 2026-02-17 12:02 CST

## 1) Frontend Map

- Entrypoint: `src/main.tsx:2`, `src/main.tsx:6`
- App routing root: `src/App.tsx:106`, `src/App.tsx:115`
- Auth guards:
  - `ProtectedRoute`: `src/App.tsx:42`
  - `AdminRoute`: `src/App.tsx:56`
  - `PharmacyRoute`: `src/App.tsx:74`
- API client:
  - Base URL/env injection: `src/lib/api-client.ts:5`
  - Request trace headers: `src/lib/api-client.ts:172`
  - Response interceptor/token refresh: `src/lib/api-client.ts:202`
- AI API contract:
  - Readiness endpoint: `src/lib/api/ai.ts:168`
  - Chat endpoint: `src/lib/api/ai.ts:190`
  - Chat stream endpoint: `src/lib/api/ai.ts:225`
  - Citation model (`page/pages/snippetCount`): `src/lib/api/ai.ts:30`

## 2) Backend Map

- FastAPI bootstrap: `backend/app/main.py:108`
- Routers mounted: `backend/app/main.py:307`, `backend/app/main.py:325`
- API routers (selected):
  - `backend/app/routers/ai_chat.py` (`/ai`)
  - `backend/app/routers/ai_readiness.py` (`/api/v1/ai`)
  - `backend/app/routers/clinical.py` (`/api/v1/clinical`)
  - `backend/app/routers/rag.py` (`/api/v1/rag`)
  - `backend/app/routers/patients.py` (`/patients`)
  - `backend/app/routers/lab_data.py` (`/patients/{patient_id}/lab-data`)
  - `backend/app/routers/vital_signs.py` (`/patients/{patient_id}/vital-signs`)
  - `backend/app/routers/ventilator.py` (`/patients/{patient_id}/ventilator`)
  - `backend/app/routers/medications.py` (`/patients/{patient_id}/medications`)
  - `backend/app/routers/messages.py` (`/patients/{patient_id}/messages`)
  - `backend/app/routers/pharmacy.py` (`/pharmacy`)

## 3) Database Map

- Migration entry: `backend/alembic/versions/001_initial_schema.py`
- Migration chain: `backend/alembic/versions/001_initial_schema.py` ~ `backend/alembic/versions/006_pharmacy_compatibility_favorites.py`
- Seed and datamock pipeline:
  - `backend/seeds/datamock_source.py`
  - `backend/seeds/seed_data.py`
  - `backend/seeds/seed_if_empty.py`
  - `datamock/*.json`
- Core runtime tables (high-use):
  - `patients`, `lab_data`, `vital_signs`, `ventilator_settings`, `medications`
  - `ai_sessions`, `ai_messages`
  - `patient_messages`, `team_chat_messages`
  - `users`, `audit_logs`
  - `drug_interactions`, `iv_compatibilities`
  - `pharmacy_advices`, `pharmacy_compatibility_favorites`

## 4) AI Chain Map

- Provider/model config:
  - `backend/app/config.py:69`
  - `backend/app/config.py:70`
  - `backend/app/config.py:75`
- Prompt templates:
  - `backend/app/llm.py:29` (`TASK_PROMPTS`)
  - `backend/app/llm.py:50` (`rag_generation`, two-section output + concrete monitoring requirement)
- Evidence + fallback flow:
  - Hybrid evidence query: `backend/app/routers/ai_chat.py:708`
  - Local RAG fallback: `backend/app/routers/ai_chat.py:116`
  - Citation merge-by-source: `backend/app/routers/ai_chat.py:381`
  - Evidence gate eval: `backend/app/routers/ai_chat.py:759`
  - Degraded handling: `backend/app/routers/ai_chat.py:798`
  - Partial response for stale/missing data: `backend/app/routers/ai_chat.py:767`

## 5) Observability and Traceability

- Request/trace propagation:
  - Backend middleware injects headers: `backend/app/main.py:138`, `backend/app/main.py:165`
  - FE sends headers per request: `src/lib/api-client.ts:172`
  - Evidence service receives trace headers: `backend/app/services/evidence_client.py:74`
- Structured audit logging:
  - AI chat audit event: `backend/app/routers/ai_chat.py:901`
  - Captured evidence gate fields: `backend/app/routers/ai_chat.py:918`, `backend/app/routers/ai_chat.py:920`
- Data freshness metadata:
  - Builder: `backend/app/utils/data_freshness.py:105`
  - Response payload field path: `backend/app/routers/ai_chat.py:883`

## 6) Mock/Fake Risk Hotspots

- Frontend mock toggles:
  - `VITE_USE_MOCK` in `.env.example`, `.env.development`
  - `src/lib/mock-data.ts`
- Backend offline mode:
  - `DATA_SOURCE_MODE=json` in `backend/app/config.py:22`
  - Startup datamock validation in `backend/app/main.py:80`

## 7) Verification Commands (Phase 0)

- Repo scan: `rg --files src backend datamock`
- FE route evidence: `rg -n "BrowserRouter|Route|ProtectedRoute|AdminRoute|PharmacyRoute" src/App.tsx`
- FE API evidence: `rg -n "API_BASE_URL|sendChatMessage|streamChatMessage" src/lib/api-client.ts src/lib/api/ai.ts`
- BE router evidence: `rg -n "include_router" backend/app/main.py`
- AI chain evidence: `rg -n "evidence_gate|degradedReason|create_audit_log" backend/app/routers/ai_chat.py`

## 8) Remaining Blockers Before Phase 1 Active

- Missing archived artifact of one full backend log slice correlated by `request_id`.
- Missing archived provider raw response sample (masked), matched to one audited chat request.
