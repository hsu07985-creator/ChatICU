# Backend Session — Scope & Coordination Rules

## Scope Restriction (MANDATORY)
- You are the **BACKEND session**. You may ONLY modify files under `backend/`.
- **NEVER** touch files in `src/`, `public/`, `e2e/`, `package.json`, `vite.config.ts`, `tsconfig.json`, or any other frontend file.
- If you need a frontend change, add a task to `docs/coordination/frontend-tasks.md`.

## Coordination Protocol

### When you COMPLETE an endpoint or API change:
1. Update `docs/coordination/api-contracts.md` with the request/response schema
2. Add a task to `docs/coordination/frontend-tasks.md` using this format:
```
### [READY] <endpoint description>
- **Endpoint:** `METHOD /path`
- **Added by:** backend session
- **Date:** YYYY-MM-DD
- **Schema:** (see api-contracts.md#section)
- **Notes:** <any integration notes>
```
3. Mark your corresponding task in `docs/coordination/backend-tasks.md` as `[DONE]`

### When you PICK UP a task from `docs/coordination/backend-tasks.md`:
1. Change its status from `[TODO]` to `[IN-PROGRESS]`
2. Read the full task description and any linked api-contracts section
3. When finished, change to `[DONE]` and notify frontend via `frontend-tasks.md`

### Checking for new tasks:
- **Before starting work**, always read `docs/coordination/backend-tasks.md` for new `[TODO]` items
- Process tasks in order (oldest first)

## Tech Stack Reminders
- Python 3.9.6: use `Optional[X]` not `X | None`, `List[X]` not `list[X]`
- Use `python3` not `python`
- Pydantic v2: `pattern=` not `regex=`
- Tests: `cd backend && python3 -m pytest tests/ -v --tb=short`
- Response envelope: `{success: true/false, data/error, message}`
- All LLM calls through `backend/app/llm.py`

## HIS → ChatICU Import Pipeline (2026-04-09)

### Architecture
```
patient/*/  →  HISConverter  →  scripts/import_his_patients.py  →  Supabase DB
```

### Key Files
- `app/fhir/his_converter.py` — HIS JSON → ChatICU dict converter (HISConverter class)
- `app/fhir/his_lab_mapping.py` — 372 LAB_CODE → (category, key, name) mappings
- `scripts/import_his_patients.py` — DB import script (upsert, idempotent)

### Completed Steps (verified on 13 patients, 2026-04-09)

| Step | Feature | Result |
|------|---------|--------|
| 1 | Import pipeline (`--dry-run` / DB upsert) | 13/13 patients, idempotent |
| 2 | SAN auto-derive (sedation/analgesia/nmb) | S=5, A=10, N=0 drugs extracted |
| 3 | ECG AI → diagnostic_reports | 35 records, 11/13 patients |
| 4 | DNR_CONSENT bitmask → consent_status + alerts | 8/13 patients with DNR detail |
| 5 | getSurgery → diagnostic_reports | 4 records, 3/13 patients |
| 6 | ventilator_days from D3 orders | 1 patient (50911741), TOTAL_QTY=1 |

### Data Coverage Summary
- **Patients**: 13 mapped (height/weight/allergies/campus unavailable from HIS)
- **Medications**: 1,791 total (20/29 fields filled; indication/warnings/concentration unavailable)
- **Lab Data**: 954 records (372 LAB_CODEs, 100% coverage, 0 unmapped)
- **Culture Results**: 174 records (83 isolates, 100% mapped)
- **Diagnostic Reports**: 266 total (227 imaging + 4 surgery + 35 ECG AI)
- **Vital Signs**: 0 — HIS has no bedside monitor data
- **Ventilator Settings**: 0 — HIS has no ventilator parameter data
- **Clinical Scores**: 0 — requires clinical assessment, not in HIS

### Remaining Gaps (need HIS team or other source)
- **bed_number / unit**: Need GetIpd API (急住診, p.21) — not yet called
- **height / weight / BMI**: Not in HIS API — need nursing system or manual entry
- **allergies**: Not in HIS API
- **is_isolated / campus**: Not in HIS API

### Usage
```bash
cd backend
python3 scripts/import_his_patients.py --dry-run         # preview
python3 scripts/import_his_patients.py                    # import all to DB
python3 scripts/import_his_patients.py -p 50045203        # single patient
```

### Import Results (local DB, 2026-04-09)
- 13 HIS patients imported successfully (+ 5 existing seed = 18 total)
- 1,808 medications, 958 lab records, 186 cultures, 266 diagnostic reports
- Idempotent: re-run verified, no duplicates
- Migration 055: adds patients.campus, 8 medication cols, 6 lab_data JSONB cols, diagnostic_reports table
- Note: migrations 049/050 had asyncpg date serialization bugs — fixed (str→native date/datetime)
