# Backend Task Queue

> This file is the coordination channel FROM frontend TO backend.
> Frontend session adds tasks here. Backend session picks them up.

## How to use
- Frontend: Add new tasks with `[TODO]` status when you need a new/modified API
- Backend: Change `[TODO]` → `[IN-PROGRESS]` when you start, `[DONE]` when finished
- Move completed tasks to the "Completed" section at the bottom

---

## Pending Tasks

### B09 [TODO] Wire Source C (Drug Graph) into `/clinical/decision` and `/ai/chat`
- **Added by:** architecture plan (G2 gap)
- **Date:** 2026-03-02
- **Priority:** P1
- **Depends on:** B02
- **File:** `backend/app/routers/clinical.py`, `backend/app/routers/ai_chat.py` (modify)
- **Description:**
  - `drug_graph_bridge.py` is loaded in `clinical.py` but NOT wired into `ai_chat.py`
  - When `/ai/chat` detects 2+ drug names → auto-lookup interactions via Graph (Source C, <5ms)
  - Graph results are injected as hard constraints: "Source C risk X = contraindicated, LLM must not downplay"
  - **Add `[READY]` task to `frontend-tasks.md`** to display interaction badges
- **References:** architecture plan §1.3 G2, §3.2

### B15 [TODO] Reduce `/ai/chat/stream` TTFT via OpenAI prompt cache + DB parallelization
- **Added by:** frontend session
- **Date:** 2026-04-16
- **Priority:** P1 (user-facing latency complaint)
- **File:** `backend/app/routers/ai_chat.py`, `backend/app/llm.py`, snapshot builder
- **Problem (user report):**
  - "等太久才開始出字" — TTFT (send → first token) is the dominant latency, not streaming throughput
  - `/ai/chat/stream` goes **directly** to `call_llm_stream` (no orchestrator / RAG / Source B), so the whole TTFT budget is: DB queries + build_clinical_snapshot + LLM HTTP call
- **Root cause analysis:**
  - Largest cost is the LLM HTTP round-trip TTFT, which scales linearly with `system_prompt` size. `build_clinical_snapshot()` embeds the whole patient FHIR context into the system prompt, making it large on every turn.
  - OpenAI automatic prompt caching (2024-12+) gives ~50% token cost + significantly lower TTFT on cache hits, but **only hits if the prompt prefix is byte-identical across calls and ≥1024 tokens**.
  - `_get_latest_lab` and `_get_active_medications` at `ai_chat.py:261` are awaited sequentially — free win to parallelize.
- **Requested changes (in order of impact):**
  1. **Ensure prompt prefix stability for OpenAI cache hits**
     - Verify that when the same session issues turn 1, turn 2, turn 3, the messages array sent to OpenAI has an **identical prefix** (system prompt + all prior turns) — any per-turn variation (timestamps, request IDs, reordering) will bust the cache.
     - Confirm `_build_system_prompt()` is deterministic given the same `clinical_snapshot` — no `datetime.now()`, no random ordering of lab/med lists.
     - `build_delta` at `ai_chat.py:290-297` appends delta text to the `user_message`, which is fine (delta only affects the last message, cache prefix preserved).
     - Log a debug line showing `len(system_prompt)` so we can confirm it's ≥1024 tokens (~4000 chars) to qualify for caching.
  2. **Compress `build_clinical_snapshot` to trend-summary form (preserve clinical signal, drop raw data)**
     - **Principle:** ICU decisions need trends, not snapshots. Instead of dumping raw hourly vitals / every lab / every med administration, summarize each series into 1-3 lines of human-readable text containing min/max/direction/latest.
     - **Keep (all clinically load-bearing signal):**
       - Demographics + DNR + allergies + isolation flags
       - All active diagnoses (not just primary)
       - Active problem list
       - **Vitals 24h trend summary**: `HR 88-105 ↑ (latest 102), BP 118/72-138/85 stable (latest 130/78), SpO2 94-97 nadir last night (latest 96), Temp 37.0-38.4 febrile (latest 37.6)` — one line per vital, not raw hourly rows
       - **Key labs 7d trajectory**: abnormal or trending labs get 3-5 time points with direction arrows (`K: 4.2 → 4.6 → 5.1 ↑ abnormal`); stable normal labs get latest value only; omit fully stable normal labs that weren't asked about
       - **Active meds with clinical context**: `Vancomycin 1g IV q12h (Day 3, started 04-13, trough pending)` — keep start day / reason / duration, drop every administration timestamp
       - **Recent med changes (past 48h)**: `Cefepime stopped 04-13, replaced by Pip-Tazo` — critical for reasoning about current treatment
       - **Key ICU events since admission**: intubation day, pressor start, CPR, abx changes, fever peaks — compact timeline
     - **Conditional (include if snapshot still has room):**
       - Culture results (positive → full, negative → `blood cx x2 negative`)
       - Imaging IMPRESSION only, not full report
       - Daily I/O summary (`+500 cc / -200 cc`)
     - **Actually drop:**
       - Every hourly raw vital row (information already in trend summary)
       - Every historical lab time point (information already in trajectory)
       - Every medication administration timestamp (redundant with schedule)
       - Raw FHIR nested structures — convert to human-readable sentences
     - **Target:** reduce snapshot from ~5-15 KB raw dump to **2-4 KB trend-summary form** while keeping all decision-relevant signal. Stays ≥1024 tokens so OpenAI cache still triggers.
     - **Rationale for this shape:** LLM can reason on `K: 4.2 → 4.6 → 5.1 ↑` much more effectively than on 21 raw JSON rows. Trends are preserved; bytes are not.
  3. **Parallelize DB queries**
     - `ai_chat.py:261` change `lab, meds = await _get_latest_lab(...), await _get_active_medications(...)` → `lab, meds = await asyncio.gather(_get_latest_lab(...), _get_active_medications(...))`
     - Inside `build_clinical_snapshot`, any sibling DB queries should also use `asyncio.gather`
  4. **(Optional) Skip `build_delta` when snapshot is fresh**
     - `ai_chat.py:288-297` — add a staleness gate so `build_delta` only runs if `snapshot_taken_at` is > N minutes old (e.g. 10 min), otherwise skip entirely
- **Measurement plan:**
  - Before making changes, log `time_db_start`, `time_snapshot_built`, `time_before_openai_call`, `time_first_token` in `_event_stream` so we can measure each segment
  - Compare TTFT on a fresh session (cache miss) vs. a follow-up turn in the same session (cache hit) — expect cache hit TTFT to drop 50-80%
- **Non-goals:**
  - Do NOT change the model (still gpt-4o)
  - Do NOT wire in RAG / orchestrator / Source B (user confirmed chat assistant is pure LLM, no RAG)
- **References:**
  - OpenAI auto prompt caching: https://platform.openai.com/docs/guides/prompt-caching
  - User-observable symptom: "等太久才開始出字"（TTFT dominant），出字之後本身串流順暢

---

### B14 [TODO] Split `/ai/chat/stream` response into `content` + `explanation` at 【說明/補充】
- **Added by:** frontend session
- **Date:** 2026-04-16
- **Priority:** P2
- **File:** `backend/app/routers/ai_chat.py` (~line 217, `done` SSE event payload)
- **Problem:**
  - LLM prompt (`backend/app/llm.py:113, 229`) produces structured output: short 主回答 + 【說明/補充】 details section inline in one text blob
  - Backend currently sends the whole blob as `message.content` and `message.explanation: None`
  - Frontend UI at `src/pages/patient-detail.tsx:1568-1579` has an expandable detail panel wired to `msg.explanation`, but it's never populated → user sees one long bubble
- **Requested behavior:**
  - Before emitting the `done` SSE event, split the assembled assistant text on the first occurrence of any detail marker (`【說明/補充】`, `【說明】`, `說明/補充：`, `說明：`, `補充：`)
  - `message.content` = text before the marker (trimmed)
  - `message.explanation` = text from the marker onwards (trimmed, keep the marker)
  - If no marker is found, leave `content` unchanged and `explanation: None`
  - Apply the same split to the persisted `AIMessage` row so session history is consistent
- **Frontend interim:** `splitMainAndDetail()` in `src/lib/api/ai.ts` already does this client-side as a fallback, so shipping this backend change will Just Work — frontend prefers `response.message.explanation` if non-empty, otherwise falls back to local split
- **Reference markers:** see `src/lib/api/ai.ts` `_DETAIL_MARKERS` for the canonical list

---

### B13 [TODO] Add LLM-based Stage 2 intent classifier (gpt-4o-mini)
- **Added by:** architecture plan
- **Date:** 2026-03-02
- **Priority:** P2
- **Depends on:** B01
- **File:** `backend/app/services/intent_classifier.py` (modify)
- **Description:**
  - For queries that Stage 1 (rule-based) returns `general_pharmacology` (ambiguous)
  - Call gpt-4o-mini (~$0.00008/call, ~300ms) to classify into 13 intents
  - Include few-shot examples in prompt
  - Feature flag: `INTENT_LLM_CLASSIFIER_ENABLED` (default False during Phase 1-2)
- **References:** architecture plan §4.1 Stage 2

---

## Completed Tasks

### B01 [DONE] Create `intent_classifier.py` — Rule-based Stage 1
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/intent_classifier.py` (429 lines), `backend/tests/test_services/test_intent_classifier.py` (277 lines, 37 tests)
- **Summary:** 13-intent taxonomy, keyword patterns (Chinese + English), drug name detection (known list + generic suffix patterns + Chinese formulation), confidence scoring. Tests all passing.

### B02 [DONE] Create `source_registry.py` — Source registration + health check
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/source_registry.py` (309 lines), `backend/tests/test_services/test_source_registry.py` (309 lines)
- **Summary:** 3 sources (A: Clinical RAG, B: Drug DB Qdrant, C: Drug Graph), health check, `GET /system/sources` endpoint.

### B03 [DONE] Create `drug_rag_client.py` — Source B HTTP client
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/drug_rag_client.py` (210 lines), `backend/tests/test_services/test_drug_rag_client.py` (273 lines)
- **Summary:** Async HTTP client for Source B, 13 query categories, 8s timeout, graceful fallback.

### B04 [DONE] Create `source_priorities.json` — Config-driven source priority matrix
- **Completed:** 2026-03-02
- **File:** `backend/config/source_priorities.json` (4699 bytes)
- **Summary:** 13 intent entries with per-intent source priorities, strategy, confidence thresholds.

### B05 [DONE] Create `orchestrator.py` — Core query orchestrator
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/orchestrator.py` (589 lines), `backend/tests/test_services/test_orchestrator.py` (800 lines)
- **Summary:** Full flow: intent → source selection → parallel dispatch → evidence fusion → safety gate → response assembly. Feature flag `ORCHESTRATOR_ENABLED`.

### B06 [DONE] Create `evidence_fuser.py` — Multi-source evidence fusion
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/evidence_fuser.py` (479 lines), `backend/tests/test_services/test_evidence_fuser.py` (505 lines)
- **Summary:** Dedup, conflict detection, confidence scoring (4-factor weighted), unified citation format.

### B07 [DONE] Add `POST /clinical/query` — Unified clinical query endpoint
- **Completed:** 2026-03-02
- **File:** `backend/app/routers/clinical.py` (endpoint at `/clinical-query` and `/query`)
- **Summary:** Unified query with intent routing, orchestrator integration, fallback to single-source logic.

### B08 [DONE] Add `POST /clinical/nhi` — NHI reimbursement query endpoint
- **Added by:** architecture plan (G3 gap)
- **Date:** 2026-03-02
- **Completed:** 2026-03-02
- **Priority:** P1
- **Files modified:**
  - `backend/app/schemas/clinical.py` — Added 5 new schemas
  - `backend/app/services/nhi_client.py` — New async HTTP client
  - `backend/app/config.py` — Added `NHI_SERVICE_URL` setting
  - `backend/app/llm.py` — Added `nhi_reimbursement` task prompt
  - `backend/app/routers/clinical.py` — Added `POST /clinical/nhi` endpoint
  - `backend/tests/test_api/test_clinical_nhi.py` — 13 test cases
- **Summary:** Dual-path NHI query (service available → direct call; service down → LLM fallback). 35-entry term mapping.

### B10 [DONE] Add `multi_source_synthesis` task prompt to `llm.py`
- **Completed:** 2026-03-02
- **File:** `backend/app/llm.py` (line ~137)
- **Summary:** Multi-source synthesis prompt template with `[SOURCE_A_GUIDELINE]`, `[SOURCE_B_DRUG_DB]`, `[SOURCE_C_GRAPH]` tags.

### B11 [DONE] Add source attribution to all clinical API responses
- **Completed:** 2026-03-02
- **Files:** `backend/app/schemas/clinical.py` (UnifiedCitationItem + citations fields), `backend/app/services/citation_builder.py` (126 lines)
- **Summary:** Citations schema with source_system, text_snippet, evidence_grade, relevance_score. Citation builder service.

### B12 [DONE] Add per-intent confidence thresholds + "I don't know" enforcer
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/safety_gate.py` (164 lines), `backend/tests/test_services/test_safety_gate.py` (340 lines)
- **Summary:** Per-intent thresholds from source_priorities.json. Rules: score < 0.35 → refuse; iv_compatibility without graph → refuse; dose_calculation with zero evidence → refuse.
