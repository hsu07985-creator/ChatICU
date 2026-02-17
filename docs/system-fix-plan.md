# ChatICU System Fix Plan (Full-Stack + ICU UX/Clinical)

> Date: 2026-02-15
> Scope: Frontend `src/` + Backend `backend/` + Docs
> Goal: Remove clinical workflow blockers, eliminate misleading UI, align safety/compliance signals, and make the system maintainable.

## Guiding Principles

1. Patient safety first: anything that can mislead clinical decisions is P0.
2. No "fake" behavior: buttons must either work or be removed/disabled with explicit messaging.
3. Single source of truth: sessions/messages come from backend; frontend doesn't invent IDs.
4. Safety signals must be visible: warnings and expert-review flags are shown consistently.
5. Docs must match code: audit/tracker becomes a living artifact.

## Phase A (P0) Clinical Workflow Blockers

### A1. Fix Chat Session + History (must be reliable)

- Frontend must send `sessionId` on follow-up messages.
- Clicking a session must load message history via `GET /ai/sessions/{id}`.
- Optional: allow user to set a session title; requires backend `PATCH /ai/sessions/{id}`.

Acceptance:
- A new chat creates a backend session; subsequent messages append to the same session.
- Session list reflects updates; selecting a session shows full message history.

### A2. Fix Dead Buttons / Misleading UI

- Patient detail / meds tab "交互作用查詢" must navigate to `/pharmacy/interactions`.
- Any remaining dead buttons must be removed or made explicit (disabled + tooltip).

Acceptance:
- No major clinical workflow button does nothing.

### A3. Safety Warnings Must Not Duplicate / Disappear

- Backend guardrail returns warnings separately and should not inject warning blocks into content.
- Frontend renders warnings in a dedicated component for clinical tools and chat.
- `requiresExpertReview` must be surfaced for chat.

Acceptance:
- Warnings appear exactly once (consistent UI), and the clinician can see expert-review flags.

### A4. LLM Missing-Key UX (must not leak provider payloads)

- If `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is missing, the system must:
  - Return a clear actionable message ("set key in backend/.env and restart").
  - Avoid showing raw upstream payloads (e.g. OpenAI 401 JSON) in UI content.
  - Keep chat usable (persist the session + show system message).

Acceptance:
- Chat shows a friendly configuration message (not raw provider JSON).
- Clinical AI endpoints return `503 SERVICE_UNAVAILABLE` with actionable message.

### A5. Pharmacist Workflow Must Not Be "Fake"

- Pharmacy workstation "全面評估" must call real APIs:
  - Interactions: `POST /api/v1/clinical/interactions` (func), fallback to `/pharmacy/drug-interactions`.
  - IV compatibility: `GET /pharmacy/iv-compatibility`.
  - Dose: `POST /api/v1/clinical/dose` (func); if func is down show explicit degradation message.
- Advice submission must persist to `POST /pharmacy/advice-records`.
- Sidebar must expose pharmacy tools pages for pharmacist/admin.

Acceptance:
- No workstation action is toast-only; all actions either persist or clearly state why they can't.

## Phase B (P1) Docs + Maintenance Hygiene

### B1. Security Hygiene

- Ensure `.env` files are ignored and provide `.env.example` only.
- Document key rotation and local dev setup.

### B2. Documentation Sync

- Update `docs/frontend-data-inventory.md` and `docs/ai-integration-plan.md` to reflect current behavior.
- Keep `_archive_candidates/20260216/AI_TASK_TRACKER.md` consistent with actual code.

## Phase C (P2) Quality Gates

- Add a typecheck gate (`typescript` + `tsconfig.json` + `npm run typecheck`) if not present.
- Add minimal E2E UI flow test for chat session continuity (Playwright).
