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

## Architecture Conventions(2026-07-19 稽核後確立)

- **DB engine**:任何 `create_async_engine` 一律改用 `app/db_engine.py` 的
  `create_pooled_engine()`(scripts/seeds 也是)。pooler connect_args 只准
  活在那一個檔案。
- **Transaction 邊界(C6)**:`get_db()` 在 handler 成功結束時 auto-commit,
  這就是預設的 transaction 邊界。**只有**「mid-request 就要持久化」的場景
  (例:SSE 開始 streaming 前先落 session row)才准手動 `await db.commit()`,
  並加註解說明為什麼。不要為了「保險」多 commit。
- **Response 序列化(B2)**:新 endpoint 的 payload 宣告 `CamelModel` 子類
  (`app/schemas/base.py`),不要再手刻 camelCase dict。既有 `*_to_dict`
  依「改到哪遷到哪」換掉;示範:`schemas/vital_sign.py`。
- **資料修補(C3)**:**不要再寫 data-seed / backfill migration**。資料修補
  走 `backend/scripts/run_seed_repair.py` 或獨立腳本;alembic 只放 schema
  變更。(歷史教訓:035→038 同一份資料連 seed 四次。)
- **Patient authz**:`verify_patient_access` / `normalize_patient_id` 從
  `app/utils/patient_access.py` import,不要從 routers.patients。

## HIS → ChatICU Import Pipeline (2026-04-09)

### Architecture
```
patient/*/  →  HISConverter  →  scripts/import_his_patients.py  →  Supabase DB
```

### Key Files
- `app/fhir/his_converter.py` — HIS JSON → ChatICU dict converter (HISConverter class)
- `app/fhir/his_lab_mapping.py` — 372 LAB_CODE → (category, key, name) mappings
- `scripts/import_his_patients.py` — DB import script (upsert, idempotent)

### Current Production Baseline (verified on 10 patients, 2026-07-22)

| Step | Feature | Result |
|------|---------|--------|
| 1 | Serial snapshot sync + ownership | 10/10 patients, schema `2026-07-22.8`, idempotent |
| 2 | Medication raw mapping | 2,120 rows, source/API/DB mismatch=0 |
| 3 | Lab / culture raw mapping | 6,224 / 1,812 items, mismatch=0 |
| 4 | Structured allergy | `sbDisease.FOOD_ALLERGY`; source present → locked automatic |
| 5 | HIS Pain | 4 deterministic rows; source present → immutable from UI/API |
| 6 | Reports / vitals | 43 reports / 4,484 vital rows |

### Data Coverage Summary
- **Patients**: 10 active; current admission comes from `getIpd`, not historical `getIPD`
- **Medications**: 2,120 total; PRN/STAT from `FREQ_CODE`, category/S/A/N from `ATC_CODE` or exact formulary fallback
- **Lab Data**: 829 groups / 6,224 items
- **Culture Results**: 204 groups / 1,812 source items
- **Diagnostic Reports**: 43 total (40 ECG AI + 3 surgery)
- **Vital Signs**: 4,484 HIS TPR rows; SpO2/EtCO2/CVP/ICP/CPP remain manual
- **Ventilator Settings**: 0 — HIS has no ventilator parameter data
- **Clinical Scores**: 4 HIS Pain rows; RASS remains manual

### Remaining Gaps (need HIS team or other source)
- **unit**: Still fixed to `ICU`; changing it affects access control and requires separate review
- **height / weight / BMI**: Use `Smartbed.sbNutrition` when present; otherwise preserve manual values
- **allergies**: Only structured food allergy exists; drug allergy remains unavailable
- **is_isolated / campus**: Not in HIS API

### Usage
```bash
cd backend
python3 scripts/import_his_patients.py                    # 預設 dry-run(2026-07-19 起)
python3 scripts/import_his_patients.py --execute          # 真的寫 DB(慎用:upsert 不刪舊列)
python3 scripts/import_his_patients.py --execute -p 50045203  # single patient
# production sync 一律用 sync_his_snapshots_serial.py,此腳本僅限一次性匯入
```

### Import Results (local DB, 2026-04-09)
- 13 HIS patients imported successfully (+ 5 existing seed = 18 total)
- 1,808 medications, 958 lab records, 186 cultures, 266 diagnostic reports
- Idempotent: re-run verified, no duplicates
- Migration 055: adds patients.campus, 8 medication cols, 6 lab_data JSONB cols, diagnostic_reports table
- Note: migrations 049/050 had asyncpg date serialization bugs — fixed (str→native date/datetime)
