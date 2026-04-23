# Frontend Task Queue

> This file is the coordination channel FROM backend TO frontend.
> Backend session adds tasks here. Frontend session picks them up.

## How to use
- Backend: Add new tasks with `[READY]` status when an API is available
- Frontend: Change `[READY]` → `[IN-PROGRESS]` when you start, `[DONE]` when finished
- Move completed tasks to the "Completed" section at the bottom

---

## Pending Tasks

### Phase 1-2 — Foundation + Core Integration

### F01 [READY] Add NHI reimbursement query UI to pharmacy workstation
- **Added by:** architecture plan (G3 gap — NHI has no UI)
- **Endpoint ready since:** 2026-03-02
- **API contract:** See api-contracts.md — `POST /api/v1/clinical/nhi`
- **Date:** 2026-03-02
- **Priority:** P1
- **Files:** `src/pages/pharmacy/workstation.tsx` (modify), possibly new component
- **Description:**
  - B08 is now complete. The `POST /api/v1/clinical/nhi` endpoint is live.
  - Add a "健保查詢" tab/section to the pharmacy workstation
  - Input: drug name (with autocomplete from existing drug list)
  - Display: `reimbursement_rules[]` (section, conditions, prior auth badge), `source_chunks[]`, `confidence` score, `answer` text
  - If `message` field is present in response, show it as an amber warning banner ("NHI 服務暫時無法連線，此回答僅供參考")
  - Support Chinese and English drug name input (backend handles 35-entry mapping table)
  - `drug_name_zh` field in response can be shown as subtitle (e.g., "pembrolizumab (吉舒達)")
  - `requires_prior_auth: true` → show a red "需事前審查" badge on the rule card
- **References:** architecture plan §1.3 G3, §1.4 row "健保給付", api-contracts.md B08 section

### F02 [TODO] Display source attribution / citations in AI response cards
- **Added by:** architecture plan (G6 gap — no source attribution)
- **Date:** 2026-03-02
- **Priority:** P1
- **Blocked by:** B11 (backend citation field not yet added)
- **Files:** `src/components/patient/patient-summary-tab.tsx`, `src/components/patient/patient-chat-tab.tsx` (modify)
- **Description:**
  - Currently AI responses show no source information (gap G6)
  - When `citations[]` array is present in API response, render collapsible "來源" section below answer
  - Each citation shows: source system badge (指引/藥品DB/交互作用圖), text snippet, evidence grade
  - Source system color coding: Guideline=blue, Drug DB=green, Graph=orange
  - Graceful: if no citations, don't show the section (backward compatible)
- **API schema:** `citations: [{source_system, text_snippet, evidence_grade, relevance_score}]`
- **References:** architecture plan §6.2

### F03 [TODO] Add confidence indicator to clinical AI responses
- **Added by:** architecture plan (G7 gap — single global threshold)
- **Date:** 2026-03-02
- **Priority:** P2
- **Blocked by:** B05+B06 (orchestrator confidence scoring)
- **Files:** `src/components/patient/patient-summary-tab.tsx` (modify)
- **Description:**
  - When API response includes `confidence` field (0.0–1.0), show visual indicator
  - High (≥0.75): green checkmark + "高信心"
  - Medium (0.50–0.74): yellow dot + "中等信心"
  - Low (<0.50): red warning + "低信心 — 建議諮詢專科"
  - Per-intent display: dose/IV answers show stricter messaging
- **References:** architecture plan §6.3, §7.3

### F04 [TODO] Add "requires expert review" warning banner
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P1
- **Blocked by:** B05 (orchestrator needs to return `requires_expert_review` flag)
- **Files:** `src/components/patient/patient-summary-tab.tsx`, `src/components/patient/patient-chat-tab.tsx` (modify)
- **Description:**
  - When `requires_expert_review: true` in API response, show prominent warning banner
  - Banner text: "⚠️ 此回答需要專家審核 — 建議由藥師或主治醫師確認後再採用"
  - Banner color: amber/orange, non-dismissible
  - Triggers: high-alert drug + dose, cross-source contradiction, confidence < 0.50, Risk X interaction, pediatric/renal/hepatic cases
- **References:** architecture plan §7.4

### F05 [READY] Integrate unified `/clinical/query` endpoint
- **Endpoint ready since:** 2026-03-02
- **API contract:** See api-contracts.md — `POST /api/v1/clinical/query`
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P0
- **Files:** `src/lib/api/ai.ts` (modify), `src/components/patient/patient-summary-tab.tsx` (modify)
- **Description:**
  - Add new API client function: `clinicalQuery(question, patientId?, context?)`
  - Response includes: `intent`, `answer`, `citations[]`, `confidence`, `requires_expert_review`, `sources_used[]`, `detected_drugs[]`
  - Wire into existing clinical AI tools in patient summary tab
  - Feature flag: check if orchestrator is enabled (based on response); if not, fall back to existing individual endpoints
  - Display `intent` as a subtle tag (e.g., "劑量計算", "藥物交互") above the answer
  - Display `sources_used[]` as small badges (e.g., "指引", "藥品DB", "交互作用圖")
- **References:** architecture plan §3.1

### F06 [TODO] Update patient education display to show source citations
- **Added by:** architecture plan (G4 gap — education is LLM-only, no citations)
- **Date:** 2026-03-02
- **Priority:** P2
- **Blocked by:** B11 (citations field in API response)
- **Files:** `src/components/patient/patient-summary-tab.tsx` (modify)
- **Description:**
  - Currently patient education (`/clinical/explanation`) generates LLM-only text with no source references (gap G4)
  - When backend adds `citations[]` to education responses, display them in a "參考資料" section
  - Show drug monograph source when available
  - Simpler display than clinical citations — just "來源: {drug_name} 藥品仿單" or "來源: {guideline_name}"
- **References:** architecture plan §1.3 G4

### Pharmacy Tag & Advice Response Integration

### F14 [READY] Add dedicated "藥事標籤" button with categorized picker
- **Added by:** backend session
- **Endpoint ready since:** 2026-04-06
- **API contract:** `GET /patients/{id}/messages/pharmacy-tags`
- **Date:** 2026-04-06
- **Priority:** P0
- **Files:** `src/components/patient/patient-messages-tab.tsx` (modify), `src/lib/api/messages.ts` (add new function), `src/pages/use-patient-detail-controller.ts` (fetch + pass prop)
- **Description:**
  - Add a new API client function `getPharmacyTags(patientId)` calling `GET /patients/{id}/messages/pharmacy-tags`
  - Response format: `{ success: true, data: [{ category: "建議處方", tags: ["1-1 給藥問題", ...] }, ...] }`
  - Only returned for pharmacist/admin roles (empty array for others)
  - In the compose area, add a second button next to "標籤": a "藥事標籤" button (pharmacy icon)
  - Clicking it opens a **categorized dropdown** with 4 collapsible sections (建議處方/主動建議/建議監測/用藥連貫性)
  - Each section header is the category name, with subcodes listed underneath
  - Clicking a subcode adds it as a tag (same as existing tag behavior)
  - Selecting a subcode should auto-add the corresponding category tag too (e.g. clicking "1-1 給藥問題" also adds "建議處方")
  - Also add this picker to the per-message tag edit dialog (existing "標籤" button on each message)
  - The regular "標籤" button keeps showing 14 flat tags (unchanged, backward compat)
  - Hide the "藥事標籤" button for doctor/nurse roles (they get empty array from API)
- **UX notes:**
  - Category section colors: 建議處方=brand, 主動建議=amber, 建議監測=dark, 用藥連貫性=blue
  - Use `PHARMACY_ADVICE_CATEGORY_COLORS` from `src/lib/pharmacy-master-data.ts`
  - Sections default to collapsed; clicking header toggles open/close
  - Already-applied tags should show a checkmark and be non-clickable

### F11 [READY] Add "回覆並接受/拒絕建議" buttons to bulletin board reply UI
- **Added by:** backend session
- **Endpoint ready since:** 2026-04-06
- **API contract:** See api-contracts.md — Bulletin Board Tags section
- **Date:** 2026-04-06
- **Priority:** P0
- **Files:** `src/components/patient/patient-messages-tab.tsx` (modify)
- **Description:**
  - When a user with role `doctor` or `admin` is replying to a `medication-advice` message that has `adviceAccepted === null` (pending):
    - Show two buttons below the reply textarea: "回覆並接受建議" (green) and "回覆並拒絕建議" (red)
    - Clicking either sends the reply with `adviceAction: "accept"` or `adviceAction: "reject"` in the POST body
    - Regular "送出" button still works (sends reply without adviceAction)
  - After successful response, the parent message's `adviceAccepted` badge should update (already returned from backend)
  - If `adviceAccepted` is already `true` or `false`, do NOT show the accept/reject buttons (already responded)
  - Success toast: display `response.message` (e.g. "訊息已發送，藥事建議已接受")
  - Error 409: show "此建議已有回覆" toast

### F12 [READY] Add tag usage statistics to 用藥建議與統計 page
- **Added by:** backend session
- **Endpoint ready since:** 2026-04-06
- **API contract:** See api-contracts.md — `GET /pharmacy/advice-records/tag-stats`
- **Date:** 2026-04-06
- **Priority:** P1
- **Files:** `src/pages/pharmacy/advice-statistics.tsx` (modify)
- **Description:**
  - Add a "留言板標籤統計" section to the advice statistics page
  - Fetch from `GET /pharmacy/advice-records/tag-stats?month={selectedMonth}`
  - Display as horizontal bar chart or table: tag name + count
  - Color-code by category:
    - 建議處方 tags (1-x): brand color
    - 主動建議 tags (2-x): #f59e0b (amber)
    - 建議監測 tags (3-x): #1a1a1a (dark)
    - 用藥連貫性 tags (4-x): #3b82f6 (blue)
  - Category tags ("建議處方" etc.) shown as section headers or larger bars
  - Subcode tags ("1-1 給藥問題" etc.) shown as sub-items
  - Syncs with the existing month filter on the statistics page

### F13 [READY] Render pharmacy advice tags with category colors in bulletin board
- **Added by:** backend session
- **Date:** 2026-04-06
- **Priority:** P2
- **Files:** `src/components/patient/patient-messages-tab.tsx` (modify)
- **Description:**
  - Pharmacy subcode tags (matching pattern `^\d+-\d+\s`) should render with category-specific colors:
    - Tags starting with "1-": brand color background
    - Tags starting with "2-": amber (#f59e0b) background
    - Tags starting with "3-": dark (#1a1a1a) background + white text
    - Tags starting with "4-": blue (#3b82f6) background
  - Category tags ("建議處方", "主動建議", "建議監測", "用藥連貫性") use same color scheme but as outline/border style
  - Other tags (general tags like "重要", "追蹤") keep current default styling
  - Use `PHARMACY_ADVICE_CATEGORY_COLORS` from `src/lib/pharmacy-master-data.ts` as color source

### F16 [READY] Confirm thumbs-up/down feedback uses correct field name (P0-a)
- **Endpoint:** `PATCH /ai/chat/messages/{message_id}/feedback`
- **Added by:** backend session
- **Date:** 2026-04-14
- **Status:** Backend deployed (commit `2473c05`, in Plan B hotfix train). Production smoke check returns 401 (auth gate), confirming route is registered.
- **Schema:** see `docs/coordination/api-contracts.md` → "PATCH `/ai/chat/messages/{message_id}/feedback` — Thumbs Up/Down (P0-a)"
- **What frontend should verify:**
  1. `updateMessageFeedback()` posts JSON body using field name **`feedback`** (not `rating`) — value is `"up"`, `"down"`, or `null`.
  2. After PATCH 200, the optimistic UI state matches `response.data.feedback`.
  3. 404 on the message means "not yours / does not exist" — do not retry, and do not reveal the distinction in UI text.
  4. `null` is a valid clear operation (not an error).
- **Notes:**
  - 5 backend contract tests lock in the schema (`backend/tests/test_api/test_ai_chat_feedback.py`): 200 happy path, 400 invalid value, 400 non-assistant, 404 missing, 404 cross-user.
  - Storage is a single `ai_messages.feedback` column (`VARCHAR(10)`). No separate feedback table — toggling overwrites.
  - Bug history: this endpoint did not exist on the backend until recently — frontend was already calling it and getting 404. Now fixed both sides.

### Phase 3-4 — Safety UI + Polish

### F07 [TODO] Add drug comparison feature to pharmacy workstation
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P2
- **Blocked by:** B07 (unified query endpoint supporting `drug_comparison` intent)
- **Files:** `src/pages/pharmacy/workstation.tsx` (modify), possibly new component
- **Description:**
  - Add "藥物比較" section to pharmacy workstation
  - Input: 2 drug names (with autocomplete)
  - Display: side-by-side comparison table (indications, dosing, interactions, contraindications, cost)
  - Uses `/clinical/query` with intent auto-detected as `drug_comparison`
  - Data comes from Source B (Qdrant drug monographs)
- **References:** architecture plan §1.4 row "藥物比較"

### F08 [TODO] Add IV compatibility quick-check to medication tab
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P2
- **Blocked by:** None (backend endpoint already exists via drug_graph_bridge)
- **Files:** `src/components/patient/patient-medications-tab.tsx` (modify)
- **Description:**
  - Add quick Y-Site compatibility check within the patient medication tab
  - When patient has multiple IV medications, show compatibility matrix
  - Compatible=green(C), Incompatible=red(I), No data=gray(-)
  - Use existing `/pharmacy/compatibility/batch` or equivalent endpoint
  - Critical safety feature: incompatible pairs should be visually prominent
- **References:** inventory report §4.5

### F09 [READY] Add interaction risk badges to chat responses
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Unblocked:** 2026-03-02 (B09 complete)
- **Priority:** P2
- **Backend note:** Backend now injects drug interaction data from Drug Interaction Graph (Source C) into both `/clinical/decision` and `/ai/chat` responses.
- **Files:** `src/components/patient/patient-chat-tab.tsx` (modify), `src/components/patient/patient-summary-tab.tsx` (modify)
- **API response fields:**
  - `/ai/chat` response: `message.graphMeta.drugsFound[]`, `message.graphMeta.interactionCount`, `message.graphMeta.hasRiskX`, `message.graphMeta.hasRiskD`
  - `/clinical/decision` response: `graphMeta.drugsFound[]`, `graphMeta.interactionCount`, `graphMeta.hasRiskX`, `graphMeta.hasRiskD`
  - `requiresExpertReview: true` is automatically set when `hasRiskX` is true
  - Full interaction list is in the LLM answer text (not exposed directly in JSON — drug interaction data is injected into the LLM context as hard constraints)
- **Description:**
  - When `/ai/chat` response includes drug interaction data (from Source C Graph)
  - Display risk level badges: A(green) / B(blue) / C(yellow) / D(orange) / X(red)
  - Badge shows: drug pair + risk level + one-line summary
  - Risk X should be prominently displayed with warning icon
  - Use `graphMeta.hasRiskX` to conditionally show an amber "requires expert review" banner
- **References:** architecture plan §3.2, inventory report §4.4

### F10 [TODO] Add multi-source search loading states
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P2
- **Blocked by:** B05 (orchestrator streaming/progress)
- **Files:** `src/components/patient/patient-summary-tab.tsx` (modify)
- **Description:**
  - When orchestrator queries multiple sources in parallel, show progressive loading
  - Phase 1: "正在查詢交互作用資料庫..." (Source C, instant)
  - Phase 2: "正在搜尋臨床指引..." + "正在搜尋藥品資料庫..." (Sources A+B, parallel)
  - Phase 3: "正在整合證據..." (Evidence fusion)
  - Each phase shows a small spinner + source name
  - Once all complete, render final answer with citations
- **References:** architecture plan §8.1 latency tiers

### F22 [READY] Surface bulletin-board pharmacy-intervention sync in the UI
- **Added by:** backend session (migration 067 + sync hook live 2026-04-23)
- **Date:** 2026-04-23
- **Priority:** P1 (visibility + UX feedback for the new data flow)
- **Superseded approach:** earlier Plan A wanted to *block* VPN tagging on the bulletin board. After product decision the opposite happened: **bulletin VPN tags are now a first-class path to statistics** — see `api-contracts.md` § "Bulletin-board VPN tags auto-sync to PharmacyAdvice". So this task is about *reflecting* that sync in the UI, not blocking the flow.
- **Backend already in place:**
  - `POST /patients/{pid}/messages`, `PATCH /tags`, `DELETE /messages` all create / update / remove `PharmacyAdvice` rows automatically when the author is `pharmacist` / `admin` and the tag list contains VPN codes.
  - `GET /pharmacy/advice-records/orphan-tag-stats` still exists but is now an observability gauge for historical orphans (pre-migration-067) and for the edge case of non-pharmacist tagging.
- **Work items:**
  1. **Confirmation toast on message send / tag update** (`src/components/patient/patient-messages-tab.tsx`, `src/pages/patient-detail.tsx`)
     - When the API response `message` field contains `"已計入統計"`, surface it as a success toast so the pharmacist knows their tag just fed the admin dashboard.
  2. **Keep the existing `PharmacyTagSelector` UI intact** (no longer blocking). Optional polish: add a tooltip on each VPN subcode button: "此標籤會計入藥事統計".
  3. **Admin stats: add "尚未連結統計的 VPN 標籤" observation card** (`src/pages/admin/statistics.tsx`, `src/lib/api/pharmacy.ts`)
     - Add helper `getOrphanTagStats({ month })` → GET `/pharmacy/advice-records/orphan-tag-stats`.
     - Render a card next to 類別分佈 with `total` coloured green=0 / amber=1–5 / red=≥6 and top-3 `byTag` entries, plus a `<details>` expanding the `samples[]` table.
     - Include a "回填歷史資料" button that POSTs to a backend task or links to the runbook for `python3 -m scripts.backfill_orphan_advice` — backend team will wire the trigger.
  4. **Delete-message confirmation copy**: when deleting a message that has linked advice rows (response audit log has `details.advice_sync_deleted` array), change the confirm-dialog body to "此留言含 N 筆藥事介入，刪除後將一併從統計中移除" — needs the count to be sent back; either fetch from the response or compute client-side from the message tags.
- **Acceptance:**
  - Pharmacist posts a message with `"1-A 給藥問題"` → sees toast "訊息已發送，1 筆藥事介入已計入統計" → `/admin/statistics` total increments by 1 on refresh.
  - Pharmacist removes the VPN tag via PATCH → advice silently retracts (no toast needed).
  - Deleting the message shows the new confirmation copy and stats go back to previous value.
- **When to retire the orphan card:** once `total` stays at 0 for ≥30 days in prod, drop the card + the endpoint in a follow-up PR.

### F21 [READY] Tighten `Medication.codingSource` TS union to the backend SSOT
- **Added by:** backend session (coding_source SSOT hardening, migration 066)
- **Date:** 2026-04-23
- **Priority:** P2 (type-safety cleanup, no runtime bug)
- **Files:** `src/lib/api/medications.ts` (line ~52, `codingSource` field in `Medication`)
- **Background:**
  - Backend now has a single source of truth: `backend/app/models/coding_source.py` → `VALID_CODING_SOURCES`.
  - A DB CHECK constraint (`ck_medications_coding_source_valid`, migration 066) and a pytest (`tests/test_fhir/test_coding_source_ssot.py`) guard any drift at the backend layer.
  - The frontend TS union currently ends with `| string | null` — the `| string` makes the union effectively `string`, which defeats type narrowing.
- **Change:**
  - Replace the `codingSource?: ... | string | null` union in the `Medication` interface with exactly:
    ```ts
    codingSource?:
      | 'formulary'
      | 'formulary+abx'
      | 'abx_only'
      | 'legacy_only'
      | 'manual'
      | 'rxnorm_cache'
      | 'unmapped'
      | null
    ```
  - If any component currently pattern-matches against values NOT in the list above (e.g. `'abx'`, `'legacy'`, `'demo'`), those branches are dead — remove them. The backend never emits those.
  - After the change run `npm run build` + `tsc --noEmit` and fix any newly surfaced type errors (they are real drift, not noise).
- **Verification:**
  - `rg "codingSource" src/` should show every consumer aligning to one of the 7 literals above.
  - Manually sanity-check the patient medications tab and pharmacy duplicates page render the same as before (no visual regressions) — this is a type-only change, so runtime behaviour should be identical.

### F17 [TODO] Archive remaining files in `src/hooks/` per restructure plan
- **Added by:** backend session (Step 5 verify_restructure cleanup)
- **Date:** 2026-04-14
- **Priority:** P2 (tech debt / restructure gate)
- **Files:** `src/hooks/` (15 files remaining)
- **Description:**
  - `scripts/verify_restructure.sh` T08 expects `src/hooks/` to be empty/removed (all hooks moved to colocated feature dirs during Batch 2 cleanup).
  - Currently 15 files still live under `src/hooks/`. Audit which are actively imported; move active ones to their feature home, archive the rest under `_archive_candidates/20260218/src_hooks/`.
  - After cleanup, re-run `bash scripts/verify_restructure.sh T08` — the check `src/hooks still has 15 files` should become `src/hooks removed`.
- **References:** `scripts/verify_restructure.sh:328-340`

### F19 [DONE] Wire `PharmacistSoapEditor` into `medical-records.tsx` (Phase 3)
- **Completed:** 2026-04-17 (by main session — scope exception granted per user instruction, despite `backend/CLAUDE.md` scope rule, to keep Phase 3 progress unblocked)
- **Summary:** `DraftEntry` extended with `soap` / `polishedSoap` / `submittedAt`; `mergeDraft` helper back-compats old localStorage; `isPharmacistSoapMode` gate added at L629 to swap the 2-column grid for `<PharmacistSoapEditor>`. `npm run build` + `tsc --noEmit` green.
- **Post-deploy verification (2026-04-17, Playwright MCP):**
  1. Pharmacist login (`陳佩君`, role=pharmacist) → patient → 病歷記錄 → 用藥建議 → 5-Card layout (S/O/A/P + composed output) with all `pharmacist-soap-*` test-ids present.
  2. Switch to Progress Note → SOAP ids gone, legacy 2-column「你的草稿｜AI 修飾後」returned (gate works).
  3. Polish smoke test: input `sug add meropenem 1g IV q8h d/t CRE pneumonia. monitor: renal fx, CRP.` → `POST /api/v1/clinical/polish` 200 with `task=pharmacist_polish, target_section=p, soap_sections.p=<input>`; output `- Due to CRE pneumonia, please consider adding Meropenem 1 g IV q8h.\n  Monitor: renal function, CRP.` (all format rules pass).

<details><summary>(archived) original handoff brief</summary>
- **Added by:** backend session (pharmacist polish revamp Phase 3 handoff)
- **Date:** 2026-04-17
- **Priority:** P1 (blocks pharmacist UAT in Phase 6)
- **Endpoint ready since:** 2026-04-17 (Phase 1 shipped `task: "pharmacist_polish"` + `soap_sections` + `target_section` + `polish_mode` on `POST /api/v1/clinical/polish`)
- **API contract:** `src/lib/api/ai.ts` already exports `PolishTask`, `PolishMode`, `SoapSection`, `TargetSection`, `SoapSections`, and the extended `polishClinicalText` signature. Response carries `polished_sections` + `metadata.parse_ok`.
- **Files to modify:**
  - `src/components/medical-records.tsx` (only file requiring changes)
- **Already created (ready to import):**
  - `src/components/pharmacist-soap-editor.tsx` — exports `PharmacistSoapEditor`, `SoapDraft`, `EMPTY_SOAP`
- **Implementation steps:**
  1. **Extend `DraftEntry`** (L129):
     ```ts
     import { PharmacistSoapEditor, EMPTY_SOAP, type SoapDraft } from './pharmacist-soap-editor';
     type DraftEntry = {
       input: string;
       polished: string;
       polishedFrom: string;
       soap: SoapDraft;
       polishedSoap: SoapDraft;
       submittedAt?: number;
     };
     ```
  2. **Update `EMPTY_DRAFT`** (L132) to include `soap: { ...EMPTY_SOAP }, polishedSoap: { ...EMPTY_SOAP }`
  3. **Backward-compat `loadDrafts`** (L141) — when merging a parsed entry, default missing `soap`/`polishedSoap` to `{ ...EMPTY_SOAP }` so legacy localStorage payloads don't crash.
  4. **Add role helper** (near L170):
     ```ts
     const isPharmacistSoapMode = user?.role === 'pharmacist' && recordType === 'medication-advice';
     ```
  5. **Gate render at L629** — replace the `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">…</div>` with:
     ```tsx
     {isPharmacistSoapMode ? (
       <PharmacistSoapEditor
         patientId={patientId}
         canPolish={canPolish}
         polishReason={polishReason}
         soap={currentDraft.soap}
         polishedSoap={currentDraft.polishedSoap}
         onSoapChange={(next) => updateDraft(recordType, { soap: next })}
         onPolishedSoapChange={(next) => updateDraft(recordType, { polishedSoap: next })}
         onSubmitted={() => updateDraft(recordType, { submittedAt: Date.now() })}
       />
     ) : (
       /* existing 2-column grid kept verbatim */
     )}
     ```
- **Verification:**
  - `npm run build` → no new TS errors
  - Dev-server manual: pharmacist on `medication-advice` sees 4 cards (S/O gray "AI 不會動", A/P sky with polish buttons); doctor/nurse keep the 2-column grid; switching patient reloads per-patient draft.
  - Network tab: clicking "潤飾 P" fires `POST /clinical/polish` with `task: "pharmacist_polish"`, `polish_mode: "full"`, `target_section: "p"`, and `soap_sections` carrying only the pharmacist's P text (S/O sent for context but must not appear in response).
- **Commit & push:**
  - Feature branch required (pre-commit hook blocks direct main commits).
  - Push to `railway` remote (Vercel). Backend already deployed to Railway — no `personal` push needed.
- **Tracking doc:** After `[DONE]`, update Phase 3 row in `docs/medical-records-pharmacist-revamp.md` to ✅.
- **References:** `docs/medical-records-pharmacist-revamp.md` §"Phase 3 — 前端 4-Textarea split UI"

</details>

### F20 [READY] Fix `套藥師格式` / `只修文法` buttons not updating A/P textareas
- **Added by:** backend session (P6.1 production E2E verification)
- **Date:** 2026-04-17
- **Priority:** P0 (core pharmacist feature silently broken in production UI)
- **Files:** `src/components/pharmacist-soap-editor.tsx` (likely), possibly `src/components/medical-records.tsx`
- **Symptom (observed on chat-icu.vercel.app via Playwright MCP, 2026-04-17):**
  1. Pharmacist login → patient `pat_26290720` → 病歷記錄 → 用藥建議
  2. Fill S/O/A/P textareas with case_11 content (septic shock + Hydrocortisone + Pitressin)
  3. Click `套藥師格式` button
  4. Network: `POST /api/v1/clinical/polish` → **200 OK**, response body contains valid `polished_sections` with numbered bullets + drug notation preserved + A section translated (matches eval case_11 golden output exactly)
  5. **UI: A/P textareas still show original input, unchanged**
- **Expected:** After a successful polish response, the A and P textareas should render `polished_sections.a` and `polished_sections.p` respectively. `只修文法` (grammar-only) button should likewise update only the target textarea.
- **Likely root cause:** Response handler in `PharmacistSoapEditor` (or wherever the button click is wired) either
  - isn't calling the `onPolishedSoapChange` / `onSoapChange` callback with the new sections, or
  - is writing to a different piece of state than what the textarea is bound to, or
  - is expecting a different response shape than what backend actually returns.
- **Backend response shape (confirmed correct in direct API test):**
  ```json
  {
    "success": true,
    "data": {
      "polished_sections": { "s": "...", "o": "...", "a": "...", "p": "..." },
      "metadata": { "parse_ok": true, "polish_mode": "full", ... }
    }
  }
  ```
- **Verification after fix:**
  1. Same reproduction flow → click `套藥師格式` → A textarea shows translated English assessment, P textarea shows numbered bullets `1./2./3.` with drug notation `(vasopressin 20 units)` intact.
  2. Click `只修文法` on P alone → only P textarea updates; A textarea untouched.
  3. Re-clicking the same button on already-polished content (idempotency) → textarea content should remain stable, not degrade.
- **References:** backend eval report `backend/tests/evals/reports/20260417T044720Z.md` (12/12 PASS) — golden outputs for visual comparison during manual verification.

### F18 [TODO] Fix broken `LatestScores` import in patient-detail view model
- **Added by:** backend session (Step 5 verify_restructure cleanup)
- **Date:** 2026-04-14
- **Priority:** P1 (blocks `tsc --noEmit` clean build)
- **Files:** `src/pages/use-patient-detail-view-model.ts:2`, `src/lib/api/index.ts` (or wherever types are re-exported)
- **Description:**
  - TypeScript compile error surfaced by `verify_restructure.sh`:
    ```
    src/pages/use-patient-detail-view-model.ts(2,84): error TS2305:
      Module '"../lib/api"' has no exported member 'LatestScores'.
    ```
  - Either re-export `LatestScores` from `src/lib/api/index.ts` or update the import to the new location (the type likely moved during a prior refactor).
  - This is the only TS error currently blocking the global quality check; fixing it turns `verify_restructure.sh` fully green for the frontend side.
- **References:** `scripts/verify_restructure.sh:350-360` (TypeScript compilation gate)

---

## Completed Tasks

### F15 [DONE] Add `/sync/:path*` rewrite to `vercel.json`
- **Added by:** backend session
- **Date:** 2026-04-14
- **Completed:** 2026-04-14 (verified end-to-end via Playwright MCP on production)
- **Priority:** P0 (production bug — silently broke `useExternalSyncPolling`)
- **Files:** `vercel.json`
- **Summary:** Added `/sync/:path*` rewrite between `/pharmacy/:path*` and the SPA catch-all so Vercel proxies sync polling to Railway instead of serving the SPA HTML. Without the rewrite `useExternalSyncPolling` had been silently broken since ship — `JSON.parse(html)` was swallowed by a try/catch and the version-change detector never fired.
- **Verification (2026-04-14, backend session via Playwright MCP):**
  1. Smoke: `curl -sI https://chat-icu.vercel.app/sync/status` → `HTTP/2 401`, `content-type: application/json`, `x-railway-edge: railway/asia-southeast1-eqsg3a`, `x-cache: MISS`.
  2. Polling: 6+ GET `/sync/status` over 4 minutes in Playwright network log, all 200 `application/json` (not 304, not HTML).
  3. Version cascade: forced `UPDATE sync_status SET version=$now WHERE key='his_snapshots'` on Supabase prod. Within ~70s the next polling tick fired `/patients?limit=100 → 200` and `/dashboard/stats → 200`. Hook is live in production.
- **References:** `docs/coordination/dev-step-tracker.md` Step 3; schema in `api-contracts.md` → "GET `/sync/status`".

<!-- Frontend session: move finished tasks here -->
