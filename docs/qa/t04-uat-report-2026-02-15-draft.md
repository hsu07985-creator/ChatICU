# T04 UAT Report (Final — 2026-02-20)

## Metadata
- Date: 2026-02-15 (final update 2026-02-20)
- Environment (dev/stg/prod): CI + local PostgreSQL/Redis + Docker backend + Playwright manual UAT
- Build/Commit: `8c04b3b` (original) → branch `ai/meds-layout-api-sync` (2026-02-20 final)
- Run ID (if from CI): `22033862853` / `22033938836` / `22034008508` (critical pipeline), `22033478586` (extended journeys), `22196650792` (latest CI)
- Executor: Codex + Dev + Playwright MCP
- Reviewer: Pending PM/QA sign-off

## Summary
- Total cases: 8
- Passed: **8**
- Failed: 0
- Blocked/Pending: 0

## Backend Test Evidence (2026-02-20)
- **194 passed, 13 skipped, 0 failed** (5 min 6 sec)
- Hanging test `test_audit_logs_support_user_and_date_filters` fixed (was blocking CI)
- RAG pipeline verified end-to-end with real OpenAI API:
  - `embed_texts`: 342 chunks → dim=(342, 3072) via `text-embedding-3-large` — 5.9s
  - `generate_chunk_context`: GPT-5 reasoning mode — 2 chunks verified (Traditional Chinese output)
  - `retrieve`: hybrid vector + BM25 (jieba Chinese tokenizer) — 3 queries verified
  - `query`: full RAG generation via GPT-5 — Propofol vs Dexmedetomidine comparison with 5 citations
  - Index persistence: save → load roundtrip 0.012s (vs 5.7s indexing)
- AI features tested: clinical summary, explanation, guideline, decision, polish, ai-chat (all via mock in unit tests; real API in E2E RAG pipeline)

## Manual UAT Evidence (2026-02-20)
- **Environment**: Docker `backend-api-1` (port 8000) + Vite dev server (port 3000) + brew PostgreSQL 16 + brew Redis
- **Seed strategy**: `SEED_PASSWORD_STRATEGY=username` (password = username)
- **Login**: admin/admin → 200 OK, redirected to `/dashboard`
- **Network log** confirms all API calls are real (no mock-data imports):
  - `POST /auth/login => 200`
  - `GET /patients? => 200`
  - `GET /patients/pat_001/messages? => 200`
  - `POST /patients/pat_001/messages => 200` (UAT-003)
  - `GET /patients/pat_001/lab-data/trends?days=7 => 200` (UAT-006)
  - `GET /pharmacy/advice-records?month=2026-02 => 200` (UAT-007)

## Case Results
| Case ID | Result | Defect ID | Notes | Evidence Link |
|---|---|---|---|---|
| UAT-T04-001 | Pass | - | Login flow verified by critical E2E + manual Playwright | `docs/qa/evidence/uat-t04-dashboard.png` |
| UAT-T04-002 | Pass | - | Patients list → patient detail (張三 pat_001) verified | `docs/qa/evidence/uat-t04-dashboard.png` |
| UAT-T04-003 | **Pass** | - | Message board: sent "UAT-T04-003 驗證：管理者發送留言測試", POST 200, count 4→5, toast "留言發送成功" | `docs/qa/evidence/uat-t04-003-message-board.png` |
| UAT-T04-004 | Pass | - | Team chat route/login/logout verified in extended journey run | CI run `22033478586` |
| UAT-T04-005 | Pass | - | AI chat POST `/ai/chat` 200 verified; real GPT-5 RAG pipeline verified | CI run `22034008508` |
| UAT-T04-006 | **Pass** | - | Lab trend: clicked K(鉀), dialog "鉀 (K) 歷史趨勢分析" opened with chart (Y: mmol/L 3~4, data point 3.2), GET `/lab-data/trends?days=7` 200 | `docs/qa/evidence/uat-t04-006-lab-trend.png` |
| UAT-T04-007 | **Pass** | - | Pharmacy advice records: page loaded "用藥建議與統計" (四大類 23 細項), GET `/pharmacy/advice-records?month=2026-02` 200, no mock imports | `docs/qa/evidence/uat-t04-007-pharmacy-advice.png` |
| UAT-T04-008 | Pass | - | Logout redirect to `/login` verified by critical E2E | CI run `22034008508` |

## Defect List
| Defect ID | Severity | Owner | Status | Target Fix Date |
|---|---|---|---|---|
| DEF-T04-20260215-001 | Medium | Frontend | Closed | 2026-02-15 |
| DEF-T04-20260220-001 | Low | Backend | Closed | 2026-02-20 |

- `DEF-T04-20260215-001`: `Objects are not valid as a React child` on lab card render, fixed in `src/components/lab-data-display.tsx` (`8c04b3b`).
- `DEF-T04-20260220-001`: `test_audit_logs_support_user_and_date_filters` hanging — `/ai/chat` call triggered full LLM chain in test. Fixed by direct `create_audit_log` DB insert.

## Conclusion
- Release recommendation: **Go** — all 8 UAT cases passed
- All defects closed
- Evidence screenshots stored in `docs/qa/evidence/`
- Network logs confirm zero mock-data usage, all API calls return 200 from real PostgreSQL backend

## Sign-off
- UAT date: 2026-02-20
- Environment: Docker backend + brew PostgreSQL 16 + brew Redis + Vite dev
- Executor: Claude Code (Playwright MCP)
- Reviewer: _________________ (PM/QA signature)
- Result: **Pass (8/8)**
- Known issues: None
