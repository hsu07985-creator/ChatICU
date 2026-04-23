# Shared API Contracts

> Both sessions reference this file as the source of truth for API schemas.
> When backend creates/modifies an endpoint, document it here.
> Frontend reads this to know the exact request/response format.

## Convention
- Response envelope: `{ success: boolean, data?: T, error?: string, message?: string }`
- Auth: Bearer JWT in `Authorization` header
- Content-Type: `application/json`
- Base URL: `/api` (proxied via Vite dev server)

---

## Existing Endpoints (Reference)

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login, returns JWT |
| POST | `/auth/refresh` | Refresh token |
| POST | `/auth/logout` | Invalidate token |

### Patients
| Method | Path | Description |
|--------|------|-------------|
| GET | `/patients` | List patients (paginated) |
| GET | `/patients/{id}` | Get patient detail |
| POST | `/patients` | Create patient |
| PUT | `/patients/{id}` | Update patient |
| DELETE | `/patients/{id}` | Delete patient |

### Clinical AI
| Method | Path | Description |
|--------|------|-------------|
| POST | `/clinical/summary` | AI clinical summary |
| POST | `/clinical/explanation` | Patient education |
| POST | `/clinical/guideline` | RAG guideline query |
| POST | `/clinical/decision` | Multi-agent decision |
| POST | `/clinical/polish` | Polish clinical text |

### AI Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/chat` | General AI chat (optional patientId) |

### Pharmacy
| Method | Path | Description |
|--------|------|-------------|
| POST | `/pharmacy/interactions/check` | Drug interaction check |
| GET | `/pharmacy/interactions/history` | Interaction check history |

---

## New Endpoints (Added by Backend Session)

<!-- Backend: document new endpoints below with full request/response schemas -->

### [READY] Bulletin-board VPN tags auto-sync to PharmacyAdvice (migration 067)

> **Status:** Implemented 2026-04-23. Replaces the earlier "F22 block VPN tagging" plan — bulletin messages are now a first-class source of pharmacy-intervention statistics.

- **Goal:** when a pharmacist / admin writes or re-tags a bulletin-board message, every VPN-format tag on that message (e.g. `"1-A 給藥問題"`, `"2-O 建議用藥/建議增加用藥"`) is mirrored into a `PharmacyAdvice` row so the intervention shows up in `/admin/statistics`.
- **Schema change (migration 067):** adds `pharmacy_advices.source_message_id` — nullable FK → `patient_messages.id`, `ON DELETE CASCADE`. One message can produce N advice rows (one per VPN code).
- **Author role gate:** only messages authored by `pharmacist` or `admin` trigger sync. Nurses / doctors tagging a message do NOT inflate the stats.

**Touched endpoints** (no schema changes to the request/response bodies):

| Method | Path | Sync behaviour |
|---|---|---|
| `POST` | `/patients/{pid}/messages` | After insert, each VPN tag on `body.tags` creates one `PharmacyAdvice`. Response `message` gains a suffix `"訊息已發送，N 筆藥事介入已計入統計"` when N > 0. |
| `PATCH` | `/patients/{pid}/messages/{mid}/tags` | Re-syncs advices by diff: add VPN code → new advice row; remove VPN code → drop the row; swap → delete-then-insert. |
| `DELETE` | `/patients/{pid}/messages/{mid}` | Explicitly removes all linked advices first (DB CASCADE is the belt-and-suspenders for Postgres). |
| `POST` | `/pharmacy/advice-records` | Unchanged. Widget-created messages have `advice_record_id` set and are guarded against double-sync. |

**Audit-log additions:** the existing `建立病患訊息` / `更新訊息標籤` / `刪除病患留言` audit rows now carry `details.advice_sync_created` and `details.advice_sync_deleted` arrays of `adv_*` ids.

**Frontend-visible implications:**
- `Message.tags` semantics unchanged; no new fields in `PatientMessage` response.
- `PharmacyAdvice` objects now sometimes have `sourceMessageId` set (widget-path rows leave it `null`). Safe to ignore if you don't surface it.
- The orphan-tag-stats endpoint below stays in place for historical data.

---

### [READY] GET `/pharmacy/advice-records/orphan-tag-stats` — Orphan VPN-tag monitor

> **Status:** Updated 2026-04-23 to account for bulletin-sync. Remains an observability gauge for pre-migration-067 data + edge cases (non-pharmacist tagging).

- **Auth:** `pharmacist` or `admin`
- **Purpose:** Count `patient_messages` rows that carry a VPN-code tag (e.g. `"1-A 給藥問題"`, `"4-W 病人用藥遵從性問題"`) but have `advice_record_id IS NULL`. Those messages never reach `/admin/statistics` because the admin page reads only `PharmacyAdvice`.
- **VPN tag detection:** a tag string whose leading token matches `^\d+-[A-Z\d]+`. Category tags (`"建議處方"`, `"主動建議"`, ...) and free-form custom tags are ignored.

**Query params:**
| Name | Type | Default | Notes |
|---|---|---|---|
| `month` | `YYYY-MM` | omitted = all time | Filters by `patient_messages.timestamp`. Invalid values → `422`. |
| `sample_limit` | int (0..100) | `20` | Max entries in `samples[]`. Aggregate counts always cover the full result set. |

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 7,
    "byTag": [
      { "tag": "1-A 給藥問題", "count": 4 },
      { "tag": "1-E 藥品交互作用", "count": 2 },
      { "tag": "4-W 病人用藥遵從性問題", "count": 1 }
    ],
    "byMessageType": [
      { "messageType": "general", "count": 5 },
      { "messageType": "medication-advice", "count": 2 }
    ],
    "samples": [
      {
        "messageId": "pmsg_ab12cd34",
        "patientId": "pat_001",
        "messageType": "general",
        "orphanTags": ["1-A 給藥問題"],
        "timestamp": "2026-04-20T08:15:00+00:00",
        "contentPreview": "第一行留言前 80 字的節錄..."
      }
    ]
  }
}
```

**Semantics for the admin panel:**
- `total == 0` → migration complete, endpoint can be retired.
- `byTag` helps identify which VPN codes are most often applied by hand (likely target for widget shortcut buttons).
- `samples[]` lets admins click through to individual messages and either convert them to proper `PharmacyAdvice` rows or strip the VPN tag.

---

### [READY] GET `/patients/{id}/messages/pharmacy-tags` — Grouped Pharmacy Tags

> **Status:** Implemented 2026-04-06. For dedicated "藥事標籤" button.

- **Auth:** any logged-in user (returns empty array for non-pharmacist/admin)

**Response (pharmacist/admin):**
```json
{
  "success": true,
  "data": [
    {
      "category": "建議處方",
      "tags": ["1-1 給藥問題", "1-2 適應症問題", "1-3 用藥禁忌問題", "..."]
    },
    {
      "category": "主動建議",
      "tags": ["2-1 用藥劑量/頻次問題", "..."]
    },
    {
      "category": "建議監測",
      "tags": ["3-1 建議藥品療效監測", "3-2 建議藥品不良反應監測", "3-3 建議藥品血中濃度監測"]
    },
    {
      "category": "用藥連貫性",
      "tags": ["4-1 藥歷審核與整合", "4-2 藥品辨識/自備藥辨識", "4-3 病人用藥遵從性問題"]
    }
  ]
}
```

**Response (doctor/nurse):**
```json
{ "success": true, "data": [] }
```

**Notes:**
- Existing `GET /patients/{id}/messages/preset-tags` is unchanged (returns flat `string[]` of 14 tags)
- This new endpoint provides the grouped structure for a dedicated pharmacy tag picker UI
- 4 categories, 27 subcodes total (13+8+3+3)

---

### [READY] PATCH `/ai/chat/messages/{message_id}/feedback` — Thumbs Up/Down (P0-a)

> **Status:** Implemented + deployed 2026-04-14 (commit `2473c05`). Verified via 5 contract tests in `backend/tests/test_api/test_ai_chat_feedback.py`. Production smoke check: `PATCH` returns 401 (auth gate), confirming route is registered.

- **Auth:** logged-in user (cookie session via `get_current_user`)
- **Path param:** `message_id` — must reference an `ai_messages` row owned by the current user's `ai_sessions` row, with `role='assistant'`

**Request body:**
```json
{ "feedback": "up" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `feedback` | `"up" \| "down" \| null` | yes | `null` clears existing feedback. Field name is **`feedback`**, not `rating`. |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "msg_asst_abc123",
    "feedback": "up"
  }
}
```

**Error responses:**
| Status | Condition | Body shape |
|---|---|---|
| 400 | `feedback` not in `("up", "down", null)` | `{"detail": "feedback must be 'up', 'down', or null"}` |
| 400 | Target message has `role != "assistant"` | `{"detail": "Only assistant messages can receive feedback"}` |
| 404 | Message not found **OR** belongs to another user's session | `{"detail": "Message not found"}` (intentional info-leak prevention — same shape for both cases) |
| 401 | Not authenticated | `{"success": false, "error": "UNAUTHORIZED", ...}` |

**Storage:** writes to `ai_messages.feedback` column (`VARCHAR(10) NULL`). No separate feedback table — single field on the message itself, so toggling overwrites.

**Notes for frontend:**
- Idempotent: PATCH `up` twice = same result. PATCH `null` clears.
- 404 is the correct response for "message belongs to someone else" — do not treat as "missing", treat as "not yours".
- The bug this endpoint fixed: frontend `updateMessageFeedback()` was already calling this URL, but the route did not exist → production returned 404. Now contracts are locked in by tests.

---

### [READY] POST `/api/v1/clinical/query` — Unified Clinical Query (B07)

> **Status:** Implemented 2026-03-02. Backend endpoint ready for frontend integration.

**Request:**
```json
{
  "question": "Propofol 肥胖病人劑量?",
  "patient_id": 123,          // optional (int)
  "context": "eGFR 45, BMI 38" // optional (string, max 5000 chars)
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "intent": "dose_calculation",
    "answer": "根據 PAD 指引...",
    "citations": [
      {
        "citation_id": "src_a_guideline_chunk_042",
        "source_system": "clinical_rag_guideline",
        "source_file": "2018 PADIS guideline.pdf",
        "text_snippet": "For adult ICU patients...",
        "evidence_grade": "1B",
        "relevance_score": 0.87,
        "drug_names": ["propofol"]
      }
    ],
    "confidence": 0.82,
    "requires_expert_review": false,
    "sources_used": ["source_a_clinical", "source_b_qdrant"],
    "detected_drugs": ["propofol"]
  }
}
```

**Response (orchestrator disabled):**
```json
{
  "success": false,
  "error": "Orchestrator not enabled",
  "message": "Set ORCHESTRATOR_ENABLED=true to use this endpoint"
}
```

**Notes:**
- Behind `ORCHESTRATOR_ENABLED` feature flag (returns error if disabled)
- Falls back to direct LLM call if orchestrator raises an exception (graceful degradation)
- Auth: requires valid JWT (any role)
- Rate limit: `RATE_LIMIT_AI_CLINICAL` (default 10/minute)
- `source_system` values: `clinical_rag_guideline`, `clinical_rag_pad`, `clinical_rag_nhi`, `drug_rag_qdrant`, `drug_graph`
- `evidence_grade` values: `1A`, `1B`, `2A`, `2B`, `2C`, `expert_opinion`, `monograph`, `curated`
- `requires_expert_review` is `true` when confidence < 0.5 or no sources succeeded
- LLM synthesis uses the `multi_source_synthesis` task prompt for evidence integration

---

### [READY] POST `/api/v1/clinical/nhi` — NHI Reimbursement Query (B08)

> **Status:** Implemented 2026-03-02. Backend endpoint ready for frontend integration.

**Request:**
```json
{
  "drug_name": "pembrolizumab",
  "indication": "非小細胞肺癌"
}
```

- `drug_name` (required, 1–200 chars): Drug name in English or Chinese
- `indication` (optional, max 500 chars): Clinical indication to narrow the query

**Response (success, NHI service available):**
```json
{
  "success": true,
  "data": {
    "drug_name": "pembrolizumab",
    "drug_name_zh": "吉舒達",
    "reimbursement_rules": [
      {
        "section": "9.69",
        "section_name": "免疫檢查點抑制劑",
        "conditions": ["限用於非小細胞肺癌、肝細胞癌", "排除 EGFR/ALK 陽性患者"],
        "requires_prior_auth": true,
        "applicable_indications": ["非小細胞肺癌", "肝細胞癌", "黑色素瘤"]
      }
    ],
    "source_chunks": [
      {
        "chunk_id": "nhi_s09_a3f8c2d1",
        "text_snippet": "9.69 免疫檢查點抑制劑 限用於下列適應症...",
        "relevance_score": 0.91
      }
    ],
    "confidence": 0.88,
    "answer": "吉舒達目前有健保給付，限用於非小細胞肺癌等適應症，需事前審查。"
  }
}
```

**Response (NHI service DOWN — graceful fallback):**
```json
{
  "success": true,
  "message": "NHI 服務暫時無法連線，此回答僅供參考",
  "data": {
    "drug_name": "pembrolizumab",
    "drug_name_zh": "吉舒達",
    "reimbursement_rules": [],
    "source_chunks": [],
    "confidence": 0.25,
    "answer": "依一般知識：pembrolizumab 有條件健保給付，需事前審查。..."
  }
}
```

**Validation error (empty drug_name):**
```json
{ "detail": [...] }  // HTTP 422
```

**Notes:**
- Auth: requires valid JWT (any role)
- Rate limit: `RATE_LIMIT_AI_CLINICAL` (default 10/minute)
- NHI service URL: `NHI_SERVICE_URL` env var (default `http://127.0.0.1:8001`)
- `drug_name_zh`: populated from 35-entry mapping table for common English drug names (e.g., `pembrolizumab` → `吉舒達`, `rituximab` → `莫須瘤`)
- `requires_prior_auth`: `true` when chunk text contains `事前審查` or `事先核准`
- `confidence`: average of top-3 chunk relevance scores (capped at 0.95); 0.25 for LLM fallback
- When `message` is present, it signals degraded service — display as warning in UI
- Audit log action: `健保給付查詢`

---

### [READY] Bulletin Board Tags — Pharmacy Advice Auto-tagging & Reply Acceptance

> **Status:** Implemented 2026-04-06. Backend ready for frontend integration.

#### Changes to existing endpoints

**`POST /patients/{id}/messages` — Create Message (updated)**

New optional field in request body:
```json
{
  "content": "已接受此建議，已調整劑量",
  "messageType": "general",
  "replyToId": "pmsg_abc123",
  "adviceAction": "accept"
}
```

- `adviceAction` (optional): `"accept"` or `"reject"`. Only valid when replying (`replyToId` set) to a `medication-advice` message that has a linked `advice_record_id`.
- **Auth:** Only `doctor` or `admin` can use `adviceAction`.
- **Side effect:** Updates the linked `PharmacyAdvice` record (accepted, responded_by_id, responded_by_name, responded_at).
- **Error cases:**
  - 403: non-doctor/admin tries to use adviceAction
  - 422: parent is not medication-advice, or has no linked advice record
  - 409: advice already responded to (duplicate)
  - 404: linked advice record not found

**Response `message` field reflects sync:**
```json
{ "success": true, "data": { ... }, "message": "訊息已發送，藥事建議已接受" }
```

**`GET /patients/{id}/messages` — List Messages (no change needed)**
- `adviceAccepted` and `adviceRespondedBy` are already returned for medication-advice messages with linked advice records. These now reflect replies made via `adviceAction`.

#### New endpoint

**`GET /pharmacy/advice-records/tag-stats` — Tag Usage Statistics**

```
GET /pharmacy/advice-records/tag-stats?month=2026-04
```

- **Auth:** `pharmacist` or `admin`
- **Query params:** `month` (optional, YYYY-MM format)

**Response:**
```json
{
  "success": true,
  "data": {
    "tagStats": [
      { "tag": "建議處方", "count": 42 },
      { "tag": "1-1 給藥問題", "count": 15 },
      { "tag": "1-5 藥品交互作用", "count": 12 },
      { "tag": "主動建議", "count": 8 },
      { "tag": "2-6 建議用藥/建議增加用藥", "count": 5 }
    ]
  }
}
```

**Notes:**
- Aggregates from `patient_messages.tags` JSONB array using `jsonb_array_elements_text`
- Only counts top-level medication-advice messages (excludes replies)
- Tag format: category tags are short labels ("建議處方"), subcode tags are "code label" format ("1-1 給藥問題")

#### Auto-tagging behavior

When a pharmacy advice record is created via `POST /pharmacy/advice-records`, the linked `PatientMessage` is automatically tagged with:
1. Category tag: e.g. `"建議處方"` (derived from `CATEGORY_TAG_MAP`)
2. Subcode tag: e.g. `"1-1 給藥問題"` (code + short label, readable format)

Existing messages were backfilled via migrations 032 + 033.

#### Subcode tag label mapping (27 codes)

| Code | Tag Label |
|------|-----------|
| 1-1 | 1-1 給藥問題 |
| 1-2 | 1-2 適應症問題 |
| 1-3 | 1-3 用藥禁忌問題 |
| 1-4 | 1-4 藥品併用問題 |
| 1-5 | 1-5 藥品交互作用 |
| 1-6 | 1-6 疑似藥品不良反應 |
| 1-7 | 1-7 藥品相容性問題 |
| 1-8 | 1-8 其他 |
| 1-9 | 1-9 不符健保給付規定 |
| 1-10 | 1-10 用藥劑量/頻次問題 |
| 1-11 | 1-11 用藥期間/數量問題 |
| 1-12 | 1-12 用藥途徑或劑型問題 |
| 1-13 | 1-13 建議更適當用藥/配方組成 |
| 2-1 | 2-1 用藥劑量/頻次問題 |
| 2-2 | 2-2 用藥期間/數量問題 |
| 2-3 | 2-3 用藥途徑或劑型問題 |
| 2-4 | 2-4 建議更適當用藥/配方組成 |
| 2-5 | 2-5 藥品不良反應評估 |
| 2-6 | 2-6 建議用藥/建議增加用藥 |
| 2-7 | 2-7 建議藥物治療療程 |
| 2-8 | 2-8 建議靜脈營養配方 |
| 3-1 | 3-1 建議藥品療效監測 |
| 3-2 | 3-2 建議藥品不良反應監測 |
| 3-3 | 3-3 建議藥品血中濃度監測 |
| 4-1 | 4-1 藥歷審核與整合 |
| 4-2 | 4-2 藥品辨識/自備藥辨識 |
| 4-3 | 4-3 病人用藥遵從性問題 |

---

### [PLANNED] GET `/system/sources` — Source Health Status (B02)

> **Status:** Not yet implemented. Backend will update this section when ready.

**Response:**
```json
{
  "success": true,
  "data": {
    "sources": [
      {
        "name": "source_a_clinical_rag",
        "url": "http://localhost:8000",
        "is_available": true,
        "last_checked": "2026-03-02T10:30:00Z",
        "latency_ms": 45
      },
      {
        "name": "source_b_drug_rag",
        "url": "http://localhost:8100",
        "is_available": true,
        "last_checked": "2026-03-02T10:30:00Z",
        "latency_ms": 120
      },
      {
        "name": "source_c_drug_graph",
        "url": "in-process",
        "is_available": true,
        "last_checked": "2026-03-02T10:30:00Z",
        "drugs_loaded": 352
      }
    ]
  }
}
```

---

### [PLANNED] Citation Schema — Added to existing endpoints (B11)

> **Status:** Not yet implemented. Will be added to `/clinical/summary`, `/clinical/guideline`, `/clinical/decision`, `/clinical/explanation`.

**New field added to response `data`:**
```json
{
  "citations": [
    {
      "source_system": "clinical_rag_guideline | drug_rag_qdrant | drug_graph",
      "text_snippet": "For adult ICU patients...",
      "evidence_grade": "1B | monograph | curated",
      "relevance_score": 0.87
    }
  ],
  "confidence": 0.75,
  "requires_expert_review": false
}
```

**Frontend handling:**
- If `citations` is absent or empty → don't render citation section (backward compatible)
- If `requires_expert_review: true` → show warning banner
- If `confidence` is present → show confidence indicator

---

### [CLARIFIED] GET `/dashboard/stats` — Dashboard Aggregate Stats (Bug A)

- **Fixed by:** backend session (Plan B Step 1, commit `d7563a1`)
- **Date:** 2026-04-14
- **Bug history:** Prior to the fix, this endpoint returned 500 due to `json_array_length(jsonb)` not existing in Postgres. Handler now casts `Patient.alerts` to `JSON` only on Postgres, skips the cast on SQLite. No schema change.

**Request:** `GET /dashboard/stats` (no params, auth required)

**Response 200**
```json
{
  "success": true,
  "data": {
    "patients": {
      "total": 18,
      "intubated": 4,
      "intubatedBeds": ["ICU-01", "ICU-03", "ICU-07", "ICU-12"],
      "withSAN": 11,
      "sanByCategory": {
        "sedation": 9,
        "analgesia": 10,
        "nmb": 0
      }
    },
    "alerts": {
      "total": 23
    },
    "medications": {
      "active": 142,
      "sedation": 28,
      "analgesia": 34,
      "nmb": 0
    },
    "messages": {
      "today": 7,
      "unread": 3
    },
    "timestamp": "2026-04-14T09:12:33.451+00:00"
  }
}
```

**Frontend handling:**
- Matches existing `DashboardStats` interface (F09) — no migration needed.
- `intubatedBeds` is always present; may be empty array. Use `.length` not `null` checks.
- `sanByCategory` keys are lowercase English (`sedation`/`analgesia`/`nmb`) — distinct from the medications count keys (`sedation`/`analgesia`/`nmb`, same names but different semantics: one counts distinct patients per category, the other counts active medication rows).

---

### [CLARIFIED] GET `/sync/status` — HIS Snapshot Sync Status (F15)

- **Fixed by:** backend session (Plan B Step 3, Vercel rewrite commit `47c15d9`)
- **Date:** 2026-04-14
- **Bug history:** Backend endpoint already existed and worked — the gap was that `/sync/:path*` was not in `vercel.json` rewrites, so Vercel's SPA catch-all served HTML for this path. Now proxied through to Railway correctly. Verified end-to-end via Playwright on production.

**Request:** `GET /sync/status` (no params, auth required)

**Response 200 — normal case**
```json
{
  "success": true,
  "data": {
    "available": true,
    "source": "his_snapshots",
    "version": "2026-04-14T08:00:01+00:00",
    "lastSyncedAt": "2026-04-14T08:00:01+00:00",
    "details": {
      "patients_synced": 13,
      "errors": []
    }
  }
}
```

**Response 200 — no sync_status row yet**
```json
{
  "success": true,
  "data": {
    "available": false,
    "source": "his_snapshots",
    "version": null,
    "lastSyncedAt": null,
    "details": null
  }
}
```

**Frontend handling:**
- `useExternalSyncPolling` reads `version` as the change detector — when it changes, invalidate patient/dashboard caches. **Do not** compare `lastSyncedAt` (can stay equal across polls even when new data arrives).
- `available: false` = launchd job hasn't run yet; display "尚未同步" not an error.
- Polled every ~60s from the client. Proxied via `vercel.json` `/sync/:path*` rewrite — `x-request-id` header **not** required (no SPA collision at `/sync`).

---

### [READY] GET `/api/v1/ai/readiness` — AI Preflight Gate (AO-01)

- **Added by:** backend session
- **Date:** 2026-04-14 (endpoint pre-existed; documenting contract here)
- **Purpose:** Frontend calls this before enabling any AI feature so the UI can gray-out buttons with an accurate reason instead of letting the user hit a downstream 500.

**Request:** `GET /api/v1/ai/readiness` (auth required)

**Response 200 — all green**
```json
{
  "success": true,
  "data": {
    "overall_ready": true,
    "checked_at": "2026-04-14T09:30:00+00:00",
    "llm": {
      "ready": true,
      "provider": "openai",
      "model": "gpt-4o-mini",
      "reason": null
    },
    "evidence": {
      "reachable": true,
      "ready": true,
      "reason": null,
      "last_error": null
    },
    "rag": {
      "ready": true,
      "is_indexed": true,
      "total_chunks": 32,
      "total_documents": 6,
      "engine": "hybrid_rag",
      "clinical_rules_loaded": true
    },
    "feature_gates": {
      "chat": true,
      "clinical_summary": true,
      "patient_explanation": true,
      "guideline_interpretation": true,
      "decision_support": true,
      "clinical_polish": true,
      "dose_calculation": true,
      "drug_interactions": true,
      "clinical_query": true
    },
    "blocking_reasons": [],
    "display_reasons": []
  }
}
```

**Feature-gate semantics (important):**
- `chat` — gated **only** on `llm_ready`. New chat uses the DB context builder, not RAG/evidence. Do NOT grey out chat when evidence/RAG are down.
- `clinical_summary` / `patient_explanation` / `clinical_polish` — gated only on `llm_ready`.
- `guideline_interpretation` / `decision_support` — gated on `llm_ready AND (evidence_reachable OR rag_indexed)`.
- `dose_calculation` / `drug_interactions` / `clinical_query` — gated on `evidence_reachable` (these routes hit evidence/`func/` service directly).

**Blocking reason codes (stable enum):**
| Code | Human-readable (zh-TW) |
|---|---|
| `LLM_API_KEY_MISSING` | LLM API key 未設定，AI 生成功能已停用。 |
| `LLM_PROVIDER_UNSUPPORTED` | LLM provider 設定不支援，請檢查後端設定。 |
| `EVIDENCE_UNREACHABLE` | Evidence 服務無法連線，劑量/交互作用與混合查詢功能暫不可用。 |
| `RAG_NOT_INDEXED` | RAG 尚未索引，臨床指引與帶文獻依據的回答可能降級。 |
| `KNOWLEDGE_SOURCE_UNAVAILABLE` | 知識來源不可用（Evidence 與本地 RAG 均不可用）。 |

**Frontend handling:**
- Call on app load after auth; cache for ~60s; re-call on window focus after long idle.
- Render the grayed-out buttons using `feature_gates`, not `overall_ready` (partial availability is common — e.g., chat works when evidence is down).
- `display_reasons` is pre-translated; safe to render directly in a tooltip / banner.
- `rag.engine` is `"hybrid_rag"` when evidence service is reachable, `"local_rag"` as fallback. Purely informational — don't branch UI on it.

---

## Duplicate Medication Detection (Added by Backend Session · 2026-04-23)

### [READY] GET `/patients/{patient_id}/medication-duplicates` — Single-Patient Duplicate Alerts

> **Status:** Implemented 2026-04-23 (Wave 1 + Wave 4a cache rewrite).
> Detects L1 (same ATC L5), L2 (same ATC L4), L3 (same mechanism cross-class), L4 (same therapeutic endpoint) duplication.

- **Auth:** any logged-in user with patient access (`verify_patient_access`)
- **Query params:**
  | Name | Type | Default | Values |
  |------|------|---------|--------|
  | `context` | string | `inpatient` | `inpatient` \| `outpatient` \| `icu` \| `discharge` |

**Cache behavior (Wave 4a):**
Cache is SHA-256 hashed on sorted `(medication_id, atc_code, status, updated_at)` tuples plus context. Hit returns immediately; miss triggers compute and write-through. `cached: boolean` reflects whether this specific response came from cache.

**Response:**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "fingerprint": "f62826ad9d9541ae",  // pragma: allowlist secret (SHA-256 fingerprint, not a secret)
        "level": "critical",
        "layer": "L2",
        "mechanism": "PPI × PPI",
        "members": [
          {
            "medicationId": "med_xxx",
            "genericName": "Omeprazole",
            "atcCode": "A02BC01",
            "route": "PO",
            "isPrn": false,
            "lastAdminAt": "2026-04-23T04:42:47.207316+00:00"
          }
        ],
        "recommendation": "停用其中一 PPI；若為換藥過渡期，overlap ≤ 48h 後應停單方。",
        "evidenceUrl": "guide://§3.1",
        "autoDowngraded": false,
        "downgradeReason": null
      }
    ],
    "counts": { "critical": 2, "high": 0, "moderate": 0, "low": 0, "info": 0 },
    "cached": true
  }
}
```

**Field semantics:**
- `level` — final severity after all upgrade / downgrade / whitelist rules: `critical` \| `high` \| `moderate` \| `low` \| `info`
- `layer` — which detection layer triggered: `L1` \| `L2` \| `L3` \| `L4`
- `fingerprint` — SHA-256(sorted medication_ids)[:16]; stable across reloads, usable as React key
- `autoDowngraded` — `true` when an auto-downgrade rule reduced severity (e.g., route switch, salt switch, PRN + scheduled, overlap ≤ 48h with transition signal)
- `downgradeReason` — short tag when downgraded: `route_switch` \| `salt_switch` \| `transitional_overlap_le_48h` \| `prn_plus_scheduled`
- `evidenceUrl` — internal pointer `guide://§3.1` (assessment guide section) or external URL when available

**Frontend client:** `src/lib/api/medications.ts::getMedicationDuplicates(patientId, context)`

---

### [READY] POST `/pharmacy/duplicate-summary` — Batched Counts for Dashboard / Workstation

> **Status:** Implemented 2026-04-23 (Wave 4a + Wave 5b).

- **Auth:** any logged-in user
- **Query params:** same `context` as above

**Request body:**
```json
{
  "patientIds": ["pat_xxx", "pat_yyy", "..."]
}
```
Accepts up to 200 ids. snake_case `patient_ids` also accepted (Pydantic alias).

**Response:**
```json
{
  "success": true,
  "data": {
    "results": {
      "pat_xxx": {
        "counts": { "critical": 1, "high": 0, "moderate": 1, "low": 1, "info": 0 },
        "cached": true
      },
      "pat_yyy": {
        "counts": { "critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0 },
        "cached": false
      }
    },
    "pending": ["pat_zzz"],
    "total": 3
  }
}
```

**Background warmup semantics:**
- Cache hits return counts immediately.
- Cache misses return zeroed counts **and** schedule a background `refresh_patient_cache` via FastAPI `BackgroundTasks` using a fresh `async_session`.
- `pending[]` contains patient ids that are being warmed — frontend can optionally retry once after ~10s to pick up those counts.

**Frontend client:** `src/lib/api/medications.ts::fetchPharmacyDuplicateSummary(patientIds, context)`
Normalizer in the client handles both `{results, pending, total}` (current envelope) and `{counts, pending}` (legacy spec) shapes, and guarantees a zeroed entry for every requested id.

---

### [READY] GET `/patients/{patient_id}/discharge-check` — Discharge Medication Reconciliation

> **Status:** Implemented 2026-04-23 (Wave 6a).
> Compares inpatient meds active at discharge against the discharge order set, flags missed discontinuations by 4 clinical categories, and runs the duplicate detector over the discharge set itself.

- **Auth:** any logged-in user with patient access
- **Query params:** none

**Response:**
```json
{
  "success": true,
  "data": {
    "patientId": "pat_xxx",
    "dischargeDate": "2026-04-20",
    "dischargeType": "一般出院",
    "inpatientActiveAtDischarge": [
      {
        "medicationId": "med_inp_001",
        "genericName": "Pantoprazole",
        "atcCode": "A02BC02",
        "indication": "SUP",
        "startDate": "2026-04-10"
      }
    ],
    "dischargeMedications": [
      { "medicationId": "med_out_001", "genericName": "Omeprazole", "atcCode": "A02BC01", "daysSupply": 14 }
    ],
    "missedDiscontinuations": [
      {
        "medicationId": "med_inp_001",
        "genericName": "Pantoprazole",
        "atcCode": "A02BC02",
        "category": "sup_ppi",
        "severity": "high",
        "reason": "住院時開立 IV PPI 作為 SUP，出院單未繼續開立也未記錄停藥；常見 ICU 病房轉出陷阱。",
        "inpatientStartDate": "2026-04-10"
      }
    ],
    "dischargeDuplicates": [ /* DuplicateAlert[], same schema as /medication-duplicates */ ],
    "counts": {
      "missedDiscontinuations": 3,
      "dischargeDuplicates": { "critical": 0, "high": 1, "moderate": 0, "low": 0, "info": 0 }
    }
  }
}
```

**Missed-discontinuation categories & severity:**
| `category` | `severity` | Trigger |
|------------|-----------|---------|
| `sup_ppi` | `high` | ATC `A02BC*` or `*prazole` generic name AND (indication contains SUP/stress ulcer/GI prophylaxis/壓力性潰瘍/預防 OR route IV from inpatient) |
| `empirical_antibiotic` | `high` | `is_antibiotic=True` AND course ≤ 7 days |
| `prn_only` | `low` | PRN meds not on discharge order |
| `other` | `moderate` | Scheduled inpatient meds with no discharge continuation |

**Same-drug matching order (for "carried on" check):**
1. Exact ATC L5 (7 chars)
2. ATC L4 prefix (5 chars)
3. Case-insensitive `generic_name` fallback

`end_date < discharge_date` inpatient rows are excluded from `inpatientActiveAtDischarge`. If `discharge_date IS NULL` (still inpatient) the endpoint returns 200 with all arrays empty.

**Frontend client:** `src/lib/api/discharge.ts::getDischargeCheck(patientId)`

---

### Non-HTTP consumers (document for completeness)

These aren't standalone endpoints but are part of the duplicate-medication pipeline and surface in behavior tests:

- **AI snapshot injection** — `POST /ai-chat/*` internally calls `build_clinical_snapshot()` which appends `format_duplicate_text()` output to the system prompt. Context inferred from `patient.unit` (contains "icu" → `icu`, else `inpatient`). Detector crashes log-and-continue, snapshot never fails.
- **HIS sync post-hook** — `python -m scripts.sync_his_snapshots` calls `post_sync_refresh_duplicates()` after meds upsert, before global sync status write. Wrapped in try/except per-patient. CLI flag `--skip-duplicate-refresh` disables hook for ops debugging.
