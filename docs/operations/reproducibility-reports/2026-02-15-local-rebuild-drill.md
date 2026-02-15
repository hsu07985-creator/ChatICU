# T22 Local Rebuild Drill Report

## Metadata
- Date: 2026-02-15
- Branch: `main`
- Evidence type: local command-run drill (paired with CI run `22033478586`)

## Commands and Results
1. Environment versions
   - `python3 --version` -> `Python 3.14.3`
   - `node --version` -> `v24.13.1`
   - `npm --version` -> `11.8.0`
   - `docker --version` -> `Docker version 29.2.1`

2. Lockfile hash check
   - `backend/requirements.lock`: `27843f95e2fbcf220ee9f31a010ffa70f43d3f122b8ccea17952e7c6baef60ec`
   - `package-lock.json`: `0b716fb398db88b95517eca7e3c1dc58a43f9367f9298d9359fc0a899c804089`

3. Backend schema hardening tests
   - Command: `cd backend && .venv312/bin/pytest -q tests/test_schemas/test_validation_hardening.py`
   - Result: `6 passed`

4. Frontend reproducibility check
   - Command: `npm ci`
   - Result: pass (195 packages installed)
   - Command: `npm run build`
   - Result: pass (`vite build` success)

5. Migration drill
   - SQLite attempt: failed (expected) because migration contains PostgreSQL `JSONB`
   - PostgreSQL run:
     - Command: `cd backend && DATABASE_URL=postgresql+asyncpg://chaticu:chaticu_password@localhost:5432/chaticu .venv312/bin/python -m alembic upgrade head`
     - Result: pass (`Context impl PostgresqlImpl`)

6. Seed drill
   - Command: `cd backend && ... .venv312/bin/python -m seeds.seed_data`
   - Result: pass (`Seed completed successfully!`)

## Conclusion
- Local rebuild drill completed with CI-aligned flow and successful migration/seed validation on PostgreSQL.
- Reference CI run: `22033478586` (full green, includes critical+extended E2E and DAST gate).
