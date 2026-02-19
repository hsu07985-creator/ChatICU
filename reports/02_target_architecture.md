# Phase 2 — Target Architecture & Move Plan

**Date:** 2026-02-18

---

## Current vs Target Structure

The project already has reasonably clear module boundaries (backend/, src/, func/, datamock/).
The main issues are **orphaned files at root** and **misplaced docs in src/**.

### Current Problems

1. **Root clutter:** `config.py`, `security_report.json`, `chaticu-dev-skill/`, `.orchestrator/` — orphaned
2. **Dart Frog legacy:** `server/` — unused backend, confirmed by DEV_START doc
3. **Frontend orphans:** 12 Figma exports in `src/imports/`, `src/lib/mock-data.ts` (53KB), `ImageWithFallback.tsx`
4. **Misplaced docs:** 9 markdown files in `src/` that are design docs, not code
5. **Stale reports:** 12 old orchestrator reports in `reports/`
6. **Stale patches:** 3 old patches in `patches/`

### Target Architecture (minimal restructuring)

```
ChatICU_2026_verf_0110_Yu/
├── backend/                 ← (UNCHANGED) Production FastAPI
│   ├── app/                 ← routers, models, schemas, services, utils, middleware
│   ├── alembic/             ← DB migrations
│   ├── seeds/               ← Data seeding
│   ├── tests/               ← Backend tests
│   ├── Dockerfile
│   └── docker-compose.yml
├── src/                     ← (CLEANED) Frontend React/TS
│   ├── assets/
│   ├── components/          ← ui/, patient/, domain components
│   ├── hooks/
│   ├── imports/             ← ONLY svg-n38m0xb9r6.ts (used by login)
│   ├── lib/                 ← api/, auth-context, api-client, utils
│   ├── pages/               ← All route pages
│   └── styles/
├── func/                    ← (UNCHANGED) Evidence RAG microservice
├── datamock/                ← (UNCHANGED) JSON seed data
├── rag 文本/                ← (UNCHANGED) Medical PDFs
├── e2e/                     ← (UNCHANGED) E2E tests
├── scripts/                 ← (UNCHANGED) Ops scripts
├── docs/                    ← (EXPANDED) All documentation
│   ├── frontend/            ← NEW: relocated from src/*.md
│   ├── operations/
│   ├── qa/
│   ├── release/
│   └── security/
├── .github/                 ← (UNCHANGED) CI
├── reports/                 ← (CLEANED) Only current reports
│   └── operations/          ← (UNCHANGED)
├── _archive_candidates/     ← Archive of orphaned items
│   ├── 20260216/            ← Previous archive (ChatICU prototype)
│   └── 20260218/            ← NEW: This session's archive
└── [root configs]           ← package.json, tsconfig, vite.config, etc.
```

---

## Move Plan

### Batch 1: Root-level orphans → archive (LOW RISK)

| old_path | new_path | reason | confidence | risk |
|----------|----------|--------|-----------|------|
| `config.py` | `_archive_candidates/20260218/config.py` | Zero imports in entire codebase; Python 3.10+ syntax incompatible with project 3.9.6 | 99 | low |
| `security_report.json` | `_archive_candidates/20260218/security_report.json` | One-time scan referencing archived ChatICU/; gitignored | 98 | low |
| `chaticu-dev-skill/` | `_archive_candidates/20260218/chaticu-dev-skill/` | Skill templates; no runtime imports; gitignored | 98 | low |
| `.orchestrator/` | `_archive_candidates/20260218/.orchestrator/` | Old orchestrator state; no active references | 98 | low |
| `__pycache__/` | (DELETE) | Root-level cache from orphaned config.py; gitignored; auto-regenerated | 100 | none |

### Batch 2: Frontend orphans → archive (LOW RISK)

| old_path | new_path | reason | confidence | risk |
|----------|----------|--------|-----------|------|
| `src/lib/mock-data.ts` | `_archive_candidates/20260218/src-orphans/mock-data.ts` | 53KB; zero .ts/.tsx imports | 99 | low |
| `src/components/figma/ImageWithFallback.tsx` | `_archive_candidates/20260218/src-orphans/figma/ImageWithFallback.tsx` | Zero component imports | 98 | low |
| `src/imports/Frame.tsx` | `_archive_candidates/20260218/src-orphans/imports/Frame.tsx` | Orphaned Figma export | 98 | low |
| `src/imports/IcuAi1.tsx` | `_archive_candidates/20260218/src-orphans/imports/IcuAi1.tsx` | Orphaned Figma export | 98 | low |
| `src/imports/IcuLogin.tsx` | `_archive_candidates/20260218/src-orphans/imports/IcuLogin.tsx` | Orphaned Figma export | 98 | low |
| `src/imports/IcuPatientAi11.tsx` | `_archive_candidates/20260218/src-orphans/imports/IcuPatientAi11.tsx` | Orphaned + tsconfig excluded | 99 | low |
| `src/imports/svg-0tbt4.tsx` | `_archive_candidates/20260218/src-orphans/imports/svg-0tbt4.tsx` | Only used by orphaned IcuAi1 | 98 | low |
| `src/imports/svg-fx6y5.tsx` | `_archive_candidates/20260218/src-orphans/imports/svg-fx6y5.tsx` | Only used by orphaned IcuPatientAi11 | 98 | low |
| `src/imports/svg-hnm2h.tsx` | `_archive_candidates/20260218/src-orphans/imports/svg-hnm2h.tsx` | Only used by orphaned Frame | 98 | low |
| `src/imports/svg-ihon1.tsx` | `_archive_candidates/20260218/src-orphans/imports/svg-ihon1.tsx` | Only used by orphaned Frame | 98 | low |
| `src/imports/svg-ik76jdycii.ts` | `_archive_candidates/20260218/src-orphans/imports/svg-ik76jdycii.ts` | Only used by orphaned IcuAi1 | 98 | low |
| `src/imports/svg-n55v8t8hjk.ts` | `_archive_candidates/20260218/src-orphans/imports/svg-n55v8t8hjk.ts` | Zero references anywhere | 99 | low |
| `src/imports/svg-q8bgnvty5b.ts` | `_archive_candidates/20260218/src-orphans/imports/svg-q8bgnvty5b.ts` | Only used by orphaned IcuPatientAi11 | 98 | low |
| `src/imports/svg-v1yr43xgtu.ts` | `_archive_candidates/20260218/src-orphans/imports/svg-v1yr43xgtu.ts` | Only used by orphaned Frame | 98 | low |

**KEEP:** `src/imports/svg-n38m0xb9r6.ts` (imported by login.tsx:10)

### Batch 3: Misplaced docs → relocate to docs/frontend/ (LOW RISK)

| old_path | new_path | reason | confidence | risk |
|----------|----------|--------|-----------|------|
| `src/SYSTEM_ARCHITECTURE.md` | `docs/frontend/SYSTEM_ARCHITECTURE.md` | Design doc, not code | 95 | low |
| `src/BUTTON_INTERACTION_FLOW.md` | `docs/frontend/BUTTON_INTERACTION_FLOW.md` | Design doc, not code | 95 | low |
| `src/COMPLETE_UI_AUDIT.md` | `docs/frontend/COMPLETE_UI_AUDIT.md` | Design doc, not code | 95 | low |
| `src/FRONTEND_INTERACTION_MAP.md` | `docs/frontend/FRONTEND_INTERACTION_MAP.md` | Design doc, not code | 95 | low |
| `src/DATA_AUDIT.md` | `docs/frontend/DATA_AUDIT.md` | Design doc, not code | 95 | low |
| `src/API_SPECIFICATION.md` | `docs/frontend/API_SPECIFICATION.md` | Design doc, not code | 95 | low |
| `src/README.md` | `docs/frontend/README.md` | src-level readme | 90 | low |
| `src/Attributions.md` | `docs/frontend/Attributions.md` | Attribution doc | 90 | low |
| `src/guidelines/Guidelines.md` | `docs/frontend/Guidelines.md` | Guideline doc | 95 | low |

### Batch 4: Stale reports & patches → archive (LOW RISK)

| old_path | new_path | reason | confidence | risk |
|----------|----------|--------|-----------|------|
| `patches/` | `_archive_candidates/20260218/patches/` | 3 old orchestrator patches | 95 | low |
| `reports/prompt-P08-result.md` | `_archive_candidates/20260218/old-reports/prompt-P08-result.md` | Old orchestrator report | 95 | low |
| `reports/prompt-P09-result.md` | `_archive_candidates/20260218/old-reports/prompt-P09-result.md` | Old orchestrator report | 95 | low |
| `reports/prompt-P0P1-followup-result.md` | `_archive_candidates/20260218/old-reports/prompt-P0P1-followup-result.md` | Old orchestrator report | 95 | low |
| `reports/phase-0-project-map.md` | `_archive_candidates/20260218/old-reports/phase-0-project-map.md` | Old analysis report | 95 | low |
| `reports/phase-1-frontend-requirement-catalog.md` | `_archive_candidates/20260218/old-reports/phase-1-frontend-requirement-catalog.md` | Old analysis | 95 | low |
| `reports/phase-2-contract-matrix.md` | `_archive_candidates/20260218/old-reports/phase-2-contract-matrix.md` | Old analysis | 95 | low |
| `reports/phase-3-field-lineage-matrix.md` | `_archive_candidates/20260218/old-reports/phase-3-field-lineage-matrix.md` | Old analysis | 95 | low |
| `reports/phase-4-mock-fake-risk-register.md` | `_archive_candidates/20260218/old-reports/phase-4-mock-fake-risk-register.md` | Old analysis | 95 | low |
| `reports/phase-5-prioritized-fix-backlog.md` | `_archive_candidates/20260218/old-reports/phase-5-prioritized-fix-backlog.md` | Old analysis | 95 | low |
| `reports/final-integration-gate.md` | `_archive_candidates/20260218/old-reports/final-integration-gate.md` | Old gate report | 95 | low |
| `reports/frontend_api_contract_audit_tracker.md` | `_archive_candidates/20260218/old-reports/frontend_api_contract_audit_tracker.md` | Old tracker | 95 | low |
| `reports/t27-remediation-task-board.md` | `_archive_candidates/20260218/old-reports/t27-remediation-task-board.md` | Old remediation | 95 | low |
| `reports/t27-remediation-verification.md` | `_archive_candidates/20260218/old-reports/t27-remediation-verification.md` | Old verification | 95 | low |

### Batch 5: Code fixes (LOW RISK)

| file | action | reason |
|------|--------|--------|
| `src/lib/api/health.ts:69` | Fix stale comment referencing `dart_frog dev` | server/ being archived |
| `tsconfig.json:59` | Remove `src/imports/IcuPatientAi11.tsx` from exclude | File archived, exclude no longer needed |
| `src/guidelines/` | Remove empty directory after moving Guidelines.md | Clean up |
| `src/components/figma/` | Remove empty directory after moving ImageWithFallback.tsx | Clean up |

---

## HIGH RISK / HUMAN REVIEW REQUIRED

| Path | Score | Issue | Action Required |
|------|-------|-------|-----------------|
| `server/` | 35 | Dart Frog backend. DEV_START doc confirms unused. BUT `server/routes/dashboard/stats.dart` is modified in current branch working tree. May be active reference sync. | **ASK USER before archiving** |
| `src/hooks/use-api.ts` | 30 | Custom hook; import status unclear | **Verify manually** |
