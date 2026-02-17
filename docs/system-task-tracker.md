# System Task Tracker

> Date: 2026-02-15
> Owner: Full-stack + ICU UX/Clinical team

## P0 (Must Fix)

- [x] Chat: send `sessionId` on follow-up messages (FE)
- [x] Chat: session list click loads history from backend (FE)
- [x] Chat: allow setting session title (BE `PATCH /ai/sessions/{id}` + FE wiring)
- [x] Chat: render `safetyWarnings` + `requiresExpertReview` in UI
- [x] Chat: when LLM is not configured (missing `OPENAI_API_KEY`), return a user-safe message (avoid leaking raw provider errors) and keep session usable
- [x] Guardrail: stop injecting warning blocks into `content` (avoid duplication)
- [x] Patient detail meds: "交互作用查詢" button works (navigate)
- [x] Pharmacy interactions: remove/repurpose dead "新增藥品" button
- [x] Pharmacy: Workstation "全面評估" uses real APIs (interactions/dose/IV compatibility) with graceful fallback when func is down
- [x] Pharmacy: Advice submission persists to backend (`POST /pharmacy/advice-records`)
- [x] Pharmacy: Sidebar exposes pharmacy tools pages (interactions/dosage/compatibility/error-report/statistics)
- [x] PharmacistAdviceWidget: "儲存用藥建議" persists to backend (`POST /pharmacy/advice-records`)
- [x] Verify: backend tests pass; frontend build passes

## P1 (Docs / Security Hygiene)

- [x] Remove secrets from local `.env` templates; confirm `.gitignore` covers env files
- [ ] Rotate any leaked keys (operational; runbook: `docs/operations/key-rotation-runbook.md`, pending console execution)
- [x] Publish key rotation runbook + verification checklist (`docs/operations/key-rotation-runbook.md`)
- [x] Add one-command acceptance generator (`scripts/ops/run_key_rotation_acceptance.sh`)
- [x] Generate acceptance report (`reports/operations/key-rotation-acceptance-20260216T112413Z.md`) with automated PASS checks
- [x] Update `docs/frontend-data-inventory.md` to reflect real system behavior
- [x] Update `docs/ai-integration-plan.md` to reflect Phase status accurately

## P2 (Quality Gates)

- [x] Add `typescript` + `tsconfig.json` + `npm run typecheck`
- [x] Add Playwright smoke test: login + open patient + send chat + reload session history
- [x] Playwright spec: `e2e/critical-journey.spec.js`
- [x] Playwright config: `playwright.config.js` (defaults to `http://127.0.0.1:3000` locally, system Chrome)
- [x] Verified: `npx playwright test e2e/critical-journey.spec.js --reporter=list`
