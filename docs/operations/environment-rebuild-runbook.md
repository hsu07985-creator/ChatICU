# Environment Rebuild Runbook (T22)

## Purpose
Rebuild ChatICU from a clean machine using locked dependencies and CI-aligned versions.

## Baseline
- OS: macOS/Linux
- Python: 3.12
- Node.js: 20
- Docker: latest stable

## Steps
1. Clone repository and checkout target commit.
2. Verify lockfiles:
   - `backend/requirements.lock`
   - `package-lock.json`
3. Backend setup:
   - `cd backend`
   - `python -m venv .venv312`
   - `source .venv312/bin/activate`
   - `pip install -r requirements.lock`
4. Migration check:
   - set `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`
   - `python -m alembic upgrade head`
5. Seed test data:
   - `python -m seeds.seed_data`
6. Frontend setup:
   - `cd ..`
   - `npm ci`
   - `npm run build`
7. Backend tests:
   - `cd backend && python -m pytest tests/ -q`
8. E2E smoke:
   - start backend/frontend
   - `npm run test:e2e -- --project=chromium --grep "@critical"`

## CI Evidence Mapping
- Full green run: `22031771983`
- Reproducibility artifact: `reproducibility-report`
- Local report reference:
  - `docs/operations/reproducibility-reports/2026-02-15-run-22031771983.md`

## Acceptance
- Backend tests pass
- Frontend build pass
- Migration apply cleanly
- Critical E2E pass
- DAST gate pass (High == 0)
