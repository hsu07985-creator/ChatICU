1) Summary
- 已完成關鍵 API 的 DB lineage 追蹤，涵蓋 Auth、Dashboard、Team Chat、Admin、AI Chat、Clinical、Pharmacy。
- 關鍵流程已可定位到具體讀寫表與 migration 來源，無 Unknown linkage。
- 識別 4 個一致性風險，其中 1 個 High（跨表參照缺少 FK 約束）。

2) Findings
DB Lineage Table
| Endpoint | Write Tables/Columns | Read Tables/Columns | Migration Matched(Y/N) | Integrity Risk |
|---|---|---|---|---|
| `POST /auth/login` | `users.last_login`, `audit_logs.*` | `users.username/password_hash/active` | Y (`users` in `001_initial_schema.py:24-39`, `audit_logs` in `001_initial_schema.py:273-288`) | Low |
| `GET /dashboard/stats` | None | `patients.archived/intubated/alerts`, `medications.status/san_category`, `patient_messages.is_read/timestamp` | Y (`patients/medications/patient_messages` in `001_initial_schema.py:41-212`) | Low |
| `POST /team/chat` | `team_chat_messages.*`, `audit_logs.*` | `users` (auth) | Y (`team_chat_messages` in `001_initial_schema.py:258-272`) | Low |
| `POST/PATCH /admin/users` | `users.*`, `password_history.*`, `audit_logs.*` | `users.*` | Y (`password_history` in `002_password_history.py:27-35`) | Medium |
| `POST /ai/chat` | `ai_sessions.*`, `ai_messages.*`, `audit_logs.*` | `ai_sessions.*`, `ai_messages.*`, `patients.*` | Y (`ai_sessions/ai_messages` in `001_initial_schema.py:126-137,289-300`; summary cols in `004_ai_session_summary.py:16-19`) | High (FK missing) |
| `POST /api/v1/clinical/summary` | `audit_logs.*` | `patients`, `lab_data`, `vital_signs`, `medications`, `ventilator_settings` | Y (`lab_data/vital_signs/medications/ventilator_settings` in `001_initial_schema.py:140-234`) | Medium |
| `POST /pharmacy/advice-records` | `pharmacy_advices.*`, `patient_messages.*`, `audit_logs.*` | `patients.id/name/bed_number` | Y (`pharmacy_advices` in `003_pharmacy_advices.py:18-35`) | High (FK missing) |
| `POST/PATCH /pharmacy/error-reports` | `error_reports.*`, `audit_logs.*` | `error_reports.*` | Y (`error_reports` in `001_initial_schema.py:105-125`) | Medium (FK missing) |
| `POST/DELETE /pharmacy/compatibility-favorites` | `pharmacy_compatibility_favorites.*`, `audit_logs.*` | `pharmacy_compatibility_favorites.*` | Y (`006_pharm_compat_favs`: `006_pharmacy_compatibility_favorites.py:17-36`) | Medium (FK missing) |
| `GET /pharmacy/drug-interactions` / `GET /pharmacy/iv-compatibility` | None | `drug_interactions.*` / `iv_compatibilities.*` | Y (`001_initial_schema.py:77-104`) | Low |

DB Findings（含證據）
- DB-001 (High): 多個跨表識別欄位未設 FK，存在孤兒資料風險。
  - Evidence:
    - `ai_sessions.user_id/patient_id` 無 FK（`backend/alembic/versions/001_initial_schema.py:126-137`）。
    - `error_reports.reporter_id/patient_id` 無 FK（`backend/alembic/versions/001_initial_schema.py:105-125`）。
    - `pharmacy_advices.patient_id/pharmacist_id` 無 FK（`backend/alembic/versions/003_pharmacy_advices.py:18-35`）。
    - `pharmacy_compatibility_favorites.user_id` 無 FK（`backend/alembic/versions/006_pharmacy_compatibility_favorites.py:18-31`）。
  - Impact: 使用者/病患資料刪除或資料修復後，關聯表可能殘留不可追溯資料。
- DB-002 (Medium): `GET /pharmacy/error-reports` 無分頁，資料量放大時可能造成 query 壓力。
  - Evidence: 直接 `select(ErrorReport).order_by(...)` 並回傳全量（`backend/app/routers/pharmacy.py:51-64`）。
  - Impact: 管理頁載入延遲、記憶體峰值增高。
- DB-003 (Medium): `GET /admin/users` 每次另做全表掃描計算 stats。
  - Evidence: `all_result = await db.execute(select(User))`（`backend/app/routers/admin.py:110-119`）。
  - Impact: 使用者數量放大後，管理頁延遲與 DB 負擔上升。
- DB-004 (Medium): `patient_messages` 已讀邏輯為 append JSON list，無去重。
  - Evidence: `read_by.append({...})`（`backend/app/routers/messages.py:118-124`）。
  - Impact: 同一用戶重複標記造成 `read_by` 冗餘。

必補 DB 測試清單（create/update/read-back）
- `T-DB-01` Patient create/read-back: `POST /patients` -> `GET /patients/{id}` 驗證欄位映射與 `lastUpdate`。
- `T-DB-02` Team chat write/read-back: `POST /team/chat` -> `GET /team/chat` 驗證 `pinned/pinnedBy/pinnedAt`。
- `T-DB-03` Advice sync: `POST /pharmacy/advice-records` -> `GET /pharmacy/advice-records` + `GET /patients/{id}/messages`。
- `T-DB-04` Error report update/read-back: `POST /pharmacy/error-reports` -> `PATCH /pharmacy/error-reports/{id}` -> `GET /pharmacy/error-reports/{id}`。
- `T-DB-05` Compatibility favorites lifecycle: `POST` -> `GET` -> `DELETE` -> `GET`。
- `T-DB-06` AI chat persistence: `POST /ai/chat` -> `GET /ai/sessions/{id}` 驗證 `ai_messages` 寫入與 session metadata。

3) Patch
- 新增 `reports/prompt-P03-result.md`
- 更新 `.orchestrator/state.json`

4) Verification
- 命令：`backend/.venv312/bin/python -m pytest backend/tests/test_api -q`
  - 證據：`61 passed`，現有 API/DB 路徑可運作。
- 命令：`rg -n "select\(|db.add\(|db.delete\(|create_audit_log" backend/app/routers -g '*.py'`
  - 證據：可定位每條關鍵讀寫路徑。
- 命令：`ls backend/alembic/versions && nl -ba backend/alembic/versions/*.py`
  - 證據：`001~006` migration 鏈存在且可對照模型。

5) Gate
- PROMPT-03 COMPLETE
