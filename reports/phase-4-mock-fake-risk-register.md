# Phase 4 Mock/Fake Risk Register

Generated at: 2026-02-17 13:06 CST
Input baselines:
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-1-frontend-requirement-catalog.md`
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-2-contract-matrix.md`
- `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/phase-3-field-lineage-matrix.md`

## 1) Scope and Risk Criteria

- Objective: identify mock/fake/degraded data paths that can contaminate clinical reading or hide contract semantics.
- `User-visible contamination risk`: user may treat non-authoritative/degraded/generated content as real-time clinical truth.
- `API contract contamination risk`: endpoint schema remains valid, but semantic source/provenance is not explicit or not persistent.

Severity rule:
- `High`: can directly mislead clinical interpretation or generate non-persistent but realistic records.
- `Medium`: quality/readability degradation that can bias decisions but has partial guardrails.
- `Low`: latent or dev-only contamination risk.

## 2) Mock/Fake Risk Register

| Risk ID | Surface | Mock/Fake Pattern | User-visible contamination risk | API contract contamination risk | Severity | Likelihood | Existing guardrail | Evidence |
|---|---|---|---|---|---|---|---|---|
| R-MF-001 | Infra + Data bootstrap | Docker default falls back to `DATA_SOURCE_MODE=json`, then auto-validates/seeds from `datamock` | Environment can look "working" but data is offline snapshot, not live clinical feed | Same response schema in API; semantic mode difference only appears in freshness hints | High | Medium | `dataFreshness.hints` includes JSON/offline warnings | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.yml:17`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/docker-compose.yml:22`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/seeds/seed_if_empty.py:33`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/utils/data_freshness.py:178` |
| R-MF-002 | Medications API | Administration timeline is synthetic schedule + in-memory override map (not DB persisted) | UI sees plausible administration events that are generated, not true MAR records | `PATCH administrations` returns success shape but persistence is process-memory only | High | High | Basic audit log for updates | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:26`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:73`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:108`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/medications.py:316` |
| R-MF-003 | AI chat/clinical/rag | Hybrid service failures silently degrade to TF-IDF/local deterministic branches with same response envelope | User may interpret fallback answers as equivalent to fully evidence-backed path | Same `message` contract across branches; provenance is metadata, not primary answer plane | High | Medium | `degraded/degradedReason`, readiness gate, evidence gate metadata | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:714`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:744`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:812`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:847`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/rag.py:98`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/clinical.py:71` |
| R-MF-004 | Citation quality | Citation merge key uses raw `sourceFile/title`; canonicalization is incomplete | Same PDF can appear multiple times, reducing trust; page may show unknown | `citations[]` passes schema but logical dedup/page completeness is inconsistent | Medium | High | Merge routine + page extraction heuristic | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:381`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:392`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:517`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:214`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:228` |
| R-MF-005 | Citation snippet fidelity | Snippet text may be OCR-broken, partial, or missing despite citation card render | User sees fragmented evidence text and cannot quickly verify original meaning | `snippet` is optional and quality-unbounded; FE must render inconsistent text | Medium | Medium | Snippet cleanup heuristic + "未提供原文段落" fallback | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:333`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/ai_chat.py:446`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:1186`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:1191` |
| R-MF-006 | Chat UI information architecture | Main answer, explanation, references, and system/freshness info compete in same layer with multiple fold controls | Reading path for clinical action is interrupted by operational metadata | Contract is valid but presentation conflates decision content and system state | Medium | High | Explanation and reference collapses exist | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:1083`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:1126`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patient-detail.tsx:1201` |
| R-MF-007 | FE repository hygiene | Large legacy mock dataset file remains in tree (`src/lib/mock-data.ts`) | Future accidental import can reintroduce fake data into UI paths | Type shapes can drift from backend contracts over time | Low | Medium | No active runtime import currently detected in `src/` scan | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/mock-data.ts:1` |
| R-MF-008 | Auth runtime fallback | Redis outage in `DEBUG=true` mode downgrades to in-memory store | Token blacklist/lockout semantics become non-persistent while service appears normal | Auth behavior differs from production semantics under same API contract | Low | Medium | Disabled in non-debug; explicit warning logs | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/middleware/auth.py:22`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/middleware/auth.py:85`, `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/middleware/auth.py:100` |

## 3) Contamination Path Map

1. Startup contamination path (`R-MF-001`):
- `docker compose up` -> `DATA_SOURCE_MODE=${...:-json}` -> `seed_if_empty` from datamock -> APIs return valid schema with offline semantics.

2. Medication administration semantic-fake path (`R-MF-002`):
- `GET /medications/{id}/administrations` -> synthetic schedule generation -> UI renders as if real administrations.
- `PATCH .../administrations/{id}` -> in-memory override only -> restart loses state.

3. AI degraded-path contamination (`R-MF-003`, `R-MF-004`, `R-MF-005`, `R-MF-006`):
- Hybrid evidence failure -> TF-IDF/deterministic fallback -> answer still rendered in primary clinical card.
- Citation merge/page/snippet quality variability -> duplicate docs/unknown page/fragmented excerpt.
- System status and freshness hints appear in same reading layer as recommendation text.

## 4) Prioritized Replacement Plan (for Phase 5 backlog input)

### P0 (must-fix before relying on production-like decisions)

1. Replace synthetic medication administrations with persisted model/table.
- Add `medication_administrations` table + migration.
- `GET/PATCH administrations` must round-trip DB state (no `_ADMINISTRATION_OVERRIDES`).

2. Remove implicit JSON default in docker runtime.
- Change compose default to `db`; require explicit `DATA_SOURCE_MODE=json` opt-in profile for demo/offline.

### P1

1. Add provenance-first metadata for AI outputs.
- Return explicit `answerMode` (`hybrid_rag`, `tfidf_fallback`, `deterministic_fallback`, `llm_unavailable`) in top-level message payload.
- FE renders a compact mode badge near answer title (not mixed into paragraph body).

2. Strengthen citation normalization and display quality.
- Canonicalize `sourceFile` key before merge (basename + normalized path map).
- Enforce page completeness policy for top citations; if missing page, surface `source lookup needed` state.

3. Simplify UI controls.
- Keep one primary short answer block.
- Keep one secondary fold for "說明" and one secondary fold for "參考依據".
- Move system/freshness to a separate low-emphasis section outside answer card.

### P2

1. Retire or quarantine legacy FE mock dataset module.
- Move `src/lib/mock-data.ts` to `archive/` or enforce lint rule preventing imports.

2. Add explicit telemetry for debug fallbacks.
- Counter/log events for Redis in-memory fallback and degraded AI paths for ops dashboards.

## 5) Verification Checklist and Exit Criteria

Phase 4 exit criteria (report phase):
- [x] All mock/fake/degraded risks are enumerated with file:line evidence.
- [x] Each risk has severity + likelihood + mitigation direction.
- [x] P0/P1/P2 replacement priorities are defined.

Recommended verification commands for follow-up implementation phases:
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && pytest backend/tests/test_api/test_medications_api.py -q`
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && pytest backend/tests/test_api/test_contract.py -q`
- `cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run typecheck && npm run build`

## 6) Current Gate

- `Phase 4`: Completed (risk register created with actionable mitigation backlog input).
