# Phase 0 — Project Inventory

**Date:** 2026-02-18  |  **Branch:** ai/meds-layout-api-sync

---

## 1. Top-Level Structure

| Path | Type | Size | Description |
|------|------|------|-------------|
| `backend/` | Dir | 391 MB | Production FastAPI backend (incl. .venv312) |
| `src/` | Dir | 5.5 MB | Frontend (Vite + React + TypeScript) |
| `func/` | Dir | 24 MB | Evidence RAG microservice |
| `rag 文本/` | Dir | 35 MB | Medical PDFs (44 files, 5 categories) |
| `server/` | Dir | 528 KB | Dart Frog backend (legacy reference) |
| `datamock/` | Dir | 56 KB | JSON seed data (8 files) |
| `docs/` | Dir | 196 KB | Operations/QA/release/security docs |
| `e2e/` | Dir | 40 KB | Playwright E2E tests |
| `scripts/` | Dir | 20 KB | Ops & golden-test scripts |
| `build/` | Dir | 1.6 MB | Frontend dist output |
| `output/` | Dir | 516 KB | Playwright test output |
| `_archive_candidates/` | Dir | 632 KB | Previously archived items |
| `chaticu-dev-skill/` | Dir | 92 KB | Claude Code skill templates |
| `.orchestrator/` | Dir | 12 KB | Old orchestrator state |
| `.pre-commit-cache/` | Dir | 22 MB | Pre-commit hook cache |
| `.github/` | Dir | 52 KB | CI workflows |
| `patches/` | Dir | 68 KB | Old orchestrator patches |
| `reports/` | Dir | 1.2 MB | Phase/audit reports |

## 2. Tech Stack

- **Frontend:** React 18.3.1 + TypeScript 5.9.3 + Vite 6.3.5 + Radix UI/shadcn + Recharts
- **Backend:** FastAPI + SQLAlchemy (async) + PostgreSQL + Redis + JWT + RBAC
- **LLM:** OpenAI/Anthropic via `backend/app/llm.py` (7 task prompts)
- **RAG:** `func/` microservice (Evidence RAG) + `rag 文本/` (44 medical PDFs)
- **E2E:** Playwright 1.52.0
- **CI:** GitHub Actions | Docker multi-stage | pre-commit

## 3. Entry Points

| Entry | Path | Evidence |
|-------|------|----------|
| Frontend HTML | `index.html` | Vite entry |
| Frontend JS | `src/main.tsx` → `src/App.tsx` | 15 routes defined |
| Backend API | `backend/app/main.py` | 16 routers, 50+ endpoints |
| Alembic | `backend/alembic/` | 7 migration versions |
| LLM | `backend/app/llm.py` | Single entry for all AI calls |
| Evidence RAG | `func/evidence_rag/api.py` | Separate FastAPI service |
| Seeds | `backend/seeds/seed_if_empty.py` | Startup conditional seeding |
| E2E | `e2e/*.spec.js` | 3 Playwright specs |
| CI | `.github/workflows/ci.yml` | Pipeline definition |

## 4. File Counts

| Category | Count |
|----------|-------|
| Frontend .ts/.tsx | 114 |
| Backend .py (app/) | 78 |
| Backend tests | 28 |
| func/ Python | ~40 |
| Alembic migrations | 7 |
| E2E specs | 3 |
| Shell scripts | 4 |
