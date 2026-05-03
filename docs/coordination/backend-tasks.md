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

### TC-B01 [DONE] Lock pin / mark_read / first-post-pinned to admin (or owner)
- **Completed:** 2026-05-03 (branch `fix/tc-b01-pin-read-admin-gate`)
- **Files modified:**
  - `backend/app/routers/team_chat.py:send_team_chat` — reject `body.pinned=True` for non-admin (403)
  - `backend/app/routers/team_chat.py:toggle_pin_message` — `Depends(require_roles("admin"))`
  - `backend/app/routers/team_chat.py:mark_read` — recipient gate (author / mentioned_user_ids / mentioned_roles / admin); added audit log entry "標記團隊訊息已讀" so the team-wide is_read flip is traceable
  - `backend/tests/test_api/test_team_chat.py` — 6 new regression tests covering each negative + positive case
  - `src/pages/chat.tsx` — wrap message-bubble pin button (L425-438) AND pinned-sidebar pin button (L730-744) with `{user?.role === 'admin' && (...)}`
- **Verification:** `cd backend && python3 -m pytest tests/test_api/test_team_chat.py -v` → 23/23 passed (was 17, +6 new); `npx tsc --noEmit` exit 0
- **Original task body retained below for reference.**

### TC-B01-original [original] Lock pin / mark_read / first-post-pinned to admin (or owner)
- **Added by:** team-chat audit 2026-05-03 (F-01)
- **Date:** 2026-05-03
- **Priority:** P0 (security gap — any user can pin/unpin/silently zero everyone's mention badge)
- **Progress tracker:** `docs/team-chat-fixes-progress.md` TC-W2-T1
- **Files:**
  - `backend/app/routers/team_chat.py:187` — reject `body.pinned=True` if `user.role != 'admin'`
  - `backend/app/routers/team_chat.py:271-304` — `toggle_pin_message` add `Depends(require_roles("admin"))`
  - `backend/app/routers/team_chat.py:239-268` — `mark_read` add owner/mentioned-recipient check + audit log entry (currently has no audit, so a single user can wipe team-wide mention badges with no trace)
- **Description:**
  - Audit confirmed `DELETE /team/chat/{id}` already requires admin, but pin and mark_read are wide open. Behavior is inconsistent and creates trivial griefing/integrity vectors.
  - `mark_read` flips a global `is_read=True` flag that drives `mentions/count` and `notifications.summary`, so any logged-in user can clear the mention badge for every recipient. This must require: caller is in `mentioned_user_ids` OR `user.role` is in `mentioned_roles` OR caller is the message author.
- **Tests to add (`backend/tests/test_api/test_team_chat.py`):**
  - nurse PATCH `/team/chat/{id}/pin` → 403
  - non-admin POST `/team/chat` with `pinned=True` → 403
  - user not mentioned + not author PATCH `/team/chat/{id}/read` → 403
  - audit log assertion on mark_read
- **Frontend dependency:** TC-F02 hides the pin button for non-admin once this lands (else non-admin clicks 403 → toast spam).
- **References:** `docs/team-chat-audit-fixes-2026-05-03.md` §F-01

### TC-B02 [DONE] Replace JSONB→TEXT mention LIKE with `@>` + add GIN index
- **Completed:** 2026-05-03 (branch `fix/tc-b02-mention-jsonb-gin`)
- **Files modified:**
  - `backend/alembic/versions/076_team_chat_mention_gin.py` (NEW) — `CREATE INDEX ... USING GIN` on `mentioned_user_ids` and `mentioned_roles`, idempotent
  - `backend/app/utils/jsonb_compat.py` (NEW) — `array_contains_value(col, value, dialect_name)` helper: PG path uses `@>`, SQLite (test only) path uses quoted-substring text-cast LIKE. Same call site, dialect-aware compilation.
  - `backend/app/routers/team_chat.py:mentions_count` — uses helper; `String, cast` import dropped
  - `backend/app/routers/notifications.py:_team_chat_mention_predicate` & `_patient_board_mention_predicate` — both take `dialect_name` arg now; `String, cast` import dropped; all 5 call sites updated
  - `backend/tests/test_api/test_team_chat.py:test_mention_predicate_no_substring_collision` — new regression: seeds `["all_admins"]` and asserts role=admin yields count=0 (no substring collision)
- **Verification:** `cd backend && python3 -m pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py -q` → 29/29 passed; on PG the predicate compiles to `mentioned_roles @> '["admin"]'::jsonb` (verified via `stmt.compile(dialect=postgresql.dialect())`).
- **References:** F-13 in audit. Original task body retained below.

### TC-B02-original [original] Replace JSONB→TEXT mention LIKE with `@>` + add GIN index
- **Added by:** team-chat audit 2026-05-03 (F-13)
- **Date:** 2026-05-03
- **Priority:** P0 (correctness + performance — current code can collide on `"all_admins"` substring once enum loosens, and bypasses any index)
- **Progress tracker:** `docs/team-chat-fixes-progress.md` TC-W2-T2
- **Files:**
  - `backend/app/routers/team_chat.py:118-137` — `cast(JSONB, String).contains(f'"{role}"')` → `mentioned_roles.contains([user.role])` / `mentioned_user_ids.contains([user.id])`
  - `backend/app/routers/notifications.py:31-45` — same change in `_team_chat_mention_predicate`
  - New alembic migration `backend/alembic/versions/0XX_team_chat_mention_gin.py`:
    ```python
    op.create_index("ix_team_chat_messages_mentioned_user_ids_gin",
                    "team_chat_messages", ["mentioned_user_ids"], postgresql_using="gin")
    op.create_index("ix_team_chat_messages_mentioned_roles_gin",
                    "team_chat_messages", ["mentioned_roles"], postgresql_using="gin")
    ```
- **Tests:** seed messages with `mentioned_roles=["doctor"]` and `["all_admins"]`; query for `role=doctor` must NOT return the second.
- **Verification:** `EXPLAIN ANALYZE` on `mentions/count` should show `Bitmap Index Scan on ix_team_chat_messages_mentioned_user_ids_gin`.
- **References:** F-13

### TC-B03 [DONE] Rate limit team chat send / pin / mark_read
- **Added by:** team-chat audit 2026-05-03 (F-15)
- **Date:** 2026-05-03
- **Completed:** 2026-05-03 (branch `fix/tc-b03-team-chat-rate-limit`)
- **Priority:** P1
- **Progress tracker:** TC-W2-T3
- **Files modified:** `backend/app/routers/team_chat.py` — `@limiter.limit("20/minute")` on `send_team_chat`, `@limiter.limit("10/minute")` on `toggle_pin_message`, `@limiter.limit("60/minute")` on `mark_read`. Used existing `app.middleware.rate_limit.limiter` (slowapi).
- **Verification:** `cd backend && python3 -m pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py -q` → 29/29 passed (limiter.reset() in conftest's `client` fixture prevents bleed between tests).
- **References:** F-15

### TC-B04 [DONE] Add 168h lookback to `mentions/count` (align with notifications)
- **Completed:** 2026-05-03 (branch `fix/tc-b04-mentions-time-window`)
- **Files modified:**
  - `backend/app/routers/notifications.py` — promote `_WINDOW_HOURS` to public `MENTION_LOOKBACK_HOURS = 168` (kept `_WINDOW_HOURS` alias for in-file refs to avoid touching unrelated lines)
  - `backend/app/routers/team_chat.py` — import `MENTION_LOOKBACK_HOURS`, add `cutoff` filter to `mentions_count`'s WHERE clause
  - `backend/tests/test_api/test_team_chat.py:test_mentions_count_excludes_old_mentions` — new regression test seeding a 200h-old mention and asserting count=0
- **Verification:** `cd backend && python3 -m pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py -q` → 30/30 passed (was 29, +1 new)
- **References:** F-17. Original task body retained below.

### TC-B04-original [original] Add 168h lookback to `mentions/count` (align with notifications)
- **Added by:** team-chat audit 2026-05-03 (F-17)
- **Date:** 2026-05-03
- **Priority:** P1
- **Progress tracker:** TC-W2-T4
- **Files:** `backend/app/routers/team_chat.py:113-137`
- **Description:** Extract `MENTION_LOOKBACK_HOURS = 168` constant shared with `notifications.py:25`. Today the bell uses 168h cutoff but `mentions/count` scans the whole table → users see "5 mentions" in bell but "28 mentions" in chat sidebar.
- **References:** F-17

### TC-B05 [DONE] Validate `mentionedUserIds` are real users on POST
- **Completed:** 2026-05-03 (branch `fix/tc-b05-validate-mentioned-user-ids`)
- **Files modified:**
  - `backend/app/routers/team_chat.py:send_team_chat` — after the pinned-admin gate, query `User.id IN (...) AND active = TRUE`; raise 422 with `{message, unknown: [...]}` if any input ID isn't a real active user.
  - `backend/tests/test_api/test_team_chat.py` — added `test_post_rejects_unknown_mentioned_user_id` (422 path) and `test_post_accepts_known_mentioned_user_id` (200 path).
- **Verification:** `cd backend && python3 -m pytest tests/test_api/test_team_chat.py -q` → 27/27 passed (was 25, +2 new).
- **References:** F-18. Original task body retained below.

### TC-B05-original [original] Validate `mentionedUserIds` are real users on POST
- **Added by:** team-chat audit 2026-05-03 (F-18)
- **Date:** 2026-05-03
- **Priority:** P2
- **Progress tracker:** TC-W2-T5
- **Files:** `backend/app/routers/team_chat.py:208-221`, `backend/app/schemas/message.py:78-86`
- **Description:** Currently any string ≤50 chars passes Pydantic and is silently stored. Should `SELECT id FROM users WHERE id IN (...)` and 422 on unknown IDs (or strip them with a warning).
- **References:** F-18

### TC-B06 [BLOCKED] Switch `is_read` global flag → per-user mention unread
- **Added by:** team-chat audit 2026-05-03 (F-02)
- **Date:** 2026-05-03
- **Priority:** P0 (architectural — root cause of "one user reads, all badges clear" bug)
- **Progress tracker:** TC-W3-T1
- **Blocked on:** PM decision — Option A (keep `is_read`, derive unread from `read_by @>` subquery) vs Option B (drop `is_read` from mention path entirely, use `last_chat_visit_at` + per-mention timestamp)
- **Files (when unblocked):** `backend/app/routers/team_chat.py:130, 263`, `backend/app/routers/notifications.py:31-45`, new migration
- **Reference:** F-02 in audit; multi-user regression test in TC-B10 will exercise this

### TC-B07 [BLOCKED] `list_team_chat` reverse + cursor pagination
- **Added by:** team-chat audit 2026-05-03 (F-03)
- **Date:** 2026-05-03
- **Priority:** P0 (UX — over 50 messages users see oldest, never newest)
- **Progress tracker:** TC-W3-T2
- **Blocked on:** PM confirms `ORDER BY ASC LIMIT 50` is a bug, not deliberate onboarding behavior
- **Files (when unblocked):** `backend/app/routers/team_chat.py:140-184`
- **Description:** Change to `ORDER BY timestamp DESC LIMIT N`, reverse server-side, add `?before=<timestamp_or_id>` cursor for "load older". Frontend TC-F12 will rewire infinite scroll.
- **References:** F-03

### TC-B08 [TODO] `/team/users` filter by current user's unit/campus
- **Added by:** team-chat audit 2026-05-03 (F-12 partial)
- **Date:** 2026-05-03
- **Priority:** P1 (PII — North Campus pharmacist can list every South Campus nurse)
- **Progress tracker:** TC-W4-T1
- **Files:** `backend/app/routers/team_chat.py:21-40`
- **Open question:** does `users` table have unit/campus column populated for all users? Verify before implementing — may need `users.campus` backfill.
- **Tests:** seed two users in different campuses; `/team/users` for caller in campus A returns only campus-A users.
- **References:** F-12

### TC-B09 [TODO] `read_by` append helper with dedup (shared by team_chat + notifications)
- **Added by:** team-chat audit 2026-05-03 (F-14)
- **Date:** 2026-05-03
- **Priority:** P1 (data growth — `notifications.py:213-214` mark-all-read appends without dedup)
- **Progress tracker:** TC-W4-T2
- **Files:**
  - New: `backend/app/utils/read_receipt.py` with `append_read_receipt(read_by, user) -> list`
  - `backend/app/routers/team_chat.py:254-261` use helper
  - `backend/app/routers/notifications.py:213-214` use helper
- **Tests:** call mark-all-read 10× for the same user → `read_by` length stays 1.
- **References:** F-14

### TC-B10 [TODO] Multi-user regression tests
- **Added by:** team-chat audit 2026-05-03 (F-29)
- **Date:** 2026-05-03
- **Priority:** P1
- **Progress tracker:** TC-W4-T4
- **Files:** new `backend/tests/test_api/test_team_chat_multiuser.py`
- **Coverage requirement:**
  - Two admins, A marks-read → B's mention count must NOT drop
  - Non-admin pin → 403
  - mention `@>` does not collide on substring
  - `read_by` does not grow on repeated mark-read
  - Reply to deleted parent shows orphan handling
- **References:** F-29

### TC-B11 [TODO] Soft delete + audit content snapshot for admin delete
- **Added by:** team-chat audit 2026-05-03 (F-16)
- **Date:** 2026-05-03
- **Priority:** P1
- **Progress tracker:** TC-W4-T3
- **Files:**
  - `backend/app/models/chat_message.py` — add `deleted_at`, `deleted_by_id`
  - new migration with these columns + partial index `WHERE deleted_at IS NULL`
  - `backend/app/routers/team_chat.py:307-328` — set `deleted_at` instead of `db.delete`; pass `details={"content": msg.content[:500], "author": msg.user_name, "ts": msg.timestamp.isoformat()}` to `create_audit_log`
  - `backend/app/routers/team_chat.py:155-159` — list query filter `deleted_at.is_(None)`
- **Frontend dependency:** TC-F09 — show `[原訊息已刪除]` placeholder when `messageById.get(replyToId)` not found
- **References:** F-16

### TC-B12 [TODO] Schema cleanup: dead `reply_count` column + ORM FK alignment
- **Added by:** team-chat audit 2026-05-03 (F-30)
- **Date:** 2026-05-03
- **Priority:** P2
- **Progress tracker:** TC-W4-T5
- **Files:**
  - `backend/app/models/chat_message.py:27` — add explicit `ForeignKey("team_chat_messages.id", ondelete="SET NULL")` to `reply_to_id`
  - new migration: drop `reply_count` column (currently always 0, never read/written) — OR add to model and maintain on insert/delete; pick one
- **References:** F-30

### TC-B13 [TODO] Retention: archive job + drop `total` count from list
- **Added by:** team-chat audit 2026-05-03 (F-31, F-32)
- **Date:** 2026-05-03
- **Priority:** P2
- **Progress tracker:** TC-W4-T6
- **Files:**
  - new `backend/scripts/archive_team_chat.py` — move messages older than 90 days to `team_chat_messages_archive`
  - `backend/app/routers/team_chat.py:147-152` — drop `total` query (frontend doesn't read it)
- **References:** F-31, F-32

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

### P3.1 [DONE] Patient-detail bootstrap aggregator endpoint
- **Completed:** 2026-04-29
- **Files modified:**
  - `backend/app/routers/patients.py` — added `GET /patients/{id}/bootstrap`
  - `backend/app/routers/lab_data.py` — extracted `compute_latest_lab_payload()` helper
  - `backend/app/routers/medications.py` — extracted `compute_medications_payload()` helper
  - `backend/tests/test_api/test_patient_bootstrap.py` — 4 contract tests (incl. anti-drift)
- **Summary:** Single endpoint returning `{patient, latestLab, medications, latestVitals, latestVentilator}` with shapes byte-equal to the 5 source endpoints. Sequential queries on shared AsyncSession (no `asyncio.gather` per SQLAlchemy async constraint). Frontend `[READY]` task added (F00).

### B12 [DONE] Add per-intent confidence thresholds + "I don't know" enforcer
- **Completed:** 2026-03-02
- **Files:** `backend/app/services/safety_gate.py` (164 lines), `backend/tests/test_services/test_safety_gate.py` (340 lines)
- **Summary:** Per-intent thresholds from source_priorities.json. Rules: score < 0.35 → refuse; iv_compatibility without graph → refuse; dose_calculation with zero evidence → refuse.
