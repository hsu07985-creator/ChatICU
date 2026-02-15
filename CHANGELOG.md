# Changelog

All notable changes to ChatICU are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-02-15

### Added
- FastAPI backend with PostgreSQL 16 + Redis 7
- JWT authentication with refresh token rotation (T05)
- Password policy: 12 chars, complexity, 90-day expiry, 5-cycle history (T07)
- Account lockout: 5 failures → 15min Redis lockout (T08)
- RBAC: 4 roles (admin, doctor, nurse, pharmacist) across 16 routers (T09)
- Session idle timeout: 30min via Redis (T10)
- Audit logging: 12 categories, structured JSON, sensitive field masking (T11)
- Medical safety guardrail: 15 high-alert medications, diagnostic claim detection (T30)
- Expert review endpoint for AI outputs (T30)
- RAG pipeline: 44 PDFs, 2150 chunks, TF-IDF embedding (Phase 4)
- 4 clinical AI endpoints: summary, explanation, guideline, decision
- AI chat with DB-persisted sessions
- Drug interaction + IV compatibility search endpoints
- Error reporting with severity tracking
- Team chat with pinning
- Alembic migrations: 15 tables + password_history (T17)

### Security
- HSTS middleware in production mode (T15)
- CORS configurable via environment variable (T15)
- No plaintext passwords in codebase (T06)
- Seed password requires environment variable — no fallback (T06)
- Error responses hide stack traces, return errorId only (T28)
- Severe error webhook alerting (T28)
- Input validation: email format, username pattern, field length limits (T26)
- Dockerfile: no --reload in production (T20)
- Docker Compose: no source code bind mounts (T20)

### Infrastructure
- Docker Compose: api + postgres + redis with health checks
- GitHub Actions CI: test + lint + security scan + Docker build (T22)
- Bandit SAST configuration (T23)
- OpenAPI 3.1.0 spec: 50 paths, 61 methods (T02)
- API contract documentation (T02)

### Frontend
- 13 pages cleaned of mock data fallbacks (T03)
- Frontend-backend contract alignment: 6 field mappings fixed (T04)
- Lab trend chart wired to backend API (T04)
- Real API calls for all core flows: auth, patients, AI chat, pharmacy (T04)
