# Phase 5 — Final Summary

Generated at: 2026-02-16 16:09:28 CST

## 1) Final Structure Tree (Post-Restructure)

```text
/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
├── src/                         # Frontend app (routes/pages/components/lib)
├── backend/
│   ├── app/                     # FastAPI app (routers/services/models/schemas)
│   ├── alembic/                 # DB migrations
│   ├── tests/                   # Backend unit/integration/contract tests
│   └── seeds/                   # Seed scripts
├── e2e/                         # Playwright E2E
├── docs/                        # Architecture/operation/security docs
├── reports/                     # Restructure reports (00~05)
├── _archive_candidates/
│   └── 20260216/                # Quarantined legacy/orphan candidates
├── datamock/                    # Runtime mock/reference data
├── func/                        # RAG/AI support artifacts
└── .github/workflows/           # CI gates/workflows
```

## 2) Active vs Archive List

### Active (runtime/build/test chain)
- Frontend runtime: `src/main.tsx`, `src/App.tsx`, `src/lib/api/*`.
- Backend runtime: `backend/app/main.py`, `backend/app/routers/*`, `backend/app/services/*`.
- DB path: `backend/app/models/*`, `backend/alembic/versions/*`.
- CI and automation: `.github/workflows/ci.yml`, `package.json`, `backend/pyproject.toml`.
- Verification evidence: all Phase 4 checks PASS (`reports/04_verification.md`).

### Archived (quarantine, non-destructive)
- `_archive_candidates/20260216/ChatICU/**`
- `_archive_candidates/20260216/AI_AUDIT_REPORT.md`
- `_archive_candidates/20260216/AI_TASK_TRACKER.md`
- `_archive_candidates/20260216/patches/prompt-P00.patch` ... `prompt-P09.patch`
- `_archive_candidates/20260216/reports/prompt-P00-result.md` ... `prompt-P09-result.md`
- `_archive_candidates/20260216/reports/final-integration-gate.md`

## 3) Risks / Open Items (Need Human Decision)

1. Many low-confidence files remain (`ORPHAN_CANDIDATE=513` from `reports/01_usage_evidence.csv`).
   - Current action kept conservative: only moved candidates with strong non-runtime evidence.
   - Decision needed: whether to run second-pass archive for additional ORPHAN files in docs/scripts/misc paths.

2. `backend` startup latency is high (~18-24s before "Application startup complete" in this environment).
   - Runtime availability is correct (health endpoint returns 200), but CI/dev probe timeout should account for startup time.

3. High-risk paths (entrypoints, router registration, migrations) intentionally not moved.
   - Manual review required before any structural move under:
     - `src/main.tsx`, `src/App.tsx`
     - `backend/app/main.py`
     - `backend/alembic/versions/*`

## 4) Next-Step Recommendations (CI Gate to Prevent Re-Drift)

1. Add CI check to block reintroduction of legacy root app tree:
   - Fail if top-level `ChatICU/` appears outside `_archive_candidates/`.
2. Add CI check for orphan-growth trend:
   - Regenerate `reports/01_usage_evidence.csv` and fail when ORPHAN count increases beyond baseline threshold.
3. Add startup smoke timeout policy:
   - Backend smoke should wait for readiness log (not fixed sleep).
4. Keep quarantine policy:
   - All future cleanup uses `_archive_candidates/YYYYMMDD/` + rollback commands; no direct delete in first pass.

## Rollback (This Batch)

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
mv _archive_candidates/20260216/ChatICU ./ChatICU
mv _archive_candidates/20260216/AI_AUDIT_REPORT.md ./AI_AUDIT_REPORT.md
mv _archive_candidates/20260216/AI_TASK_TRACKER.md ./AI_TASK_TRACKER.md
mv _archive_candidates/20260216/patches/prompt-P*.patch ./patches/
mv _archive_candidates/20260216/reports/final-integration-gate.md ./reports/
mv _archive_candidates/20260216/reports/prompt-P*-result.md ./reports/
```
