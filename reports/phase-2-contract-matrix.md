# Phase 2 Contract Matrix

Generated at: 2026-02-17 12:39 CST
Input baseline: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-1-frontend-requirement-catalog.md`

## 1) Matrix Legend

- `MATCH`: Frontend contract and backend implementation align (path/method/payload/response envelope).
- `PARTIAL`: Endpoint exists but contract details are not fully aligned (query/payload semantics or wrapper bypass risk).
- `MISSING`: Frontend contract exists but backend endpoint is absent.

## 2) Frontend vs Backend Contract Matrix

| Domain | FE Wrapper Contract | Backend Contract | Status | Priority | Evidence |
|---|---|---|---|---|---|
| Medications | `GET /patients/{patientId}/medications/{medicationId}` | Implemented in medications router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/medications.ts:93`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:172` |
| Medications | `GET /patients/{patientId}/medications/{medicationId}/administrations` | Implemented in medications router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/medications.ts:101`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:184` |
| Medications | `PATCH /patients/{patientId}/medications/{medicationId}/administrations/{administrationId}` | Implemented in medications router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/medications.ts:117`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:284` |
| Auth | `/auth/login` `/auth/logout` `/auth/refresh` `/auth/me` | Implemented in auth router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/auth.ts:25`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/auth.py:52` |
| Patients | `GET/POST/PATCH /patients`, `PATCH /patients/{id}/archive` | Implemented in patients router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/patients.ts:70`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/patients.py:64` |
| Dashboard | `GET /dashboard/stats` | Implemented in dashboard router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/dashboard.ts:35`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/dashboard.py:18` |
| Lab Data | `GET latest`, `GET trends`, `PATCH correct` | Implemented in lab-data router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/lab-data.ts:79`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/lab_data.py:34` |
| Vital Signs | `GET latest`, `GET trends`, `GET history(startDate,endDate,page,limit)` | `GET history(page,limit,startDate,endDate)` implemented | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/vital-signs.ts:69`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/vital_signs.py:82` |
| Ventilator | `GET latest`, `GET trends`, `GET/POST weaning-assessment` | Implemented in ventilator router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/ventilator.ts:59`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ventilator.py:61` |
| Patient Messages | `GET/POST messages`, `PATCH read` | Implemented in messages router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/messages.ts:44`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/messages.py:37` |
| Team Chat | `GET/POST`, `PATCH pin` | Implemented in team-chat router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/team-chat.ts:29`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/team_chat.py:33` |
| Admin Users | `GET/POST/PATCH /admin/users` + detail | Implemented in admin router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/admin.ts:91`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/admin.py:172` |
| Admin Audit | `GET /admin/audit-logs` | Implemented in admin router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/admin.ts:50`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/admin.py:82` |
| Admin Vectors | `GET /admin/vectors`, `POST /admin/vectors/upload`, `POST /admin/vectors/rebuild` | Implemented in admin router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/admin.ts:168`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/admin.py:350` |
| AI Readiness | `GET /api/v1/ai/readiness` | Implemented in ai_readiness router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/ai.ts:167`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_readiness.py:42` |
| AI Chat | `/ai/chat`, `/ai/chat/stream`, `/ai/sessions*` | Implemented in ai_chat router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/ai.ts:186`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:641` |
| Clinical AI | `/api/v1/clinical/{summary,explanation,guideline,decision,polish,dose,interactions,clinical-query}` | Implemented in clinical router | MATCH | P0 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/ai.ts:393`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/clinical.py:247` |
| RAG Status | `GET /api/v1/rag/status` | Implemented in rag router | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/ai.ts:521`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/rag.py:165` |
| Pharmacy Error Reports | `GET/POST/PATCH /pharmacy/error-reports`, `GET by id` | Implemented in pharmacy routes | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/pharmacy.ts:47`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/pharmacy_routes/error_reports.py:40` |
| Pharmacy Compatibility | `GET /pharmacy/iv-compatibility`, favorites CRUD | Implemented in pharmacy routes | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/pharmacy.ts:112`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/pharmacy_routes/interactions.py:56` |
| Pharmacy Advice | `GET/POST /pharmacy/advice-records`, `GET /stats`, `GET /advice-statistics` | Implemented in pharmacy routes | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/pharmacy.ts:147`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/pharmacy_routes/advice_records.py:51` |
| Pharmacy pages direct API usage | Pharmacy pages consume wrapper APIs (`getDrugInteractions`, `getIVCompatibility`) | Wrapper endpoints implemented in `src/lib/api/pharmacy.ts` and adopted by pages | MATCH | P1 | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/pharmacy.ts:153`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/pharmacy/workstation.tsx:8`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/pharmacy/interactions.tsx:11`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/pharmacy/compatibility.tsx:14` |

## 3) P0 Contract Gap Remediation Status

1. `GET /patients/{patientId}/medications/{medicationId}`: Completed
2. `GET /patients/{patientId}/medications/{medicationId}/administrations`: Completed
3. `PATCH /patients/{patientId}/medications/{medicationId}/administrations/{administrationId}`: Completed

## 4) Verification Targets for Phase 2 Exit

- Backend route availability + envelope consistency:
  - `success=true` + `data` on 200 responses.
  - 404/422 keep global error envelope (`success=false`, `error`, `message`, `request_id`, `trace_id`).
- FE wrapper compatibility:
  - `getMedication()` receives `Medication` object.
  - `getMedicationAdministrations()` receives `MedicationAdministration[]`.
  - `recordAdministration()` returns updated `MedicationAdministration`.
- Verification evidence:
  - Automated tests: `backend/tests/test_api/test_medications_api.py` (pass)
  - Automated tests: `backend/tests/test_api/test_contract.py::test_vital_signs_history_supports_start_end_date_filters` (pass)
  - Frontend validation: `npm run typecheck` (pass), `npm run build` (pass)
  - Manual API flow: `reports/operations/manual-api-phase2-medications-20260217T043002Z/`
  - Manual API flow: `reports/operations/manual-api-phase2-vitals-history-20260217T044226Z-with-data/`

## 5) Current Gate

- `Phase 2`: Completed (matrix + P0 medications gap remediation verified).
