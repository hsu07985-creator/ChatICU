# T27 Integration Remediation Task Board

Date: 2026-02-16
Owner: Codex
Scope: Stabilize extended E2E login flow and eliminate runtime crash risk (`reading 'total'`)

## Ordered Tasks

1. `COMPLETE` Baseline + acceptance definition
- Goal: Lock execution order and pass criteria.
- Evidence:
  - `npm run test:e2e -- --project=chromium --workers=1 --grep "@t27-extended"` => `1 passed, 2 failed`.
  - Failures stuck at `/login` in:
    - `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/e2e/t27-extended-journeys.spec.js:42`
    - `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/e2e/t27-extended-journeys.spec.js:74`
- Gate:
  - Task board + ordered plan committed in report.

2. `COMPLETE` Fix deterministic login in E2E
- Goal: Prevent auth request interruption before route transition.
- Planned changes:
  - Add helper that waits for `/auth/login` response + post-login URL/token readiness.
  - Refactor all flows in `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/e2e/t27-extended-journeys.spec.js`.
- Gate:
  - `@t27-extended` no longer fails with `/login` URL assertion.
- Final evidence:
  - `e2e/helpers/auth.js` introduced deterministic login wait on `/auth/login`.
  - `e2e/t27-extended-journeys.spec.js` migrated all login steps to `loginAndWait`.
  - Result: `@t27-extended` => `3 passed`.

3. `COMPLETE` Improve auth failure observability
- Goal: Make auth failures diagnosable by reason (401/429/network).
- Planned changes:
  - Return structured login result from auth context.
  - Show backend message in login UI.
  - Add `[INTG][API][AUTH]` tagged logs.
- Gate:
  - Login failures expose actionable reason instead of fixed generic text.
- Final evidence:
  - `src/lib/auth-context.tsx` now returns `LoginResult` with `status/message/code`.
  - `src/pages/login.tsx` now displays backend-provided error message.
  - Log tags added: `[INTG][API][AUTH]`.

4. `COMPLETE` Re-validate runtime crash (`reading 'total'`)
- Goal: Confirm and remediate remaining runtime crash path after auth stabilization.
- Planned actions:
  - Re-run trend-dialog scenario and inspect page errors.
  - If crash reproduces, patch contract guard at exact callsite.
- Gate:
  - No `Cannot read properties of undefined (reading 'total')` in T27 run.
- Final evidence:
  - `npm run test:e2e -- --project=chromium --workers=1 --grep "@t27-extended"` => `3 passed`.
  - `rg -n "reading 'total'" output/playwright/test-results output/playwright/html-report` => no matches.

5. `COMPLETE` Final acceptance
- Command set:
  - `npm run test:e2e -- --project=chromium --workers=1 --grep "@t27-extended"`
  - `npm run test:e2e -- --project=chromium --workers=1`
  - `backend/.venv312/bin/python -m pytest backend/tests/test_api/test_contract.py -q`
  - `backend/.venv312/bin/python -m pytest backend/tests/test_api -q`
- Gate:
  - `@t27-extended` all pass.
  - Full E2E core pass-rate >= 95%.
  - Contract + integration API tests pass.
- Final evidence:
  - `npm run test:e2e -- --project=chromium --workers=1 --grep "@t27-extended"` => `3 passed`.
  - `npm run test:e2e -- --project=chromium --workers=1` => `5 passed` (100%).
  - `backend/.venv312/bin/python -m pytest backend/tests/test_api/test_contract.py -q` => `18 passed`.
  - `backend/.venv312/bin/python -m pytest backend/tests/test_api -q` => `65 passed`.
