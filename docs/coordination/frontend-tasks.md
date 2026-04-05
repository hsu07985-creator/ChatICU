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

---

## Completed Tasks

<!-- Frontend session: move finished tasks here -->
