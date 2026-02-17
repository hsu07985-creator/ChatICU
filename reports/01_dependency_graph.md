# Phase 1 — Usage Evidence Graph

Generated at: 2026-02-16 15:59:49

## Static Dependency Evidence
- Frontend entry chain: `src/main.tsx` -> `src/App.tsx` -> `src/pages/*` -> `src/lib/api/*`.
- Backend entry chain: `backend/app/main.py` -> `backend/app/routers/*` -> `backend/app/services/*` + `backend/app/models/*`.
- Import evidence computed from local `import/require` (TS/JS) and `from app...`/`import app...` (Python).

## Dynamic Execution Evidence
- `npm run test:e2e -- --project=chromium --workers=1`
- `backend/.venv312/bin/python -m pytest backend/tests/test_api -q`
- `npm run typecheck`

## Config and Deployment Evidence
- CI workflow: `.github/workflows/ci.yml` (contract tests, integration tests, e2e smoke, static guards).
- Runtime scripts: `package.json` and `backend/pyproject.toml`.
- Container orchestration: `backend/docker-compose.yml`.

## Backend Router Prefix Map
| Router File | Prefix |
|---|---|
| `backend/app/routers/admin.py` | `/admin` |
| `backend/app/routers/ai_chat.py` | `/ai` |
| `backend/app/routers/auth.py` | `/auth` |
| `backend/app/routers/clinical.py` | `/api/v1/clinical` |
| `backend/app/routers/dashboard.py` | `/dashboard` |
| `backend/app/routers/lab_data.py` | `/patients/{patient_id}/lab-data` |
| `backend/app/routers/medications.py` | `/patients/{patient_id}/medications` |
| `backend/app/routers/messages.py` | `/patients/{patient_id}/messages` |
| `backend/app/routers/patients.py` | `/patients` |
| `backend/app/routers/pharmacy.py` | `/pharmacy` |
| `backend/app/routers/rag.py` | `/api/v1/rag` |
| `backend/app/routers/rules.py` | `/api/v1/rules` |
| `backend/app/routers/team_chat.py` | `/team/chat` |
| `backend/app/routers/ventilator.py` | `/patients/{patient_id}/ventilator` |
| `backend/app/routers/vital_signs.py` | `/patients/{patient_id}/vital-signs` |

## Frontend API Client Endpoint Map (sample)
| API Client File | Endpoints (sample) |
|---|---|
| `src/lib/api/admin.ts` | `/admin/audit-logs, /admin/users, /admin/vectors, /admin/vectors/rebuild` |
| `src/lib/api/ai.ts` | `/ai/chat, /api/v1/clinical/clinical-query, /api/v1/clinical/decision, /api/v1/clinical/dose, /api/v1/clinical/explanation, /api/v1/clinical/guideline, /api/v1/clinical/interactions, /api/v1/clinical/polish, /api/v1/clinical/summary, /api/v1/rag/status` |
| `src/lib/api/auth.ts` | `/auth/login, /auth/logout, /auth/me, /auth/refresh` |
| `src/lib/api/dashboard.ts` | `/dashboard/stats` |
| `src/lib/api/health.ts` | `/health` |
| `src/lib/api/patients.ts` | `/patients` |
| `src/lib/api/pharmacy.ts` | `/pharmacy/advice-records, /pharmacy/advice-records/stats, /pharmacy/advice-statistics, /pharmacy/compatibility-favorites, /pharmacy/error-reports` |
| `src/lib/api/team-chat.ts` | `/team/chat` |

## Data Flow Evidence
1. UI Trigger: `src/pages/*` and `src/components/*` call `src/lib/api/*.ts` functions.
2. API Client: `src/lib/api-client.ts` sends HTTP requests with auth token and unified error handling.
3. Backend Route: `backend/app/main.py` mounts routers from `backend/app/routers/*`.
4. Service/DB/AI: routers call `backend/app/services/*`, SQLAlchemy models in `backend/app/models/*`, and AI helpers (`backend/app/llm.py`, `backend/app/services/llm_services/*`, `backend/app/services/evidence_client.py`).
