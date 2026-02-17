# Phase 2 — Target Architecture Proposal (Dry-run)

Generated at: 2026-02-16

## Target Structure

```text
/
├─ backend/                      # Active backend app (FastAPI, DB, AI routers/services)
│  ├─ app/
│  │  ├─ routers/                # API boundary (auth, dashboard, chat, clinical, pharmacy, admin)
│  │  ├─ services/               # Domain/service logic (llm, evidence client, rule engine)
│  │  ├─ models/                 # SQLAlchemy persistence models
│  │  ├─ schemas/                # Request/response contracts
│  │  └─ middleware/             # Auth, audit, rate-limit, observability
│  ├─ alembic/versions/          # Migration chain
│  └─ tests/                     # Backend contract/integration tests
├─ src/                          # Active frontend app (React/Vite)
│  ├─ pages/                     # Route-level screens
│  ├─ components/                # Reusable UI + feature components
│  └─ lib/                       # API clients, auth context, runtime helpers
├─ e2e/                          # End-to-end scenarios and helpers
├─ docs/                         # Operational/QA/architecture documentation
├─ reports/                      # Current-cycle audit and verification outputs
├─ _archive_candidates/YYYYMMDD/ # Quarantined legacy/unused candidates (no hard delete)
└─ .github/workflows/            # CI gates
```

## Module Boundaries
- Frontend UI boundary: `src/pages/*` and `src/components/*`.
- Frontend data boundary: `src/lib/api-client.ts` + `src/lib/api/*`.
- Backend API boundary: `backend/app/routers/*` mounted by `backend/app/main.py`.
- Backend domain/service boundary: `backend/app/services/*`.
- Backend persistence boundary: `backend/app/models/*` + `backend/alembic/versions/*`.
- AI boundary: `backend/app/llm.py`, `backend/app/services/llm_services/*`, `backend/app/services/evidence_client.py`, AI routers in `clinical.py` and `ai_chat.py`.

## Gate A (Dry-run) — Candidate Safety Checks

### Candidate groups with evidence
1. Legacy backend subtree candidate: `ChatICU/`
- Evidence:
  - `TASK_TRACKER.md:89-90` marks `backend/` as the only official backend and `ChatICU/` as archived reference.
  - No runtime script/CI/docker references to `ChatICU/` in active execution files (`package.json`, `.github/workflows/ci.yml`, `backend/docker-compose.yml`, `playwright.config.js`).

2. Historical generated artifacts candidates
- `patches/prompt-P00.patch` ... `patches/prompt-P09.patch`
- `reports/prompt-P00-result.md` ... `reports/prompt-P09-result.md`
- `reports/final-integration-gate.md`
- Evidence:
  - These files are generated deliverables; no active script/test/runtime import chain references.

3. Historical top-level audit notes
- `AI_AUDIT_REPORT.md`
- `AI_TASK_TRACKER.md`
- Evidence:
  - Not used by build/test/startup scripts.
  - Mentioned only as documentation context in `docs/system-fix-plan.md`.

### High-risk files (manual review required, no auto-move)
- Frontend entry/routing:
  - `src/main.tsx`
  - `src/App.tsx`
- Backend entry/router mount:
  - `backend/app/main.py`
  - `backend/app/routers/*.py`
- DB migrations:
  - `backend/alembic/versions/*.py`
- CI/deployment:
  - `.github/workflows/ci.yml`
  - `backend/docker-compose.yml`
  - `playwright.config.js`

Gate A status: PASS (all move candidates have evidence; high-risk files are excluded from move plan).
