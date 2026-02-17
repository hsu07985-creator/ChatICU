# Pharmacy Center Task Tracker (API-Backed + ICU UX)

> Date: 2026-02-15  
> Scope: Pharmacist Center (`/pharmacy/*` + pharmacist widgets) + Admin statistics + Patient CRUD wiring  
> Goal: No misleading UI. Persisted actions must survive reload. ICU-friendly presentation.

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

---

## P0 (No Fake + Persistence)

- [x] **P0-1** Persist IV compatibility favorites server-side (per user)
  - BE: add table + CRUD endpoints under `/pharmacy/compatibility-favorites`
  - FE: replace `localStorage` favorites with API-backed favorites
  - DoD: favorites persist after reload and across browsers/devices for the same account

- [x] **P0-2** Advice record auto-posts to patient board (`medication-advice`)
  - BE: when `POST /pharmacy/advice-records` succeeds, create `POST /patients/{id}/messages` equivalent in the same transaction
  - FE: update success copy to state “已同步至留言板”
  - DoD: after saving advice, the message appears in `留言板` after reload

- [x] **P0-3** Patient list: implement “新增病人” and “封存病人”
  - FE: add dialogs, wire to existing backend `POST /patients` and `PATCH /patients/{id}/archive`
  - BE: make archive endpoint idempotent (accept explicit `archived: bool`) to avoid toggle surprises
  - DoD: create patient succeeds; archive removes from list after refresh; no 422 from request shape mismatch

---

## P1 (Correctness + Consistency)

- [x] **P1-1** Fix patient create/update request shapes (camelCase vs snake_case)
  - FE: map request bodies to backend schema (snake_case)
  - BE: allow updating fields that UI already edits (admission dates, ICU dates, MRN if needed)
  - DoD: editing patient fields actually persists and is reflected in subsequent loads

- [x] **P1-2** Remove duplicated pharmacy “master data” definitions across pages
  - FE: centralize fixed lists (23 codes, response codes, solution list, error type/severity) into a single module and reuse
  - DoD: no duplicated code lists across workstation/widget/statistics/error-report/compatibility pages

---

## P2 (Admin Statistics)

- [x] **P2-1** Rebuild `src/pages/admin/statistics.tsx` to use real advice record stats
  - BE: add an aggregated stats endpoint for advice records (by month/category/code/pharmacist)
  - FE: redesign admin stats UI to reflect backend data (no placeholder 0 counts)
  - DoD: admin stats page renders with real numbers and is reachable via route + sidebar

---

## Verification

- [x] Backend: `cd backend && .venv312/bin/python -m pytest -q`
- [x] Frontend: `npm run typecheck && npm run build`
- [x] E2E: `npx playwright test --reporter=list` (update pharmacy spec if needed)
