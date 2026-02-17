# Phase 1 Frontend Requirement Catalog

Generated at: 2026-02-17 12:18 CST
Source of truth: Frontend behavior and call-sites in `src/pages/*` and `src/components/*`

## 1) Scope and Method

- Goal: enumerate every API contract required by current frontend user journeys.
- Evidence basis:
  - route map: `src/App.tsx`
  - API wrappers: `src/lib/api/*.ts`
  - actual usage call-sites: `src/pages/*`, `src/components/*`
  - backend endpoint definitions: `backend/app/routers/*.py`, `backend/app/routers/pharmacy_routes/*.py`

## 2) Route-Level Requirement Catalog

| FE Route | User Goal | Required API Calls | Key Request Contract | Key Response Contract Used by UI | Evidence |
|---|---|---|---|---|---|
| `/login` | user authentication | `POST /auth/login`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout` | `username`, `password`; refresh flow requires `refreshToken` | `user`, `token`, `refreshToken`; auth context requires role/identity | `src/pages/login.tsx`, `src/lib/api/auth.ts:26` |
| `/dashboard` | ICU overview + quick edit | `GET /patients`, `GET /dashboard/stats`, `PATCH /patients/{id}` | optional filters; patch payload in snake_case mapping | patient cards (`name`,`bedNumber`,`SAN`,`alerts`), stats (`patients/alerts/medications/messages`) | `src/pages/dashboard.tsx:11`, `src/lib/api/patients.ts:80`, `src/lib/api/dashboard.ts:36` |
| `/patients` | list/create/edit/archive patients | `GET /patients`, `POST /patients`, `PATCH /patients/{id}`, `PATCH /patients/{id}/archive` | create form requires bed/MRN/name/diagnosis/age; archive requires `archived` | list table fields + SAN summary + archive state | `src/pages/patients.tsx:4`, `src/lib/api/patients.ts:185` |
| `/patient/:id` | single patient command center | `GET /patients/{id}`, `GET /patients/{id}/lab-data/latest`, `GET /patients/{id}/medications`, `GET /patients/{id}/messages`, `GET /patients/{id}/vital-signs/latest`, `GET /patients/{id}/ventilator/latest`, `GET /patients/{id}/ventilator/weaning-assessment` | patient id path params; optional filters for meds/messages | patient profile tabs, trend charts, message board, ventilator card | `src/pages/patient-detail.tsx:392`, `src/lib/api/lab-data.ts:80`, `src/lib/api/medications.ts:86` |
| `/patient/:id` (AI chat pane) | bedside Q&A with evidence | `GET /api/v1/ai/readiness`, `POST /ai/chat/stream` fallback `POST /ai/chat`, `GET /ai/sessions`, `GET /ai/sessions/{id}`, `PATCH /ai/sessions/{id}`, `DELETE /ai/sessions/{id}` | chat body: `message`, optional `patientId/sessionId`; readiness no body | `message.content`, `message.explanation`, `citations(page/pages/snippet/snippetCount)`, `evidenceGate`, `dataFreshness`, `degradedReason` | `src/pages/patient-detail.tsx:473`, `src/lib/api/ai.ts:225` |
| `/patient/:id` (AI clinical tools) | summary/explanation/guideline/decision | `POST /api/v1/clinical/summary`, `/explanation`, `/guideline`, `/decision` | requires `patient_id`; scenario/topic/question payloads | rich markdown output + `safetyWarnings` + `dataFreshness` + `sources` | `src/components/patient/patient-summary-tab.tsx`, `src/lib/api/ai.ts:394` |
| `/patient/:id` (medical records) | draft polishing + save note | `POST /api/v1/clinical/polish`, `POST /patients/{id}/messages` | polish: `patient_id`,`content`,`polish_type`; message: `content`,`messageType` | polished text for preview + persisted record into message stream | `src/components/medical-records.tsx`, `src/lib/api/ai.ts:502`, `src/lib/api/messages.ts:65` |
| `/patient/:id` (pharmacist widget) | polish recommendation + persist coded advice | `POST /api/v1/clinical/polish`, `POST /pharmacy/advice-records` | advice requires `patientId`,`adviceCode`,`adviceLabel`,`category`,`content` | successful create drives downstream statistics | `src/components/pharmacist-advice-widget.tsx:167`, `src/lib/api/pharmacy.ts:200` |
| `/chat` | team collaboration channel | `GET /team/chat`, `POST /team/chat`, `PATCH /team/chat/{id}/pin` | content text, optional pinned flag | ordered message list with author role and pinned state | `src/pages/chat.tsx:9`, `src/lib/api/team-chat.ts:29` |
| `/admin/audit` | audit log browsing | `GET /admin/audit-logs` | pagination/filter params | logs + aggregate stats | `src/pages/admin/placeholder.tsx:15`, `src/lib/api/admin.ts:51` |
| `/admin/users` | user lifecycle management | `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/{id}` | create requires `username/name/password`; update includes role/unit/active | user table + role/status badges + counts | `src/pages/admin/users.tsx:3`, `src/lib/api/admin.ts:92` |
| `/admin/vectors` | RAG KB operations | `GET /admin/vectors`, `POST /admin/vectors/upload`, `POST /admin/vectors/rebuild` | multipart upload with `file`, `collection`, optional `metadata` | vector DB health: `documentCount/chunkCount/status/model` | `src/pages/admin/vectors.tsx:28`, `src/lib/api/admin.ts:169` |
| `/admin/statistics` | pharmacist intervention aggregate | `GET /pharmacy/advice-records/stats` | optional `month` | `total/byCategory/byCode/byPharmacist` | `src/pages/admin/statistics.tsx:8`, `src/lib/api/pharmacy.ts:217` |
| `/pharmacy/workstation` | comprehensive med review | `GET /patients`, `GET /patients/{id}/lab-data/latest`, `GET /patients/{id}/vital-signs/latest`, `GET /patients/{id}/medications`, `POST /api/v1/clinical/interactions`, `POST /api/v1/clinical/dose`, `POST /pharmacy/advice-records`; fallback `GET /pharmacy/drug-interactions`, `GET /pharmacy/iv-compatibility` | patient context + drug list + optional dose target | interaction findings, dosage safety warnings, structured recommendation save | `src/pages/pharmacy/workstation.tsx:225`, `src/pages/pharmacy/workstation.tsx:293` |
| `/pharmacy/interactions` | ad hoc DDI query | `POST /api/v1/clinical/interactions` with fallback `GET /pharmacy/drug-interactions` | `drug_list` min 2 | severity, mechanism, effect, recommended action | `src/pages/pharmacy/interactions.tsx:43`, `src/pages/pharmacy/interactions.tsx:60` |
| `/pharmacy/compatibility` | IV compatibility check + favorites | `GET /pharmacy/iv-compatibility`, `GET/POST/DELETE /pharmacy/compatibility-favorites` | required `drugA/drugB`; optional `solution` | compatibility result (`compatible`,`timeStability`,`notes`,`references`) + favorites list | `src/pages/pharmacy/compatibility.tsx:142`, `src/lib/api/pharmacy.ts:113` |
| `/pharmacy/dosage` | dosage calculator | `POST /api/v1/clinical/dose` | `drug`, optional `indication`, `patient_context` | `computed_values`, `calculation_steps`, `safety_warnings`, `confidence` | `src/pages/pharmacy/dosage.tsx:11`, `src/lib/api/ai.ts:564` |
| `/pharmacy/error-report` | med error reporting | `GET /pharmacy/error-reports`, `POST /pharmacy/error-reports` | required `errorType`,`medicationName`,`description`; optional `patientId/actionTaken/severity` | report list + stats + pending/resolved status | `src/pages/pharmacy/error-report.tsx:24`, `src/lib/api/pharmacy.ts:48` |
| `/pharmacy/advice-statistics` | monthly intervention trends | `GET /pharmacy/advice-records` | filters `month/category/page/limit` | records + category/code distribution chart data | `src/pages/pharmacy/advice-statistics.tsx:4`, `src/lib/api/pharmacy.ts:183` |

## 3) API Contract Inventory (Frontend-Critical)

| Domain | API | Backend Endpoint | Status |
|---|---|---|---|
| Auth | login/logout/refresh/me | `backend/app/routers/auth.py:52`, `backend/app/routers/auth.py:147`, `backend/app/routers/auth.py:183`, `backend/app/routers/auth.py:232` | Implemented |
| Patients | list/get/create/update/archive | `backend/app/routers/patients.py:64`, `backend/app/routers/patients.py:208`, `backend/app/routers/patients.py:147`, `backend/app/routers/patients.py:245`, `backend/app/routers/patients.py:290` | Implemented |
| Labs | latest/trends/correction | `backend/app/routers/lab_data.py:34`, `backend/app/routers/lab_data.py:55`, `backend/app/routers/lab_data.py:77` | Implemented |
| Vitals | latest/trends/history | `backend/app/routers/vital_signs.py:42`, `backend/app/routers/vital_signs.py:63`, `backend/app/routers/vital_signs.py:84` | Implemented |
| Ventilator | latest/trends/weaning get+post | `backend/app/routers/ventilator.py:61`, `backend/app/routers/ventilator.py:82`, `backend/app/routers/ventilator.py:104`, `backend/app/routers/ventilator.py:125` | Implemented |
| Messages | list/send/read | `backend/app/routers/messages.py:37`, `backend/app/routers/messages.py:62`, `backend/app/routers/messages.py:101` | Implemented |
| Team chat | list/send/pin | `backend/app/routers/team_chat.py:33`, `backend/app/routers/team_chat.py:58`, `backend/app/routers/team_chat.py:91` | Implemented |
| Dashboard | stats | `backend/app/routers/dashboard.py:18` | Implemented |
| Admin | audit/users/vectors | `backend/app/routers/admin.py:82`, `backend/app/routers/admin.py:172`, `backend/app/routers/admin.py:225`, `backend/app/routers/admin.py:296`, `backend/app/routers/admin.py:350`, `backend/app/routers/admin.py:369`, `backend/app/routers/admin.py:463` | Implemented |
| AI readiness | readiness | `backend/app/routers/ai_readiness.py:42` | Implemented |
| AI chat | chat/stream/sessions | `backend/app/routers/ai_chat.py:641`, `backend/app/routers/ai_chat.py:947`, `backend/app/routers/ai_chat.py:1012`, `backend/app/routers/ai_chat.py:1064`, `backend/app/routers/ai_chat.py:1128`, `backend/app/routers/ai_chat.py:1198` | Implemented |
| Clinical AI | summary/explanation/guideline/decision/polish/dose/interactions/query | `backend/app/routers/clinical.py:247`, `backend/app/routers/clinical.py:283`, `backend/app/routers/clinical.py:326`, `backend/app/routers/clinical.py:399`, `backend/app/routers/clinical.py:465`, `backend/app/routers/clinical.py:513`, `backend/app/routers/clinical.py:553`, `backend/app/routers/clinical.py:592` | Implemented |
| Pharmacy | error-reports, interactions, iv-compatibility, favorites, advice records/stats | `backend/app/routers/pharmacy_routes/error_reports.py:40`, `backend/app/routers/pharmacy_routes/interactions.py:14`, `backend/app/routers/pharmacy_routes/interactions.py:56`, `backend/app/routers/pharmacy_routes/compatibility_favorites.py:46`, `backend/app/routers/pharmacy_routes/compatibility_favorites.py:63`, `backend/app/routers/pharmacy_routes/compatibility_favorites.py:104`, `backend/app/routers/pharmacy_routes/advice_records.py:51`, `backend/app/routers/pharmacy_routes/advice_records.py:96`, `backend/app/routers/pharmacy_routes/advice_records.py:171` | Implemented |

## 4) Findings: Contract Gaps and Risks (from FE demand)

### P0

1. FE API wrapper defines medication endpoints not implemented in backend:
   - FE expects:
     - `GET /patients/{patientId}/medications/{medicationId}` (`src/lib/api/medications.ts:94`)
     - `GET /patients/{patientId}/medications/{medicationId}/administrations` (`src/lib/api/medications.ts:110`)
     - `PATCH /patients/{patientId}/medications/{medicationId}/administrations/{administrationId}` (`src/lib/api/medications.ts:123`)
   - Backend currently only has list/create/update at collection + item patch:
     - `backend/app/routers/medications.py:43`
     - `backend/app/routers/medications.py:98`
     - `backend/app/routers/medications.py:137`
   - Impact: wrapper-contract and backend-contract are inconsistent; future UI usage will hard fail.

### P1

1. Vitals history query parameter mismatch:
   - FE sends `startDate/endDate` in query (`src/lib/api/vital-signs.ts:79`)
   - Backend history endpoint accepts only `page/limit` (`backend/app/routers/vital_signs.py:84`)
   - Impact: filter UI assumptions are silently ignored.

2. Raw `apiClient` direct calls bypass typed API contract:
   - `src/pages/pharmacy/workstation.tsx:248`
   - `src/pages/pharmacy/workstation.tsx:293`
   - `src/pages/pharmacy/interactions.tsx:60`
   - `src/pages/pharmacy/compatibility.tsx:142`
   - Impact: harder to enforce request/response contract centralization and schema validation.

3. Dashboard stats uses manual fallback parsing instead of strict envelope contract:
   - `src/lib/api/dashboard.ts:36`
   - Impact: contract drift can be hidden because invalid envelopes are coerced to defaults.

## 5) Outputs for Next Phases

- This file is the baseline input for:
  - `reports/phase-2-contract-matrix.md`
  - `reports/phase-3-field-lineage-matrix.md`
  - `reports/phase-4-mock-fake-risk-register.md`
