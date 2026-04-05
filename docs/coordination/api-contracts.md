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
