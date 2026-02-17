# Pharmacy Center Improvement Plan (API-Backed + ICU UX + AI)

> Date: 2026-02-15
> Scope: Pharmacist-facing UI (`/pharmacy/*` + pharmacist widgets in patient detail) + related backend APIs.
> Primary Goal: Pharmacist workflows are fully real-data and persist correctly. No UI claims a feature exists unless it is backed by an API or clearly labeled as local-only.

## What "Not Hard-Coded" Means (Clarify)

1. Clinical data shown to users (patients, meds, labs/vitals, interactions, compatibility, advice records, error reports) must come from backend APIs, not from frontend templates.
2. User actions that imply persistence (save, submit, favorite, mark-read, resolve) must call an API and survive a reload.
3. Stable "master data" (e.g., 23 intervention codes) can be either:
   - Option A: versioned constants in code (single source of truth file, reused everywhere).
   - Option B: served from backend `GET /pharmacy/metadata` so UI is never hard-coded.

## Current Inventory (Pharmacist Journeys)

### Pages Under "藥事支援中心"

1. `/pharmacy/workstation`
   - API: `GET /patients`, `GET /patients/{id}/lab-data/latest`, `GET /patients/{id}/vital-signs/latest`, `POST /api/v1/clinical/interactions` (func), fallback `GET /pharmacy/drug-interactions`, `GET /pharmacy/iv-compatibility`, `POST /api/v1/clinical/dose` (func), `POST /pharmacy/advice-records`.
   - Hard-coded today:
     - 23 category/codes list (fixed master data; centralized in `src/lib/pharmacy-master-data.ts`).
     - Hepatic function (manual selection only).
   - Gaps:
     - Auto-loaded drug list uses real medication orders API (`/patients/{id}/medications?status=active`), with SAN arrays as a fallback if orders API is unavailable.
     - Advice submission auto-syncs a patient board message (`messageType=medication-advice`) for team visibility.

2. `/pharmacy/interactions`
   - API: `POST /api/v1/clinical/interactions` (func), fallback `GET /pharmacy/drug-interactions`.
   - Hard-coded today:
     - Severity mapping rules in frontend (ok).
   - Gaps:
     - No drug name autocomplete/normalization, which hurts recall and matching quality.

3. `/pharmacy/dosage`
   - API: `POST /api/v1/clinical/dose` (func).
   - Hard-coded today:
     - Hepatic function mapping (ok).
   - Gaps:
     - When func is down we show an actionable message (ok), but the page could also show a persistent inline banner rather than only toast.

4. `/pharmacy/compatibility`
   - API: `GET /pharmacy/iv-compatibility`.
   - Hard-coded today:
     - Solution dropdown values (fixed master data; centralized).
     - "常用組合快速查詢" sample buttons.
   - Persistence today:
     - "加入常用組合" is API-backed (server-side, per-user) via `/pharmacy/compatibility-favorites`.

5. `/pharmacy/error-report`
   - API: `GET /pharmacy/error-reports`, `POST /pharmacy/error-reports`, backend supports `PATCH /pharmacy/error-reports/{id}`.
   - Hard-coded today:
     - Error type list and severity labels (fixed master data; centralized).
   - Gaps:
     - Backend ignores `page/limit` even though frontend passes them.
     - UI shows "本月累計" but data is not month-scoped.
     - No UI to resolve/close a report (status + resolution) even though backend supports it.
     - Patient field is free-text "病歷號" instead of selecting a real patient (high input error risk).

6. `/pharmacy/advice-statistics`
   - API: `GET /pharmacy/advice-records` (month/category paging).
   - Hard-coded today:
     - Colors and category labels (fixed master data; centralized).
   - Gaps:
     - Backend has a confusing endpoint `GET /pharmacy/advice-statistics` that actually returns stats from error reports. This risks future misuse.

### Pharmacist Widgets in Patient Detail

1. Patient detail `用藥` tab: `PharmacistAdviceWidget`
   - API: `POST /api/v1/clinical/polish` (LLM), `POST /pharmacy/advice-records`.
   - Hard-coded today:
     - 23 category/codes list (fixed master data; centralized).
     - A-W response code list (fixed master data; centralized).
   - Notes:
     - Saving an advice record auto-syncs a patient board message of type `medication-advice`.

2. Patient detail `留言板` tab
   - API: `GET /patients/{id}/messages`, `POST /patients/{id}/messages`, backend supports `PATCH /patients/{id}/messages/{message_id}/read`.
   - Notes:
     - "全部標為已讀" is API-backed and persists after reload.

## Proposed Improvements (Grouped, With Options)

### P0: "No Fake" + API-Backed Persistence

1. Workstation uses real medication orders by default
   - FE: when patient selected, call `GET /patients/{id}/medications?status=active` and populate the drug list from returned active meds.
   - FE: keep manual add/remove as override.
   - Acceptance: workstation drug list matches patient med orders; reload preserves selected patient and last drug list (if we add save).

2. Patient message board: implement real "mark all read"
   - FE: call `PATCH /patients/{id}/messages/{message_id}/read` for unread messages, then refresh list.
   - Optional BE: add `PATCH /patients/{id}/messages/read-all` for efficiency.
   - Acceptance: unread badge decreases after reload.

3. Error report page: make stats truthful and add resolve workflow
   - BE: implement pagination (`page`, `limit`) and optional `from/to` date filters.
   - FE: change "本月累計" label to reflect actual filter, or implement month filter.
   - FE: add "標記已處理" + resolution note (calls `PATCH /pharmacy/error-reports/{id}`).
   - Acceptance: pharmacist can resolve a report and see it reflected after reload.

4. Compatibility favorites: decide on persistence scope
   - Option A (fast): keep localStorage, but label it explicitly "保存在本機瀏覽器".
   - Option B (API-backed): create `pharmacy_favorites` table + APIs, persist per-user server-side.
   - Acceptance: favorites persist according to chosen scope.

### P1: Remove Hard-Coded Master Data (If Required)

1. Add `GET /pharmacy/metadata`
   - Return: solutions, error types, severity levels, advice categories/codes, response code sets, recommended quick pairs.
   - FE: all selects and code lists load from this endpoint.
   - Acceptance: changing metadata in backend updates UI without frontend rebuild.

2. Deduplicate code lists
   - Even if not using metadata API, move constants to `src/features/pharmacy/metadata.ts` and reuse in workstation/widget/stats.
   - Acceptance: no duplicated category/code definitions across files.

### P2: ICU UX + Visual Improvements (High Value)

1. Workstation triage layout for ICU use
   - Left: patient context (weight, allergies, eGFR/K/Mg, BP/HR/RR, last updated timestamps).
   - Middle: medication orders with filters (active only, SAN grouping, search).
   - Right: results with a "risk-first" view (High severity first, collapse low).
   - Acceptance: in 30 seconds, pharmacist can identify high-risk issues and produce a shareable note.

2. Improve readability and trust
   - Consistent date/time formatting (no raw ISO strings in tables).
   - Inline empty-states explain why data is missing and what to do next.
   - Make evidence references actionable (open URL or copy reference).

3. Accessibility and interaction
   - Ensure all icon-only buttons have `aria-label`.
   - Add keyboard flow for select inputs and dialogs.

### P3: Real AI Features (Clearly Labeled, Safe Defaults)

1. "AI Draft Pharmacist Advice" (workstation)
   - Backend endpoint (proposal): `POST /api/v1/pharmacy/advice-draft`
   - Inputs: patientId, selected meds, latest labs/vitals, interaction/compatibility/dose results.
   - Output: structured suggestion + `safetyWarnings`.
   - FE: render with `AiMarkdown` + `SafetyWarnings`, plus a "needs clinician review" banner.
   - Acceptance: generates a draft note that pharmacist can edit, then submit to advice record + (optional) patient message board.

2. "AI Explain" buttons on results
   - Interactions/Compatibility/Dose: one-click explanation for nurses/doctors, with disclaimers.

## Decision Points (Need Your Confirmation)

> ✅ Decisions confirmed (2026-02-15)

1. Master data (23 intervention codes + response codes + solution list + error type/severity) is fixed. We'll treat it as versioned constants (single source of truth in code), not backend-driven metadata.
2. Compatibility favorites must be server-side persisted (shared across devices/browsers per user).
3. When pharmacist saves/submits an advice record, the system must automatically post a patient message (`messageType=medication-advice`) to the board for team visibility.
4. `src/pages/admin/statistics.tsx` must be rebuilt to use real data (no placeholder 0 counts).
5. Patient list "新增/封存病人" must be real (wired to backend APIs). Fields should match what the current frontend already displays/edits.
