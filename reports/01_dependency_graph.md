# Phase 1 — Dependency Graph & Usage Evidence

**Date:** 2026-02-18

---

## Frontend Dependency Graph

```
index.html
  └─ src/main.tsx
       ├─ src/index.css
       ├─ src/styles/globals.css
       └─ src/App.tsx
            ├─ react-router-dom (BrowserRouter, Routes, Route)
            ├─ src/lib/auth-context.tsx (AuthProvider, useAuth)
            │    └─ src/lib/api/auth.ts → src/lib/api-client.ts (axios)
            ├─ src/components/ui/sidebar (SidebarProvider)
            ├─ src/components/app-sidebar.tsx
            ├─ src/components/sidebar-toggle.tsx
            ├─ src/components/error-boundary.tsx
            ├─ src/components/ui/sonner (Toaster)
            └─ 15 Page Routes:
                 ├─ /login → src/pages/login.tsx
                 │    └─ src/imports/svg-n38m0xb9r6.ts ← ONLY used figma import
                 ├─ /dashboard → src/pages/dashboard.tsx
                 │    └─ src/lib/api/dashboard.ts
                 ├─ /patients → src/pages/patients.tsx
                 │    └─ src/lib/api/patients.ts
                 ├─ /patient/:id → src/pages/patient-detail.tsx
                 │    ├─ src/components/lab-data-display.tsx
                 │    │    └─ src/components/lab-trend-chart.tsx (recharts)
                 │    ├─ src/components/vital-signs-card.tsx
                 │    ├─ src/components/medical-records.tsx
                 │    ├─ src/components/patient/patient-summary-tab.tsx
                 │    ├─ src/components/pharmacist-advice-widget.tsx
                 │    └─ src/lib/api/{lab-data,vital-signs,ventilator,medications,messages,ai}.ts
                 ├─ /chat → src/pages/chat.tsx
                 │    └─ src/lib/api/team-chat.ts
                 ├─ /admin/* → src/pages/admin/{placeholder,vectors,users,statistics}.tsx
                 │    └─ src/lib/api/admin.ts
                 └─ /pharmacy/* → src/pages/pharmacy/{workstation,interactions,...}.tsx
                      └─ src/lib/api/pharmacy.ts
```

## Backend Dependency Graph

```
backend/app/main.py (entry)
  ├─ config.py (settings)
  ├─ database.py (get_db, engine, Base)
  ├─ middleware/auth.py (get_current_user, require_roles)
  ├─ middleware/audit.py (create_audit_log)
  ├─ middleware/rate_limit.py (limiter)
  └─ 16 Routers:
       ├─ health.py        → /health, /
       ├─ auth.py           → /auth/* (8 endpoints)
       ├─ patients.py       → /patients/* (5 endpoints)
       ├─ lab_data.py       → /lab_data/* (4 endpoints)
       ├─ vital_signs.py    → /vital_signs/* (3 endpoints)
       ├─ ventilator.py     → /ventilator/* (5 endpoints)
       ├─ medications.py    → /medications/* (3 endpoints)
       ├─ messages.py       → /messages/* (5 endpoints)
       ├─ team_chat.py      → /team_chat/* (3 endpoints)
       ├─ dashboard.py      → /dashboard (1 endpoint)
       ├─ admin.py          → /admin/* (8 endpoints)
       ├─ pharmacy.py       → /pharmacy/* (10+ endpoints, 4 sub-routers)
       ├─ clinical.py       → /api/v1/clinical/* (9 endpoints)
       │    ├─ llm.py (call_llm, call_llm_multi_turn)
       │    ├─ services/evidence_client.py → HTTP → func/ microservice
       │    ├─ services/safety_guardrail.py
       │    └─ services/llm_services/rag_service.py
       ├─ ai_chat.py        → /api/v1/chat/* (2 endpoints)
       │    └─ routers/clinical.py (_get_patient_dict)
       ├─ ai_readiness.py   → /readiness
       ├─ rag.py             → /api/v1/rag/* (3 endpoints)
       └─ rules.py           → /rules/* (1 endpoint)
```

## Cross-System Data Flow

```
Frontend (src/) ──HTTP──→ Backend (backend/app/) ──HTTP──→ func/ (Evidence RAG)
                                    │                            │
                                    ├──SQL──→ PostgreSQL          ├──→ rag 文本/ (PDFs)
                                    ├──Redis──→ Session/Cache     └──→ evidence_rag_data/ (indices)
                                    └──API──→ OpenAI/Anthropic

datamock/ ──JSON──→ backend/seeds/ ──→ PostgreSQL (on startup if empty)
```

## Orphaned Import Chains (No Active Consumer)

```
src/imports/Frame.tsx ← svg-hnm2h.tsx, svg-ihon1.tsx, svg-v1yr43xgtu.ts
src/imports/IcuAi1.tsx ← svg-0tbt4.tsx, svg-ik76jdycii.ts
src/imports/IcuLogin.tsx ← svg-n38m0xb9r6.ts (but login.tsx also imports svg directly)
src/imports/IcuPatientAi11.tsx ← svg-fx6y5.tsx, svg-q8bgnvty5b.ts (EXCLUDED in tsconfig)

src/lib/mock-data.ts → (53KB, ZERO consumers)
src/components/figma/ImageWithFallback.tsx → (ZERO consumers)
config.py (root) → (ZERO consumers, uses Python 3.10+ syntax)
```
