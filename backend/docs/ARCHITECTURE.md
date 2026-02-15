# ChatICU Backend — Architecture & Route Map

**Version:** 1.0
**Date:** 2026-02-15
**Status:** Production backend (single source of truth)

---

## System Architecture

```
                          ┌─────────────────────────────────────┐
                          │          Frontend (Vite+React)       │
                          │          http://localhost:3000       │
                          └──────────────┬──────────────────────┘
                                         │ HTTPS / REST
                                         ▼
                          ┌─────────────────────────────────────┐
                          │       Reverse Proxy (Nginx/Caddy)   │
                          │       TLS termination + CORS        │
                          └──────────────┬──────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        FastAPI Application (:8000)                         │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Middleware   │  │  Middleware   │  │  Middleware   │  │  Middleware   │  │
│  │  CORS        │  │  Rate Limit  │  │  JWT Auth    │  │  Audit Log   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         └──────────────────┴──────────────────┴──────────────────┘         │
│                                    │                                       │
│  ┌─────────────────────────────────┼──────────────────────────────────┐   │
│  │                          Router Layer                              │   │
│  │                                                                    │   │
│  │  /auth/*          /patients/*       /team/chat/*     /dashboard/*  │   │
│  │  /admin/*         /pharmacy/*       /ai/*            /health       │   │
│  │  /api/v1/clinical/*   /api/v1/rag/*   /api/v1/rules/*             │   │
│  └─────────────────────────────────┼──────────────────────────────────┘   │
│                                    │                                       │
│  ┌─────────────────────────────────┼──────────────────────────────────┐   │
│  │                        Service Layer                               │   │
│  │                                                                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │   │
│  │  │  LLM Gateway │  │  RAG Service │  │  Rule Engine (CKD etc.) │ │   │
│  │  │  (app/llm.py)│  │  (embed+cos) │  │                          │ │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘ │   │
│  │         │                 │                                        │   │
│  │         ▼                 ▼                                        │   │
│  │  ┌──────────────┐  ┌──────────────┐                               │   │
│  │  │ OpenAI API   │  │ Document     │                               │   │
│  │  │ Anthropic API│  │ Loader+      │                               │   │
│  │  └──────────────┘  │ Chunker      │                               │   │
│  │                     └──────────────┘                               │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│  ┌─────────────────────────────────┼──────────────────────────────────┐   │
│  │                    Data Access Layer (SQLAlchemy 2.0 async)        │   │
│  │  13 Models: User, Patient, LabData, VitalSign, Medication,        │   │
│  │  Message, ChatMessage, Ventilator*, DrugInteraction*, ErrorReport, │   │
│  │  AuditLog, AISession, AIMessage                                   │   │
│  └──────────────────────────┬──────────────────────┬─────────────────┘   │
│                              │                      │                     │
└──────────────────────────────┼──────────────────────┼─────────────────────┘
                               │                      │
                    ┌──────────▼──────────┐  ┌────────▼────────┐
                    │   PostgreSQL 16     │  │    Redis 7      │
                    │   (asyncpg)         │  │  (token blacklist│
                    │   Port: 5432        │  │   + rate limit) │
                    │                     │  │  Port: 6379     │
                    └─────────────────────┘  └─────────────────┘

                    ┌─────────────────────────────────────────┐
                    │           RAG Document Store             │
                    │    /data/rag_docs (44 medical PDFs)     │
                    │    2150 chunks, numpy cosine search     │
                    └─────────────────────────────────────────┘
```

---

## Complete Route Map (59 endpoints)

### Public (No Auth) — 2 routes

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/` | App info, version, docs URL |
| 2 | GET | `/health` | Health check (service status) |

### Auth (`/auth`) — 4 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 3 | POST | `/auth/login` | No (rate limited) | Login → JWT access + refresh tokens |
| 4 | POST | `/auth/logout` | JWT | Logout → Redis blacklist |
| 5 | POST | `/auth/refresh` | No | Refresh access token |
| 6 | GET | `/auth/me` | JWT | Current user profile + permissions |

### Patients (`/patients`) — 5 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 7 | GET | `/patients` | JWT | List patients (pagination, search, filter) |
| 8 | POST | `/patients` | JWT | Create patient |
| 9 | GET | `/patients/{id}` | JWT | Patient detail |
| 10 | PATCH | `/patients/{id}` | admin/doctor/nurse | Update patient |
| 11 | PATCH | `/patients/{id}/archive` | JWT | Archive/unarchive |

### Lab Data (`/patients/{id}/lab-data`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 12 | GET | `…/lab-data/latest` | JWT | Latest lab results |
| 13 | GET | `…/lab-data/trends` | JWT | Lab trends (N days) |
| 14 | PATCH | `…/lab-data/{lab_id}/correct` | admin/doctor | Correct lab value |

### Vital Signs (`/patients/{id}/vital-signs`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 15 | GET | `…/vital-signs/latest` | JWT | Latest vitals |
| 16 | GET | `…/vital-signs/trends` | JWT | Vital trends (N hours) |
| 17 | GET | `…/vital-signs/history` | JWT | Paginated history |

### Ventilator (`/patients/{id}/ventilator`) — 4 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 18 | GET | `…/ventilator/latest` | JWT | Latest ventilator settings |
| 19 | GET | `…/ventilator/trends` | JWT | Setting trends |
| 20 | GET | `…/ventilator/weaning-assessment` | JWT | Latest weaning assessment |
| 21 | POST | `…/ventilator/weaning-assessment` | JWT | Create weaning assessment |

### Medications (`/patients/{id}/medications`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 22 | GET | `…/medications` | JWT | List medications (status filter, SAN) |
| 23 | POST | `…/medications` | doctor | Prescribe medication |
| 24 | PATCH | `…/medications/{med_id}` | doctor/pharmacist | Update medication |

### Patient Messages (`/patients/{id}/messages`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 25 | GET | `…/messages` | JWT | List messages (unread, type filter) |
| 26 | POST | `…/messages` | JWT | Create message |
| 27 | PATCH | `…/messages/{msg_id}/read` | JWT | Mark as read |

### Team Chat (`/team/chat`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 28 | GET | `/team/chat` | JWT | List team messages |
| 29 | POST | `/team/chat` | JWT | Send team message |
| 30 | PATCH | `/team/chat/{msg_id}/pin` | JWT | Toggle pin |

### Dashboard (`/dashboard`) — 1 route

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 31 | GET | `/dashboard/stats` | JWT | Dashboard statistics |

### Admin (`/admin`) — 8 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 32 | GET | `/admin/audit-logs` | admin | List audit logs |
| 33 | GET | `/admin/users` | admin | List users |
| 34 | POST | `/admin/users` | admin | Create user |
| 35 | GET | `/admin/users/{id}` | admin | User detail |
| 36 | PATCH | `/admin/users/{id}` | admin | Update user |
| 37 | GET | `/admin/vectors` | admin | List vector DBs |
| 38 | POST | `/admin/vectors/upload` | admin | Upload documents |
| 39 | POST | `/admin/vectors/{db_id}/rebuild` | admin | Rebuild vector index |

### Pharmacy (`/pharmacy`) — 5 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 40 | GET | `/pharmacy/error-reports` | JWT | List error reports |
| 41 | POST | `/pharmacy/error-reports` | JWT | Report medication error |
| 42 | GET | `/pharmacy/error-reports/{id}` | JWT | Error report detail |
| 43 | PATCH | `/pharmacy/error-reports/{id}` | JWT | Update error report |
| 44 | GET | `/pharmacy/advice-statistics` | JWT | Pharmacy advice stats |

### Clinical AI (`/api/v1/clinical`) — 4 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 45 | POST | `/api/v1/clinical/summary` | JWT | Generate clinical summary (LLM) |
| 46 | POST | `/api/v1/clinical/explanation` | JWT | Patient-friendly explanation (LLM) |
| 47 | POST | `/api/v1/clinical/guideline` | JWT | Guideline interpretation (LLM+RAG) |
| 48 | POST | `/api/v1/clinical/decision` | JWT | Multi-agent decision (LLM) |

### RAG (`/api/v1/rag`) — 3 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 49 | POST | `/api/v1/rag/query` | JWT | Query RAG index |
| 50 | POST | `/api/v1/rag/index` | admin | Index documents |
| 51 | GET | `/api/v1/rag/status` | JWT | RAG index status |

### Rules Engine (`/api/v1/rules`) — 1 route

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 52 | POST | `/api/v1/rules/ckd-stage` | JWT | CKD staging (eGFR) |

### AI Chat (`/ai`) — 4 routes

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 53 | POST | `/ai/chat` | JWT | Send AI message (LLM+RAG+DB) |
| 54 | GET | `/ai/sessions` | JWT | List AI sessions |
| 55 | GET | `/ai/sessions/{id}` | JWT | Session with messages |
| 56 | DELETE | `/ai/sessions/{id}` | JWT | Delete session |

---

## Auth Summary

| Access Level | Count | Routes |
|-------------|-------|--------|
| Public | 2 | `/`, `/health` |
| Rate Limited (no auth) | 2 | `/auth/login`, `/auth/refresh` |
| JWT (any role) | 41 | Most endpoints |
| Admin only | 10 | `/admin/*`, `/api/v1/rag/index` |
| Doctor only | 1 | Prescribe medication |
| Doctor + Pharmacist | 1 | Update medication |
| Admin + Doctor + Nurse | 1 | Update patient |

## RBAC Role Matrix

| Permission | nurse | doctor | pharmacist | admin |
|-----------|-------|--------|------------|-------|
| View patients | Y | Y | Y | Y |
| Update patients | Y | Y | N | Y |
| Prescribe medications | N | Y | N | N |
| Update medications | N | Y | Y | N |
| View lab data | Y | Y | Y | Y |
| Correct lab data | N | Y | N | Y |
| Clinical AI endpoints | Y | Y | Y | Y |
| RAG index (rebuild) | N | N | N | Y |
| Admin panel | N | N | N | Y |
| Audit logs | N | N | N | Y |
| User management | N | N | N | Y |

---

## Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `api` | Custom (Dockerfile) | 8000 | FastAPI application |
| `db` | postgres:16-alpine | 5432 | Primary database |
| `redis` | redis:7-alpine | 6379 | Token blacklist + rate limiting |

### Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `postgres_data` | `/var/lib/postgresql/data` | DB persistence |
| `redis_data` | `/data` | Redis persistence |
| `../rag 文本` | `/data/rag_docs:ro` | Medical PDFs (read-only) |

---

## File Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app + lifespan + routers
│   ├── config.py             # Pydantic Settings (DB, Redis, JWT, LLM)
│   ├── database.py           # SQLAlchemy async engine + get_db()
│   ├── llm.py                # Unified LLM gateway (OpenAI/Anthropic)
│   ├── middleware/
│   │   ├── auth.py           # JWT auth + RBAC + Redis blacklist
│   │   ├── rate_limit.py     # Rate limiting middleware
│   │   └── audit.py          # Audit logging helper
│   ├── models/               # 13 SQLAlchemy ORM models
│   ├── schemas/              # Pydantic request/response schemas
│   ├── routers/              # 16 route modules (59 endpoints)
│   ├── services/
│   │   ├── data_services/    # document_loader, text_chunker
│   │   ├── llm_services/     # clinical_summary, patient_explanation, rag_service
│   │   └── rule_engine/      # ckd_rules
│   └── utils/                # security (bcrypt), response helpers
├── alembic/                  # Database migrations
├── seeds/                    # seed_data.py (from datamock/)
├── tests/                    # 39 tests (pytest-asyncio + SQLite)
├── docker-compose.yml        # PostgreSQL 16 + Redis 7 + API
├── Dockerfile
├── requirements.txt
└── .env
```
