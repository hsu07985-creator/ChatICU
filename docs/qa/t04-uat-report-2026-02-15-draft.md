# T04 UAT Report (Draft — updated 2026-02-20)

## Metadata
- Date: 2026-02-15 (updated 2026-02-20)
- Environment (dev/stg/prod): CI + local verification + real API E2E
- Build/Commit: `8c04b3b` (original) → branch `ai/meds-layout-api-sync` (2026-02-20 updates)
- Run ID (if from CI): `22033862853` / `22033938836` / `22034008508` (critical pipeline), `22033478586` (extended journeys)
- Executor: Codex + Dev
- Reviewer: Pending PM/QA sign-off

## Summary
- Total cases: 8
- Passed: 5
- Failed: 0
- Blocked/Pending manual sign-off: 3

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

## Case Results
| Case ID | Result | Defect ID | Notes | Evidence Link |
|---|---|---|---|---|
| UAT-T04-001 | Pass | - | Login flow verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22034008508 |
| UAT-T04-002 | Pass | - | Patients list -> patient detail verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22034008508 |
| UAT-T04-003 | Pending | - | Message board send/receive requires manual UAT with running PostgreSQL + Redis | `docs/qa/t04-uat-test-script.md` |
| UAT-T04-004 | Pass | - | Team chat route/login/logout verified in extended journey run | https://github.com/jht12020304/ChatICU/actions/runs/22033478586 |
| UAT-T04-005 | Pass | - | AI chat POST `/ai/chat` 200 verified in critical E2E; real GPT-5 RAG pipeline verified 2026-02-20 | https://github.com/jht12020304/ChatICU/actions/runs/22034008508 |
| UAT-T04-006 | Pending | - | Lab trend click regression test added (`@t27-extended`), waiting CI/manual evidence capture | `e2e/t27-extended-journeys.spec.js` |
| UAT-T04-007 | Pending | - | Pharmacy advice records page/API requires manual UAT screenshot + network log | `docs/qa/t04-uat-test-script.md` |
| UAT-T04-008 | Pass | - | Logout redirect to `/login` verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22034008508 |

## Defect List
| Defect ID | Severity | Owner | Status | Target Fix Date |
|---|---|---|---|---|
| DEF-T04-20260215-001 | Medium | Frontend | Closed | 2026-02-15 |
| DEF-T04-20260220-001 | Low | Backend | Closed | 2026-02-20 |

- `DEF-T04-20260215-001`: `Objects are not valid as a React child` on lab card render, fixed in `src/components/lab-data-display.tsx` (`8c04b3b`).
- `DEF-T04-20260220-001`: `test_audit_logs_support_user_and_date_filters` hanging — `/ai/chat` call triggered full LLM chain in test. Fixed by direct `create_audit_log` DB insert.

## Conclusion
- Release recommendation: Conditional Go (pending 3 manual UAT items + sign-off)
- Remaining risk: Message board/pharmacy/manual lab trend click evidence not yet signed
- Required follow-up:
  1. Start PostgreSQL + Redis locally or in staging environment.
  2. Execute pending manual UAT cases UAT-T04-003/006/007 with Playwright screenshots.
  3. Attach screenshot/network evidence under `docs/qa/evidence/`.
  4. PM/QA complete reviewer signature and close T04.
