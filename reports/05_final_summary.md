# Phase 5 — Final Summary

**Date:** 2026-02-18

---

## 1. Final Structure Tree

```
ChatICU_2026_verf_0110_Yu/
├── backend/                          ← Production FastAPI (UNCHANGED)
│   ├── app/                          ← 78 .py: routers, models, schemas, services, utils, middleware
│   ├── alembic/                      ← 7 DB migrations
│   ├── seeds/                        ← Seeding logic (datamock → PostgreSQL)
│   ├── tests/                        ← 85+ tests
│   ├── docs/                         ← Backend-specific docs
│   ├── Dockerfile                    ← Multi-stage build
│   ├── docker-compose.yml            ← backend + postgres + redis
│   ├── requirements.txt / .lock      ← Dependencies
│   └── .venv312/                     ← Python 3.12 venv
├── src/                              ← Frontend React/TS (CLEANED)
│   ├── assets/                       ← Images
│   ├── components/                   ← ui/ (61), patient/, domain components (7)
│   ├── imports/                      ← ONLY svg-n38m0xb9r6.ts (login page SVG)
│   ├── lib/                          ← api/ (14), auth-context, api-client, utils
│   ├── pages/                        ← 17 route pages
│   └── styles/                       ← Global CSS
├── func/                             ← Evidence RAG microservice (UNCHANGED)
│   ├── evidence_rag/                 ← Core RAG modules
│   ├── clinical_rules/               ← Dose/interaction rules
│   ├── raganything/                   ← Document processing
│   └── evidence_rag_data/            ← Indices + raw data
├── datamock/                         ← JSON seed data (UNCHANGED, 8 files)
├── rag 文本/                         ← Medical PDFs (UNCHANGED, 44 files, 5 categories)
├── e2e/                              ← Playwright E2E tests (UNCHANGED)
├── scripts/                          ← Ops/test scripts (UNCHANGED)
├── docs/                             ← All documentation (EXPANDED)
│   ├── frontend/                     ← NEW: 9 docs relocated from src/
│   ├── operations/                   ← Runbooks, reproducibility reports
│   ├── qa/                           ← UAT, test scripts, release gates
│   ├── release/                      ← Change requests, rollback SOP
│   └── security/                     ← Vulnerability register, evidence
├── .github/workflows/                ← CI (UNCHANGED)
├── reports/                          ← Current reports only (CLEANED)
│   ├── 00-05 restructuring reports   ← This session's outputs
│   └── operations/                   ← Active operational evidence
├── _archive_candidates/              ← Safe storage for orphaned items
│   ├── 20260216/                     ← ChatICU prototype + old artifacts
│   └── 20260218/                     ← This session: 30 archived files
├── server/                           ← Dart Frog (DEFERRED — needs user decision)
└── [root configs]                    ← package.json, tsconfig, vite.config, etc.
```

## 2. Active vs Archive Summary

### ACTIVE (in production build/test chain)

| Component | Files | Purpose |
|-----------|-------|---------|
| backend/ | 78 app + 28 test + 7 migration + 5 seed | FastAPI production backend |
| src/ | 102 .ts/.tsx (was 114, removed 12 orphans) | Frontend React/TS |
| func/ | ~40 .py | Evidence RAG microservice |
| datamock/ | 8 JSON | Seed data for development |
| rag 文本/ | 44 PDFs | Medical knowledge base |
| e2e/ | 4 files | E2E Playwright tests |
| scripts/ | 4 shell scripts | Ops automation |
| docs/ | 41 docs (incl. 9 relocated) | Documentation |
| .github/ | 1 CI workflow | GitHub Actions |

### ARCHIVED (in _archive_candidates/20260218/)

| Item | Size | Reason |
|------|------|--------|
| `config.py` | 2 KB | Root-level orphan; zero imports; Python 3.10+ syntax |
| `security_report.json` | 64 KB | One-time scan referencing archived ChatICU/ |
| `chaticu-dev-skill/` | 92 KB | Skill templates; no runtime imports |
| `.orchestrator/` | 12 KB | Old orchestrator state |
| `src/lib/mock-data.ts` | 53 KB | Old mock data; zero .ts/.tsx imports |
| `src/components/figma/ImageWithFallback.tsx` | 1 KB | Not imported by any component |
| `src/hooks/use-api.ts` | 3 KB | Utility hook; zero consumers |
| 12 Figma imports from `src/imports/` | ~100 KB | Orphaned Figma design exports |
| `patches/` (3 files) | 68 KB | Old orchestrator patches |
| 12 old reports | ~200 KB | Historical orchestrator reports |

**Total archived:** ~600 KB across 30 files

## 3. Risks & Open Items

### REQUIRES USER DECISION

| Item | Risk | Recommendation |
|------|------|----------------|
| **`server/` (Dart Frog, 528KB)** | `stats.dart` is modified in current branch `ai/meds-layout-api-sync`. May be intentional reference sync. | If server/ is purely for reference: archive it. If actively syncing with backend: keep it but add `NOTE: This is a reference implementation, not the production backend` README. |

### PRE-EXISTING ISSUES (not caused by this restructuring)

| Item | Description |
|------|-------------|
| `test_rag_query_not_indexed` | Backend test fails with divide-by-zero in rag_service.py:103 when no index exists. Fix: add zero-division guard in `rag_service.py`. |
| `index` chunk > 500KB | Frontend build warning. Consider code-splitting patient-detail.tsx (largest page). |

## 4. Next Steps (CI Gate Recommendations)

To prevent re-accumulation of orphaned files:

1. **Add `.gitignore` entries:**
   ```
   # Already gitignored
   __pycache__/
   .pre-commit-cache/
   output/
   build/

   # Consider adding
   _archive_candidates/
   ```

2. **CI orphan detection gate** (add to `.github/workflows/ci.yml`):
   ```yaml
   - name: Check for orphaned imports
     run: |
       # Verify no new Figma exports are committed without being imported
       for f in src/imports/*.tsx src/imports/*.ts; do
         [ -f "$f" ] || continue
         base=$(basename "$f" .tsx)
         base=$(basename "$base" .ts)
         grep -r "$base" src/pages/ src/components/ src/lib/ --include="*.tsx" --include="*.ts" -q || echo "ORPHAN: $f"
       done
   ```

3. **Enforce docs location** — markdown files should live in `docs/`, not `src/`.

4. **Periodic cleanup cadence** — run this audit quarterly to catch drift.
