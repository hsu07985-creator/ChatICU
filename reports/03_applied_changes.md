# Phase 3 — Applied Changes

**Date:** 2026-02-18

---

## Batch 1: Root-Level Orphans → Archive

| Action | Path | Destination |
|--------|------|-------------|
| MOVE | `config.py` | `_archive_candidates/20260218/config.py` |
| MOVE | `security_report.json` | `_archive_candidates/20260218/security_report.json` |
| MOVE | `chaticu-dev-skill/` | `_archive_candidates/20260218/chaticu-dev-skill/` |
| MOVE | `.orchestrator/` | `_archive_candidates/20260218/.orchestrator/` |
| DELETE | `__pycache__/` | (auto-regenerated; gitignored) |

## Batch 2: Frontend Orphans → Archive

| Action | Path | Destination |
|--------|------|-------------|
| MOVE | `src/lib/mock-data.ts` (53KB) | `_archive_candidates/20260218/src-orphans/mock-data.ts` |
| MOVE | `src/components/figma/ImageWithFallback.tsx` | `_archive_candidates/20260218/src-orphans/figma/` |
| MOVE | `src/hooks/use-api.ts` | `_archive_candidates/20260218/src-orphans/hooks/` |
| MOVE | 12 Figma exports from `src/imports/` | `_archive_candidates/20260218/src-orphans/imports/` |
| KEEP | `src/imports/svg-n38m0xb9r6.ts` | (used by login.tsx:10) |
| RMDIR | `src/components/figma/`, `src/hooks/`, `src/guidelines/` | (empty after moves) |

## Batch 3: Misplaced Docs → docs/frontend/

| Old Path | New Path |
|----------|----------|
| `src/SYSTEM_ARCHITECTURE.md` | `docs/frontend/SYSTEM_ARCHITECTURE.md` |
| `src/BUTTON_INTERACTION_FLOW.md` | `docs/frontend/BUTTON_INTERACTION_FLOW.md` |
| `src/COMPLETE_UI_AUDIT.md` | `docs/frontend/COMPLETE_UI_AUDIT.md` |
| `src/FRONTEND_INTERACTION_MAP.md` | `docs/frontend/FRONTEND_INTERACTION_MAP.md` |
| `src/DATA_AUDIT.md` | `docs/frontend/DATA_AUDIT.md` |
| `src/API_SPECIFICATION.md` | `docs/frontend/API_SPECIFICATION.md` |
| `src/README.md` | `docs/frontend/README.md` |
| `src/Attributions.md` | `docs/frontend/Attributions.md` |
| `src/guidelines/Guidelines.md` | `docs/frontend/Guidelines.md` |

## Batch 4: Stale Reports & Patches → Archive

- `patches/` (3 files) → `_archive_candidates/20260218/patches/`
- 12 old orchestrator reports → `_archive_candidates/20260218/old-reports/`

## Batch 5: Code Fixes

| File | Change |
|------|--------|
| `src/lib/api/health.ts:69` | `dart_frog dev` → actual FastAPI uvicorn command |
| `tsconfig.json:59` | Removed `exclude: ["src/imports/IcuPatientAi11.tsx"]` (file archived) |

## Statistics

- Files moved to archive: 30
- Files relocated (src/ → docs/): 9
- Empty directories removed: 3
- Code fixes: 2
- Net src/ reduction: ~17,000 lines

## Rollback

All files preserved in `_archive_candidates/20260218/`. Full diff: `reports/03_unified_diff.patch` (18,290 lines).
