# ChatICU Production Hardening — Task Tracker

**Project:** ChatICU 2026 ISMS-Compliant Production Deployment
**Created:** 2026-02-15
**Last Updated:** 2026-02-15 (Session 18 — T27 Branch Protection Checklist + T04 UAT Draft)
**Total Tasks:** 32 | **Completed:** 13 | **In Progress:** 10 (T04, T14, T15, T20, T21, T22, T23, T24, T26, T27) | **Blocked:** 0

---

## Progress Dashboard

```
P0 (Critical):  [===========] 11/26 completed + T04/T14/T15/T20/T21/T22/T23/T24/T26 partial
P1 (Important): [=====] 2/4   completed (T28, T30) + T27 partial
P2 (Deferred):  [  ] 0/2  completed
Overall:        [===========] 13/32 completed + 10 partial
```

### Phase Completion

| Phase | Tasks | Status |
|-------|-------|--------|
| A — Architecture Lock (T01-T02) | 2/2 | **Complete** (T02: openapi.json regenerated — 50 paths, 61 methods) |
| B — Security Foundation (T05-T10) | 6/6 | **Complete** (re-audited x3, all gaps fixed) |
| C — Frontend Production (T03-T04) | 1.5/2 | **T03 Complete** (13 files total), T04 Partial |
| D — Logging & Monitoring (T11-T14) | 1.5/4 | **T11 Complete**, **T14 Partial** (UTC code compliance verified, NTP infra pending) |
| E — Infra & Crypto (T15-T16) | 0.5/2 | **T15 Partial** (HSTS + CORS done, TLS/Redis SSL pending) |
| F — DB & Continuity (T17-T19) | 1/3 | **T17 Complete** |
| G — CI/CD & Env (T20-T22) | 1.5/3 | **T20 Partial**, **T21 Partial** (CHANGELOG created), **T22 Partial** (9-job CI + gate) |
| H — Security Testing (T23-T26) | 1.5/4 | **T23 Partial** (SAST+DAST CI), **T24 Partial** (SLA+Dependabot), **T26 Partial** (Pydantic validation enhanced) |
| I — QA & Compliance (T27-T32) | 2.5/6 | **T27 Partial** (Playwright critical journey + CI gate), **T28 Complete, T30 Complete** |

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not Started |
| `[~]` | In Progress |
| `[x]` | Completed |
| `[!]` | Blocked |

---

## Sprint Board（僅未完成項）

> 用途：只追「未完成 / 部分完成」任務。每次執行後，先更新「下一個動作」與「截止日」，完成即回原任務區塊打勾。

| Task | 狀態 | 下一個可執行動作（Next Action） | Owner | 截止日 |
|------|------|----------------------------------|-------|--------|
| T04 | `[~]` | 完成 UAT-T04-003/006/007 手動驗證並補簽核（草案：`docs/qa/t04-uat-report-2026-02-15-draft.md`） | Backend Lead | 2026-02-20 |
| T12 | `[ ]` | 設定日誌保存/封存策略（6 個月）與防竄改機制（WORM/不可變儲存）並留存設定截圖 | SRE / Platform | 2026-02-27 |
| T13 | `[ ]` | 建立每週日誌審查排程與告警規則（異常登入/權限變更），產出首份審查紀錄 | SOC / 資安維運 | 2026-02-27 |
| T14 | `[~]` | 於主機/容器層啟用 NTP 校時與 offset 監測，補監控面板與告警證據 | SRE / Platform | 2026-03-06 |
| T15 | `[~]` | 在反向代理強制 TLS 1.2+，並完成 Redis/DB 連線加密設定與驗證 | Security Eng | 2026-03-06 |
| T16 | `[ ]` | 建立金鑰輪替 SOP（JWT/DB/Redis/API keys）與季度輪替演練紀錄模板 | DevOps | 2026-03-10 |
| T18 | `[ ]` | 建立自動備份 + 還原演練流程，定義 RPO 並產出第一次 restore 證據 | DBA / SRE | 2026-03-13 |
| T19 | `[ ]` | 建立備援切換 Runbook，完成一次 RTO 計時演練並留存報告 | SRE | 2026-03-20 |
| T20 | `[~]` | 完成 dev/stg/prod 三環境分離（含獨立 DB/權限），補環境矩陣文件 | DevOps | 2026-03-10 |
| T21 | `[~]` | 於 staging 完成一次 live rollback 演練（非 tabletop）並附 CI/驗證紀錄 | PM / Release | 2026-02-24 |
| T22 | `[~]` | 於「另一台乾淨主機/容器」再跑一次 runbook，補完整 shell transcript | DevOps | 2026-02-24 |
| T23 | `[~]` | 連續追蹤 3 次 DAST（確認維持 High/Medium/Low = 0）並更新趨勢 | Security Eng | 2026-02-24 |
| T24 | `[~]` | 每週更新 vulnerability register（新增 owner/截止日/retest 狀態欄位維護） | Security Eng | 2026-02-25 |
| T25 | `[ ]` | 建立入侵/異常監控告警（4xx/5xx/來源異常）與通報 SOP，完成一次演練 | SOC | 2026-03-07 |
| T26 | `[~]` | 補齊 XSS 防護驗證測試案例並新增 CI 測項；FIM 需求拆為 infra 子任務 | Security Eng | 2026-02-25 |
| T27 | `[~]` | 套用 `docs/qa/t27-branch-protection-checklist.md` 並補 3 張 branch protection/PR 證據截圖 | QA Lead | 2026-02-22 |
| T29 | `[ ]` | 盤點委外供應商清單，補安全條款與保密/資安責任對照表 | PM / 法務 | 2026-03-12 |
| T31 | `[ ]` | 制定滲測範圍與驗收基準，安排首輪測試與修補追蹤模板 | Security Eng | 2026-03-24 |
| T32 | `[ ]` | 盤點靜態資料加密範圍，完成 at-rest encryption 設計與遷移計畫 | Security Eng | 2026-03-24 |

---

## Phase A — Architecture Lock

### T01 | P0 | 單一正式後端定版

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | PM / 架構師 |
| **協作** | Backend, DevOps |
| **估工** | 0.5 人天 |
| **依賴** | — |
| **對應 ISMS** | 60, 62, 63 |
| **完成定義 (DoD)** | 正式環境僅一套 API 路徑 |

**採取措施：**
- [x] 確認 `backend/` 為唯一正式後端，`ChatICU/` 僅供開發參考
- [x] 移除或封存 `ChatICU/` 避免混淆 → `ChatICU/ARCHIVED.md` 已建立
- [x] 繪製最終架構圖（API Gateway → FastAPI → PostgreSQL/Redis） → `backend/docs/ARCHITECTURE.md`
- [x] 確認所有 endpoint 路由清單（59 endpoints across 16 routers） → `backend/docs/ARCHITECTURE.md`
- [x] 確認 Docker Compose 部署設定正確（3 services: api, db, redis + health checks）

**驗證方式：**
- [x] 架構圖已建立 → `backend/docs/ARCHITECTURE.md`
- [x] 路由清單 59 endpoints 與 16 routers 一致
- [x] 部署設定查核：Docker Compose 3 services + volumes + health checks 正確

**產出物：**
- `ChatICU/ARCHIVED.md` — 封存說明
- `backend/docs/ARCHITECTURE.md` — 架構圖 + 59 endpoint 路由清單 + RBAC 矩陣 + 檔案結構

**發現的待修項（移交至後續任務）：**
- T06: JWT_SECRET 硬編於 `.env`
- T10: JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440 (24h) 過長
- T20: Dockerfile CMD 含 `--reload` 需移除（production）

---

### T02 | P0 | API 契約凍結

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Frontend, QA |
| **估工** | 1.0 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 51, 60 |
| **完成定義 (DoD)** | OpenAPI / 錯誤碼文件定版 |

**採取措施：**
- [x] 匯出 `backend/` 的 OpenAPI spec → `docs/openapi.json`（50 paths, 61 operations — re-audit 3 regenerated）
- [x] 統一回應格式：success `{success, data, message}` / error `{success, error, message}`
- [x] 定義錯誤碼規範：9 個標準 error code（BAD_REQUEST → SERVICE_UNAVAILABLE）
- [x] 凍結 API 版本（v1）→ `docs/API_CONTRACT.md`
- [ ] 前後端共同審閱並簽核（待人工完成）

**驗證方式：**
- [x] 契約測試 7 項通過 → `tests/test_api/test_contract.py`
- [ ] 版本簽核紀錄（待人工完成）

**實作內容：**
- 修正 `health.py` → 使用 `success_response()` 包裝
- 修正 `auth.py` → HTTPException detail 統一為 plain string
- 新增全域異常處理器 in `main.py`：HTTPException / ValidationError / 500 統一 envelope
- 新增 `docs/API_CONTRACT.md` — 完整契約文件（envelope 格式、錯誤碼、JWT flow、分頁、CORS、rate limiting）
- 新增 `docs/openapi.json` — OpenAPI 3.1.0 spec（45 paths, 56 operations）
- 新增 `tests/test_api/test_contract.py` — 7 項 envelope 驗證測試
- **補修 (re-audit 2):** `docs/API_CONTRACT.md` 新增 3 個 auth endpoints 文檔:
  - `POST /auth/change-password` (T07)
  - `POST /auth/reset-password-request` (T08)
  - `POST /auth/reset-password` (T08)
  - JWT Payload 更新含 iat/jti
  - Token Flow 更新為 8 步驟
  - 新增 Password Policy + Account Lockout 章節
- **補修 (re-audit 3):** `docs/openapi.json` 完整重新生成 — 從 FastAPI app.openapi() 自動產出:
  - 新增 5 個遺漏端點: `/auth/change-password`, `/auth/reset-password-request`, `/auth/reset-password`, `/admin/vectors/rebuild`, `/ai/messages/{message_id}/review`
  - 移除 2 個過時端點: `/admin/vectors/upload`, `/admin/vectors/{database_id}/rebuild`
  - 新增 2 個藥局端點: `/pharmacy/drug-interactions`, `/pharmacy/iv-compatibility`
  - 最終: 50 paths, 61 methods

**測試結果：** 60/60 passed

---

## Phase B — Security Foundation

### T05 | P0 | 認證契約一致化

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Frontend, QA |
| **估工** | 1.0 人天 |
| **依賴** | T02 |
| **對應 ISMS** | 35, 38, 39, 46 |
| **完成定義 (DoD)** | login / refresh / logout 一致 |

**採取措施：**
- [x] 統一 token 欄位定義（token, refreshToken, expiresIn）
- [x] 確認 refresh flow：後端 Redis 黑名單檢查 refresh token
- [x] logout 同時撤銷 access + refresh token（`blacklist:{token}` in Redis）
- [x] JWT payload 標準欄位：sub, username, role, exp, iat, jti, type

**實作內容：**
- `security.py`: 加入 `iat`（issued at）及 `jti`（unique token ID）claims 至 access/refresh token
- `auth.py` logout: 新增 refresh token 黑名單機制
- `auth.py` refresh: 新增黑名單檢查（revoked token 不可續期）
- **補修 (re-audit):** `auth.py` refresh: 實作 refresh token rotation — 回傳新 refreshToken 並黑名單舊 token
- **補修 (re-audit):** `schemas/auth.py` RefreshResponse: 新增 refreshToken 欄位，與前端契約一致
- **補修 (re-audit 2):** `src/lib/api/auth.ts` logout: 修正前端 logout 發送 refreshToken body（原本只呼叫 POST /auth/logout 不帶 body）

---

### T06 | P0 | 清除明文密碼與硬編密鑰

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | Backend, DevOps |
| **估工** | 1.0 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 37, 46, 59, 68, 69 |
| **完成定義 (DoD)** | repo 無 secret / 明文密碼 |

**採取措施：**
- [x] 掃描 repo 中所有硬編密鑰 → 已修正 config.py, alembic.ini, docker-compose.yml
- [x] `.env` 中的 secret 改用隨機生成值（`secrets.token_urlsafe(48)`）
- [x] seed_data.py 密碼確認使用 bcrypt hash
- [x] `.gitignore` 建立 → 包含 `.env`, `*.key`, `*.pem`, `*.cert`, `__pycache__`
- [ ] 加入 pre-commit hook（detect-secrets / gitleaks）— 待 T22 CI 建置時一併處理

**實作內容：**
- `config.py`: JWT_SECRET 預設改為 `INSECURE-DEV-ONLY-OVERRIDE-IN-PRODUCTION`
- `config.py`: 降低 token 預設壽命（15 min access, 1 day refresh）
- `alembic.ini`: 移除硬編 DB credentials → 改用 placeholder
- `docker-compose.yml`: 參數化 DB 帳密 `${POSTGRES_USER:-chaticu}`，使用 `env_file`
- `.env.example`: 建立乾淨範本（所有 secret 為 CHANGE_ME）
- `.gitignore`: 新建
- **補修 (re-audit):** `datamock/users.json`: 移除 9 筆明文密碼 + 5 筆測試帳號 + 真實 email
- **補修 (re-audit):** `.mcp.json`: 移除硬編 DB 連線字串 → `${DATABASE_URL}`
- **補修 (re-audit):** `config.py` DATABASE_URL: 預設改為 `user:pass@localhost` 佔位符
- **補修 (re-audit 2):** `seeds/seed_data.py`: Seed 預設密碼改從環境變數 `SEED_DEFAULT_PASSWORD` 讀取
- **補修 (re-audit 3):** `seeds/seed_data.py`: 移除明文密碼 fallback — 未設定 `SEED_DEFAULT_PASSWORD` 環境變數時 `sys.exit(1)` 終止執行（不再有 dev-only 預設值）
- **補修 (re-audit 3):** `.env.example`: 新增 `SEED_DEFAULT_PASSWORD=` 欄位

---

### T07 | P0 | 密碼政策落地

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | Backend |
| **估工** | 0.5 人天 |
| **依賴** | T05 |
| **對應 ISMS** | 40, 41, 42 |
| **完成定義 (DoD)** | 複雜度 / 效期 / 歷史策略生效 |

**採取措施：**
- [x] 密碼最低複雜度（>=12 字元、大寫+小寫+數字+特殊字元）
- [x] 密碼效期（90 天強制更換）→ `PASSWORD_EXPIRY_DAYS=90` in config.py
- [x] 歷史密碼限制（最近 5 次不得重複）→ `PasswordHistory` model + `PASSWORD_HISTORY_COUNT=5`
- [x] 註冊 / 重設時驗證密碼強度（Pydantic field_validator）
- [x] 自助變更密碼 `POST /auth/change-password`（驗證舊密碼 + 歷史檢查）

**實作內容：**
- `security.py`: `validate_password_strength()` — 5 項檢查, `check_password_history()` — 比對歷史 hash
- `models/user.py`: 新增 `password_changed_at` 欄位 + `PasswordHistory` model (id, user_id, password_hash, created_at)
- `config.py`: 新增 `PASSWORD_EXPIRY_DAYS=90`, `PASSWORD_HISTORY_COUNT=5`
- `auth.py` login: 登入時檢查 password_changed_at，超過 90 天 → `passwordExpired: true`
- `auth.py`: 新增 `POST /auth/change-password` — 驗證舊密碼、強度、歷史 5 次、更新 hash + timestamp
- `admin.py` update_user: 修改密碼時記錄舊 hash 至 password_history
- `seeds/seed_data.py`: 新使用者設定 `password_changed_at=now()`
- `alembic/versions/002_password_history.py`: 新增 migration
- `tests/test_services/test_password_policy.py`: 9 項密碼政策測試

---

### T08 | P0 | 防暴力破解與安全重設

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | Backend, QA |
| **估工** | 1.0 人天 |
| **依賴** | T05, T07 |
| **對應 ISMS** | 39, 43, 44 |
| **完成定義 (DoD)** | 5 次失敗鎖定 / 一次性重設 |

**採取措施：**
- [x] 登入失敗 5 次鎖定帳號 15 分鐘（Redis: `lockout:{username}` + `login_attempts:{username}`）
- [x] Rate limiting 確認 login endpoint: `@limiter.limit(settings.RATE_LIMIT_LOGIN)` = 5/minute
- [x] 密碼重設使用一次性 + 時效符記 → `POST /auth/reset-password-request` + `POST /auth/reset-password`
- [x] 登入成功後重設嘗試計數器

**實作內容：**
- `auth.py` login: Redis 計數 `login_attempts:{username}`（自動過期 900s）
- 達 5 次 → Redis `lockout:{username}` 設定 15 分鐘
- 失敗時回傳剩餘嘗試次數警告（剩 1-2 次時提示）
- 成功登入 → 清除 attempts + lockout key
- 審計日誌記錄失敗嘗試（含 attempt 次數）
- `POST /auth/reset-password-request`: 產生 Redis 一次性 token (30 min TTL)，rate limit 3/min
- `POST /auth/reset-password`: 驗證 token → 密碼強度 + 歷史檢查 → 更新密碼 → 消耗 token
- 防止用戶名枚舉（無論帳號存在與否均回傳相同訊息）
- `schemas/auth.py`: 新增 `ResetPasswordInitRequest`, `ResetPasswordRequest`, `ChangePasswordRequest`
- **補修 (re-audit 2):** `auth.py` reset_password_request: 移除 API response 中的 `resetToken` 欄位 → 僅回傳 generic success message（token 只存 Redis，不洩漏給 client）

---

### T09 | P0 | RBAC 最小權限伺服器端化

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Security, QA |
| **估工** | 1.5 人天 |
| **依賴** | T02 |
| **對應 ISMS** | 9, 11, 47 |
| **完成定義 (DoD)** | 越權測試全擋 |

**採取措施：**
- [x] 審查全部 16 routers `require_roles()` 覆蓋範圍 → 審計報告完成
- [x] 角色-權限矩陣已建立於 `ARCHITECTURE.md`
- [x] 修正 4 處 RBAC 缺口：pharmacy.py, patients.py, clinical.py, ventilator.py
- [x] 資料層過濾（role-based patient visibility）→ **補修 (re-audit 2)**
- [x] 伺服器端 RBAC 為唯一授權依據

**實作內容：**
- `pharmacy.py`: 5 端點中 4 個改為 `require_roles("pharmacist", "admin")`（create 保持 `get_current_user` 讓所有臨床人員可通報）
- `patients.py` archive: `get_current_user` → `require_roles("admin", "doctor")`
- `clinical.py` /decision: `get_current_user` → `require_roles("doctor", "admin")`（臨床決策權限）
- `ventilator.py` POST weaning: `get_current_user` → `require_roles("doctor", "admin")`（脫機決策權限）

**RBAC 審計結果：**
| Router | Endpoints | Status |
|--------|-----------|--------|
| admin.py | 8 endpoints | All `require_roles("admin")` — correct |
| pharmacy.py | 5 endpoints | **Fixed** → pharmacist+admin |
| patients.py | 6 endpoints | **Fixed** archive → admin+doctor |
| clinical.py | 4 endpoints | **Fixed** /decision → doctor+admin |
| ventilator.py | 4 endpoints | **Fixed** POST weaning → doctor+admin |
| medications.py | 3 endpoints | POST=doctor, PATCH=doctor+pharmacist — correct |
| Others (8 routers) | ~20 endpoints | `get_current_user` appropriate (all 4 roles need access) |

**補修 (re-audit 2) — 資料層過濾：**
- `patients.py` list_patients: admin/pharmacist 看全部；doctor 看自己 unit + 主治病患；nurse 只看自己 unit
- `patients.py` get_patient: 存取權檢查 → 無權限回傳 403（`無權限查看此病患資料`）
- 使用 Patient.department + User.unit 欄位做 RBAC data-level filtering

---

### T10 | P0 | Session 逾時與使用條件限制

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Security, Frontend |
| **估工** | 0.8 人天 |
| **依賴** | T05, T09 |
| **對應 ISMS** | 5, 6, 7 |
| **完成定義 (DoD)** | 逾時登出 / 來源限制有效 |

**採取措施：**
- [x] Access token 短效期：15 分鐘（`JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15`）
- [x] Refresh token 合理效期：1 天（`JWT_REFRESH_TOKEN_EXPIRE_DAYS=1`）
- [x] 後端閒置逾時：30 分鐘無 API 呼叫自動失效（`SESSION_IDLE_TIMEOUT_MINUTES=30`）
- [ ] 可選：IP / User-Agent 綁定 session — 留待需求確認

**實作內容：**
- `config.py`: 新增 `SESSION_IDLE_TIMEOUT_MINUTES = 30`
- `middleware/auth.py`: 新增 idle timeout 機制
  - Redis key `last_activity:{user_id}` 記錄最後活動時間戳
  - 每次 API 呼叫更新 last_activity
  - 若距上次活動超過 30 分鐘 → 黑名單當前 token + 401 回應
  - 使用者需重新登入

---

## Phase C — Frontend Production

### T03 | P0 | 移除 production mock fallback

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Frontend Lead |
| **協作** | Backend, QA |
| **估工** | 1.0 人天 |
| **依賴** | T02 |
| **對應 ISMS** | 9, 11, 51, 76 |
| **完成定義 (DoD)** | 前端不再顯示假資料 |

**採取措施：**
- [x] 掃描前端所有 mock fallback（`datamock/`, `mockData`, `DEMO_`）
- [x] Production build 移除 mock fallback → 改為 API 呼叫 + 錯誤提示 UI
- [ ] 環境變數控制：`VITE_USE_MOCK=false` in production — 非必需，已直接移除所有 mock
- [x] API 失敗時顯示「資料暫時無法取得」/ loading spinner

**實作內容（re-audit 2）：**
移除 7 個前端頁面的 mock data fallback，改為真實 API 呼叫:
- `src/pages/dashboard.tsx`: 移除 mockDashboard 陣列 → 改用 `getPatients()` API + loading/error 狀態
- `src/pages/admin/users.tsx`: 移除 mockUsers 陣列 → 改用 `getUsers()` API
- `src/pages/admin/vectors.tsx`: 移除 mockVectorDatabases → 改用 admin API `/admin/vectors`
- `src/pages/admin/placeholder.tsx`: 移除硬編 system info → 改用 admin API `/admin/system-info`
- `src/pages/pharmacy/error-report.tsx`: 移除 mockReports → 改用 pharmacy API
- `src/pages/pharmacy/workstation.tsx`: 移除 mockPatients/mockDrugInteractions/mockIVCompatibility → 改用 patients API + TODO 標記待後端整合項目
- `src/pages/patient-detail.tsx`: 移除 MOCK_AI 回覆 → 改用 `sendChatMessage()` API; 移除 mockLabTrendData/labChineseNames/labReferenceRanges → 改用內聯對照表 + empty 趨勢資料（待後端 lab trend API）

**實作內容（re-audit 3）：**
移除額外 6 個前端檔案的 mock data（共 13 檔案清理完成）:
- `src/components/lab-data-display.tsx`: 移除 `mockLabTrendData/labReferenceRanges/labChineseNames` import → 內聯常數定義 + empty labTrendData
- `src/pages/admin/statistics.tsx`: 移除 `mockPatientMessages/ADVICE_TYPE_MAP/MedicationAdviceCode` import → 改用 `/pharmacy/advice-statistics` API + inline 常數
- `src/pages/pharmacy/interactions.tsx`: 移除 `mockDrugInteractions` import → 改用 `GET /pharmacy/drug-interactions` API（新建後端端點）
- `src/pages/pharmacy/compatibility.tsx`: 移除 `mockIVCompatibility` import → 改用 `GET /pharmacy/iv-compatibility` API（新建後端端點）
- `src/pages/pharmacy/dosage.tsx`: 重命名內聯 `mockResult` → `calculatedResult`（本地計算，無外部 mock import）
- `src/components/medical-records.tsx`: 移除未使用的 `mockPatients` import + 硬編初始記錄 → 空陣列

**實作內容（re-audit 5 supplementary — 殘餘 mock 清理）：**
- `src/pages/pharmacy/advice-statistics.tsx`: 移除 `pharmacyAdviceRecords`/`ADVICE_CATEGORIES` mock-data import → 改用 `getAdviceRecords()` API + `ADVICE_CATEGORIES` 內聯靜態常數 + loading/error 狀態
- `src/pages/patients.tsx:126`: `typeof mockPatients[0]` → `PatientWithFrontendFields`（mockPatients 從未 import，為類型殘留）
- `.env.example:10`: `VITE_USE_MOCK=true` → `VITE_USE_MOCK=false`（預設值不應為 mock 模式）
- `src/lib/api/pharmacy.ts`: 新增 `PharmacyAdviceRecord` interface + `getAdviceRecords()` API function（後端端點待建: `GET /pharmacy/advice-records`）

**驗證方式：**
- [x] `grep -r "mock-data\|mockDrug\|mockIV\|mockPatient\|mockLab" src/` → 0 matches in target files
- [x] `grep -r "mock-data" src/` → 0 matches（re-audit 5 supplementary 確認）
- [ ] Production build 測試案例（API 斷線 → 顯示錯誤）— 需手動驗證
- [ ] 錄影證據

---

### T04 | P0 | 核心流程改真實後端

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Frontend, QA |
| **估工** | 2.0 人天 |
| **依賴** | T02, T03 |
| **對應 ISMS** | 51, 52 |
| **完成定義 (DoD)** | 登入 / 病患 / 留言 / AI 皆走真 API |

**採取措施：**
- [x] 登入 → JWT 認證 → 自動 refresh（已在前端 API client 實作）
- [x] 病患列表 / 詳情 → PostgreSQL 真實資料（前端 T03 已改用 API）
- [x] AI Chat → 真實 LLM + RAG + DB 持久化（`sendChatMessage()` API）
- [x] RAG 查詢 → 真實文獻檢索
- [x] 藥局工作站 → 藥物交互作用 + IV 相容性 API 已建 + 前端已對接（re-audit 3）
- [x] 檢驗趨勢圖 → patient-detail.tsx 改用 `labDataApi.getLabTrends()` 後端 API（re-audit 4）
- [x] 檢驗卡片渲染防呆 → `lab-data-display.tsx` 新增容錯取值（避免 object 直接渲染造成 runtime crash）
- [x] 留言 / 團隊聊天 → chat.tsx 使用 teamChatApi, patient-detail.tsx 使用 messagesApi（已驗證無 mock）
- [ ] E2E 全流程人工驗證

**實作內容（re-audit 2）：**
- `src/lib/api/ai.ts`: 修正 `streamChatMessage()` — 原呼叫不存在的 `/ai/chat/stream` SSE endpoint → 改為 wrapper 呼叫 `sendChatMessage()` POST
- `backend/app/routers/pharmacy.py`: 移除 `get_advice_statistics()` mock 資料 → 改為真實 DB 查詢 (ErrorReport 統計)
- `backend/app/routers/admin.py`: 移除 MOCK_VECTOR_DBS → 改用 `rag_service.get_status()` 真實 RAG 狀態
- `backend/app/services/llm_services/rag_service.py`: 新增 `get_status()` method

**實作內容（re-audit 3 — 前後端契約對齊）：**
- `src/lib/api/admin.ts`:
  - User interface: `status` → `active: boolean`（對齊後端 `User.active`）
  - UpdateUserData: `status?: string` → `active?: boolean`
  - 移除 `uploadToVectorDatabase()`（後端無此端點）
  - `rebuildVectorIndex()` URL 修正: `/admin/vectors/{databaseId}/rebuild` → `/admin/vectors/rebuild`
- `src/lib/api/pharmacy.ts`:
  - ErrorReport: `drug` → `medicationName`; 移除 `date`, `reportedAt`, `anonymous`, `resolvedAt`, `resolvedBy`; 新增 `reporterRole`, `reviewedBy`, `resolution`, `timestamp`
  - CreateErrorReportData: `drug` → `medicationName`; 移除 `anonymous`, `reporterId`, `reporterName`
  - AdviceStatistics: 重構為 `{ totalReports, resolvedRate, severityCounts }` 對齊後端
- `src/pages/admin/users.tsx`: `user.status` → `user.active`; toggle 改送 `{ active: !user.active }`
- `src/pages/pharmacy/error-report.tsx`: `drug: drugName` → `medicationName: drugName`; 移除 anonymous 相關 UI
- `src/pages/admin/vectors.tsx`: 移除 `uploadToVectorDatabase` 引用; `rebuildVectorIndex(dbId)` → `rebuildVectorIndex()`
- `backend/app/routers/pharmacy.py`: 新增 `GET /pharmacy/drug-interactions` + `GET /pharmacy/iv-compatibility` 端點（使用 DrugInteraction/IVCompatibility models）

**驗證方式：**
- [x] Backend mock 資料已移除（admin vectors, pharmacy stats）
- [x] Frontend streaming endpoint 修正
- [x] 前後端 API 契約 6 處修正完成（re-audit 3）
- [x] 檢驗趨勢圖改用後端 API（re-audit 4）
- [x] LabDataDisplay 元件趨勢圖改用後端 API（re-audit 5）
- [x] LabDataDisplay 容錯渲染修正（`Objects are not valid as a React child`）+ frontend build pass
- [x] Admin API 契約修正: createUser/updateUser return type 對齊（re-audit 5）
- [x] Pharmacy API 契約修正: ErrorReportsResponse/UpdateErrorReportData 對齊（re-audit 5）
- [x] Lab trend response type 修正: LabTrendsResponse 對齊後端（re-audit 5）
- [x] advice-statistics.tsx 移除 mock-data import → 改用 API（re-audit 5 supplementary）
- [x] patients.tsx mockPatients 類型殘留修正（re-audit 5 supplementary）
- [x] .env.example VITE_USE_MOCK 預設值改為 false（re-audit 5 supplementary）
- [x] 後端已建: `GET /POST /pharmacy/advice-records` endpoint + PharmacyAdvice model + migration 003（W1）
- [x] 前後端契約 100% 對齊: 11/11 欄位一致（W1 驗證）
- [ ] UAT 簽核（每個核心流程）
- [x] E2E 測試報告（Run `22031771983`，Playwright artifacts）
- [x] UAT 腳本與報告模板（`docs/qa/t04-uat-test-script.md`、`docs/qa/t04-uat-report-template.md`）
- [x] UAT 草案報告（`docs/qa/t04-uat-report-2026-02-15-draft.md`）
- [ ] UAT-T04-003/006/007 手動驗證與簽核補件

**實作內容（re-audit 4 — 趨勢圖對接）：**
- `src/pages/patient-detail.tsx`: 移除空 `trendData: []` + TODO 註解 → 新增 `useEffect` 呼叫 `labDataApi.getLabTrends()` API
  - 自動從後端取得 7 天趨勢資料
  - 根據 `labCategoryMap` 對照 lab name → category (biochemistry/hematology/bloodGas/inflammatory)
  - 自動取得 referenceRange 從 LabItem 回應
  - 資料映射為 `LabTrendData[]` 格式傳入 `LabTrendChart` 元件

**實作內容（re-audit 5 — 契約對齊 + LabDataDisplay API 化）：**
- `src/components/lab-data-display.tsx`:
  - 移除空 `labTrendData` placeholder（硬編空物件，導致趨勢圖永遠無法顯示）
  - 新增 `patientId` prop，點擊任何 lab 項目從 `getLabTrends()` API 取得 7 天趨勢
  - `handleLabClick` 改為 async，從 API snapshot 中萃取特定項目的趨勢數據
  - 所有 `hasHistory` 改為 `!!patientId`（有病患 ID 即可查看歷史）
  - 趨勢圖使用真實 API 數據而非空陣列
- `src/pages/patient-detail.tsx`: `<LabDataDisplay>` 傳入 `patientId={patient.id}`
- `src/lib/api/lab-data.ts`: `LabTrendsResponse` 修正為 `{trends: LabData[], days: number}` 對齊後端
- `src/lib/api/admin.ts`:
  - `createUser` return: `{message, user: User}` → `User`（後端回傳 flat user object）
  - `updateUser` return: `{message, user: User}` → `User`
- `src/pages/admin/users.tsx`: `result.user.username` → `result.username`（避免 runtime crash）
- `src/lib/api/pharmacy.ts`:
  - `ErrorReportsResponse`: 移除 `pagination`（後端未提供），`stats` 改為 optional
  - `UpdateErrorReportData`: `{status, actionTaken, resolvedBy}` → `{status, resolution}` 對齊後端 schema
  - `createErrorReport` return: `{message, report}` → `ErrorReport`
  - `updateErrorReport` return: `{message, report}` → `ErrorReport`
- `docs/qa/t04-uat-report-2026-02-15-draft.md`:
  - 8 個 UAT cases 先以 CI evidence 回填 5 項 Pass
  - 餘 3 項（留言板、lab trend 手動證據、pharmacy records）標記 Pending，待 PM/QA 簽核

**實作內容（W1 — advice-records 端點建立）：**
- `backend/app/models/pharmacy_advice.py`: 新建 `PharmacyAdvice` model（13 欄位: id, patient_id, patient_name, bed_number, pharmacist_id, pharmacist_name, advice_code, advice_label, category, content, linked_medications(JSONB), timestamp, created_at）
- `backend/app/models/__init__.py`: 新增 `PharmacyAdvice` export
- `backend/alembic/versions/003_pharmacy_advices.py`: 新建 migration（pharmacy_advices table + 2 indexes）
- `backend/app/schemas/admin.py`: 新增 `AdviceRecordCreate` schema（含 advice_code 格式驗證 + category enum 驗證）
- `backend/app/routers/pharmacy.py`:
  - `GET /pharmacy/advice-records` — 支援 month(YYYY-MM)、category、page、limit 篩選 + 分頁
  - `POST /pharmacy/advice-records` — 建立記錄（自動填入病患名稱/床號 + 藥師資訊 + audit log）
- `backend/tests/test_api/test_pharmacy_advice.py`: 8 項測試（list empty, create, create+list, filter category, invalid patient 404, invalid category 422, invalid code 422, response contract）
- `backend/tests/conftest.py`: 修正 `override_get_db` 加入 commit（修復跨 request 資料可見性）

---

## Phase D — Logging & Monitoring

### T11 | P0 | 日誌標準化與關鍵事件全記錄

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | SRE / Platform |
| **協作** | Backend, Security |
| **估工** | 1.5 人天 |
| **依賴** | T02 |
| **對應 ISMS** | 15, 16, 17, 19 |
| **完成定義 (DoD)** | 單一格式且欄位完整 |

**採取措施：**
- [x] 統一審計日誌格式：AuditLog model (id, timestamp, user_id, user_name, role, action, target, status, ip, details:JSONB)
- [x] 記錄關鍵事件（9/9 類別已覆蓋）
- [x] `audit.py` middleware 已被全面使用
- [x] JSON 日誌格式輸出（stdout structured logging）→ **補修 (re-audit 2)**
- [x] 敏感資料欄位遮蔽（password/token/secret/key）→ **補修 (re-audit 2)**

**審計日誌覆蓋範圍（updated re-audit 2）：**
| 類別 | Router | 動作 |
|------|--------|------|
| 認證 | auth.py | 登入成功/失敗、登出、改密碼、重設密碼 |
| 使用者管理 | admin.py | 建立使用者、更新使用者、RAG 重建 |
| 病患管理 | patients.py | 建立病患、更新病患資料、歸檔 |
| 藥物管理 | medications.py | 開立處方、更新藥物 |
| 藥局通報 | pharmacy.py | 提交/更新用藥異常通報 |
| AI 對話 | ai_chat.py | AI 對話紀錄、專家審閱 |
| RAG 索引 | rag.py | RAG 索引建立 |
| 團隊聊天 | team_chat.py | **新增** 發送團隊訊息、置頂/取消置頂 |
| 臨床 AI | clinical.py | **新增** 臨床摘要、衛教說明、指引查詢、決策支援 |
| 脫機評估 | ventilator.py | **新增** 建立脫機評估 |
| 病患訊息 | messages.py | **新增 (re-audit 3)** 建立訊息、標記已讀 |
| 檢驗校正 | lab_data.py | **新增 (re-audit 3)** 校正檢驗數據 |

**補修 (re-audit 2) 實作內容：**
- `middleware/audit.py`: 新增 `_mask_sensitive()` 函式 — 遞迴遮蔽 SENSITIVE_KEYS + regex pattern 匹配
  - 遮蔽: password, password_hash, token, refreshToken, resetToken, currentPassword, newPassword, secret, apiKey
- `middleware/audit.py`: 新增 structured JSON log 輸出 via `chaticu.audit` logger
- `main.py`: 新增 `JSONFormatter` class for SIEM ingestion — production 使用 JSON 格式，debug 使用 standard
- `main.py`: 配置 3 個 logger: chaticu, chaticu.audit, uvicorn
- `team_chat.py`: 新增 audit logging (send_team_chat, toggle_pin_message)
- `clinical.py`: 新增 audit logging (summary, explanation, guideline, decision)
- `ventilator.py`: 新增 audit logging (create_weaning_assessment)
- `pharmacy.py`: 新增 audit logging (update_error_report)

**驗證方式：**
- [x] 審計日誌呼叫覆蓋 12 大類別 (re-audit 3 新增: messages, lab_data)
- [x] 敏感資料遮蔽驗證 — `_mask_sensitive()` unit 可測試
- [x] Structured JSON logging in production mode

**補修 (re-audit 3)：**
- `messages.py`: 新增 `create_message` + `mark_message_read` 審計日誌
- `lab_data.py`: 新增 `correct_lab_data` 審計日誌

---

### T12 | P0 | 日誌留存與防竄改

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | SRE / Platform |
| **協作** | Security |
| **估工** | 1.0 人天 |
| **依賴** | T11 |
| **對應 ISMS** | 15, 25, 26, 27 |
| **完成定義 (DoD)** | 留存 >= 6 月且具完整性 |

**採取措施：**
- [ ] 日誌留存政策（>= 6 個月）
- [ ] 日誌完整性保護（hash chain / append-only storage）
- [ ] 異地備份（獨立儲存與主系統分離）
- [ ] 日誌存取控制（僅 SOC / 管理者可讀）

**驗證方式：**
- [ ] 保留策略文件
- [ ] hash 驗證紀錄
- [ ] 備份紀錄

---

### T13 | P0 | 日誌審查與失效告警

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | SOC / 資安維運 |
| **協作** | SRE, PM |
| **估工** | 0.8 人天 |
| **依賴** | T11, T12 |
| **對應 ISMS** | 18, 20, 21, 22 |
| **完成定義 (DoD)** | 有排程審查與即時告警 |

**採取措施：**
- [ ] 定期審查排程（每週 / 每月）
- [ ] 日誌失效即時告警（寫入失敗、磁碟滿）
- [ ] 異常行為告警（多次登入失敗、越權存取）
- [ ] 審查結果文件化

**驗證方式：**
- [ ] 審查紀錄
- [ ] 告警事件證據

---

### T14 | P0 | NTP 校時統一 UTC

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | SRE / Platform |
| **協作** | DevOps |
| **估工** | 0.3 人天 |
| **依賴** | T11 |
| **對應 ISMS** | 23, 24 |
| **完成定義 (DoD)** | 節點時間偏差受控 |

**採取措施：**
- [x] 全系統 UTC 時區統一（程式碼層面 100% 合規 — 驗證完成）
- [ ] NTP 校時配置（所有 container / VM）— 需 DevOps 配置
- [ ] 時間偏差監測 — 需 infra 監控

**實作內容（Session 6 驗證）：**
- 全面掃描 backend/ 程式碼:
  - 所有 `datetime.now()` 呼叫皆使用 `timezone.utc` 參數 ✓
  - 零 `datetime.utcnow()` 使用（已棄用的 API）✓
  - 模型層 `server_default=func.now()` 由 PostgreSQL 伺服器產生（遵循 DB timezone 設定）✓
  - seed_data.py 使用 `datetime.now(timezone.utc)` ✓
- 結論：程式碼層面 UTC 合規性 100%，無需修改

**驗證方式：**
- [x] 程式碼 UTC 合規驗證（grep 全掃描，零違規）
- [ ] 校時設定截圖（需部署後驗證）
- [ ] 偏移監測報告（需 infra 配置）

---

## Phase E — Infra & Crypto

### T15 | P0 | TLS 加密與來源控制點

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | DevOps, Backend |
| **估工** | 1.0 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 13, 14, 64, 65, 66 |
| **完成定義 (DoD)** | 僅 TLS 安全連線 |

**採取措施：**
- [ ] TLS 1.2+ 強制（禁用 TLS 1.0/1.1）— 需 reverse proxy (nginx/Caddy) 配置
- [x] HSTS header 啟用 → `HSTSMiddleware` in `main.py`（production 模式下自動附加 `max-age=31536000; includeSubDomains`）
- [x] 來源白名單 / CORS 正式設定 → `CORS_ORIGINS` 由 `.env` 設定，`.env.example` 已加註 production 說明
- [ ] 內部服務間通訊加密（Redis TLS, DB SSL）— 需 DevOps 配置

**實作內容（re-audit 4）：**
- `app/main.py`: 新增 `HSTSMiddleware` — BaseHTTPMiddleware，非 DEBUG 模式下所有 response 附加 `Strict-Transport-Security` header
- `.env.example`: CORS_ORIGINS 加註 production 域名設定說明

**驗證方式：**
- [x] HSTS header 驗證（非 DEBUG 模式下 response 含 `Strict-Transport-Security`）
- [x] CORS 配置可由環境變數覆寫
- [ ] TLS 掃描報告（ssllabs / testssl.sh）— 需部署後驗證
- [ ] ACL / CORS 查核 — 需部署後驗證

---

### T16 | P0 | 金鑰 / 憑證管理與輪替

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | DevOps |
| **協作** | Security |
| **估工** | 0.8 人天 |
| **依賴** | T15 |
| **對應 ISMS** | 67, 68 |
| **完成定義 (DoD)** | 有輪替計畫並執行 |

**採取措施：**
- [ ] JWT signing key 輪替計畫
- [ ] TLS 憑證自動更新（Let's Encrypt / certbot）
- [ ] API key 輪替機制
- [ ] 金鑰保管規範（KMS / Vault）

**驗證方式：**
- [ ] KMS / 憑證輪替紀錄
- [ ] 輪替計畫文件

---

## Phase F — DB & Continuity

### T17 | P0 | Migration 正式化

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | DBA / Backend |
| **協作** | DevOps |
| **估工** | 1.0 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 58, 60, 63 |
| **完成定義 (DoD)** | 空庫可升級最新 |

**採取措施：**
- [x] Alembic migration 正式化 → 2 version files
- [x] `001_initial_schema.py`: 15 tables, all FK/indexes, upgrade + downgrade
- [x] `002_password_history.py`: password_history table + users.password_changed_at
- [x] 空庫（CI PostgreSQL service）→ `alembic upgrade head` 驗證（GitHub Actions Run `22029666045`）
- [ ] seed + 資料驗證（待補）
- [x] Migration 版本納入 CI pipeline（`migration-check` job）

**實作內容：**
- `alembic/versions/001_initial_schema.py`: 15 tables covering all models
  - Independent tables first: users, patients, drug_interactions, iv_compatibilities, error_reports, ai_sessions
  - FK tables: vital_signs, lab_data, medications, patient_messages, ventilator_settings, weaning_assessments, team_chat_messages, audit_logs, ai_messages
  - All indexes matching model definitions
  - Full downgrade support (reverse order drop)
- `alembic/versions/002_password_history.py`: T07 schema additions

**驗證方式：**
- [x] Migration files syntax valid (Python imports + SA ops)
- [x] migration 演練（空庫 → 最新版）— GitHub Actions Run `22029666045`
- [x] 已有一次完整 CI 全綠證據（Run `22029666045`，含 `migration-check`）
- [x] 版本紀錄（Execution Log 已附 run id）

---

### T18 | P0 | 備份與還原能力 (RPO)

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | DBA / SRE |
| **協作** | PM |
| **估工** | 1.0 人天 |
| **依賴** | T17 |
| **對應 ISMS** | 28, 29, 30, 31, 32 |
| **完成定義 (DoD)** | 還原演練成功 |

**採取措施：**
- [ ] PostgreSQL 備份政策（pg_dump daily + WAL archiving）
- [ ] RPO 目標定義（如 < 1 小時）
- [ ] 備份加密與異地儲存
- [ ] 定期還原演練（每季）

**驗證方式：**
- [ ] 還原演練報告
- [ ] 簽核紀錄

---

### T19 | P0 | 備援切換能力 (RTO)

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | SRE |
| **協作** | DevOps, PM |
| **估工** | 1.2 人天 |
| **依賴** | T18 |
| **對應 ISMS** | 33, 34 |
| **完成定義 (DoD)** | 故障切換達標 |

**採取措施：**
- [ ] RTO 目標定義（如 < 4 小時）
- [ ] 備援機制（standby DB / container restart policy）
- [ ] 故障切換 SOP
- [ ] 中斷切換演練

**驗證方式：**
- [ ] 切換演練紀錄
- [ ] RTO 量測報告

---

## Phase G — CI/CD & Environment

### T20 | P0 | 環境隔離與組態管制

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | DevOps |
| **協作** | Backend, QA |
| **估工** | 0.8 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 58, 62 |
| **完成定義 (DoD)** | dev / stg / prod 分離 |

**採取措施：**
- [ ] 三環境分離（dev / staging / production）
- [ ] 組態分層（.env.dev / .env.stg / .env.prod）
- [ ] 環境間最小權限（prod 只有 CD pipeline 可部署）
- [ ] 資料庫隔離（各環境獨立 DB）
- [x] Dockerfile 移除 `--reload` flag（production 不應自動重載）
- [x] docker-compose.yml 移除 source code volume mounts（`./app`, `./seeds`），僅保留 RAG docs readonly mount

**實作內容（re-audit 4）：**
- `Dockerfile:21`: CMD 移除 `--reload`
- `docker-compose.yml:18-20`: 移除 `./app:/code/app` + `./seeds:/code/seeds` 開發掛載

**驗證方式：**
- [x] Dockerfile CMD 無 `--reload`
- [x] docker-compose 無 source code bind mount
- [ ] 環境清單
- [ ] 設定審核紀錄

---

### T21 | P0 | 版本控制與變更管理

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | PM / Release |
| **協作** | DevOps, QA |
| **估工** | 0.5 人天 |
| **依賴** | T20 |
| **對應 ISMS** | 60, 63 |
| **完成定義 (DoD)** | 發版可追溯可回滾 |

**採取措施：**
- [x] CHANGELOG.md 建立 — v1.0.0 完整記錄（Keep a Changelog 格式）
- [x] Semantic versioning: APP_VERSION = "1.0.0" in config.py
- [x] Git tag + semantic versioning（`v1.0.0` 已建立並推送）
- [x] 變更單（CR）模板（`docs/release/change-request-template.md`）
- [x] 發版審批 checklist（`docs/release/release-approval-checklist.md`）
- [x] 回滾 SOP（`docs/release/rollback-sop.md`）
- [x] 變更單實際紀錄（`docs/release/records/cr-2026-02-15-session13.md`）
- [x] 回滾演練紀錄（tabletop）（`docs/release/records/rollback-drill-2026-02-15.md`）

**實作內容（Session 6）：**
- `CHANGELOG.md` (root): v1.0.0 entry covering:
  - Added: 17 項功能（FastAPI backend, JWT, password policy, RBAC, audit logging, safety guardrail, RAG, AI chat, etc.）
  - Security: 9 項安全措施（HSTS, CORS, no plaintext passwords, error masking, etc.）
  - Infrastructure: 4 項基礎設施（Docker Compose, GitHub Actions CI, Bandit SAST, OpenAPI spec）
  - Frontend: 4 項前端改善（mock removal, contract alignment, lab trend chart, real API calls）
- `docs/release/records/cr-2026-02-15-session13.md`: 完成一次正式 CR 紀錄（含 scope、風險、驗證、核准欄位）
- `docs/release/records/rollback-drill-2026-02-15.md`: 完成一次 rollback drill 紀錄（tabletop + command plan）

**驗證方式：**
- [x] CHANGELOG.md 存在且符合 Keep a Changelog 格式
- [x] APP_VERSION in config.py
- [x] CR 模板文件（`docs/release/change-request-template.md`）
- [x] 發版審批 checklist（`docs/release/release-approval-checklist.md`）
- [x] 回滾 SOP 文件（`docs/release/rollback-sop.md`）
- [x] 變更單實際紀錄（`docs/release/records/cr-2026-02-15-session13.md`）
- [x] 回滾演練紀錄（`docs/release/records/rollback-drill-2026-02-15.md`）
- [x] release tag 已建立並推送（`v1.0.0`）
- [ ] staging live rollback drill（待執行；目前為 tabletop）

---

### T22 | P0 | 建置可重現與 CI 穩定

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15 (Run `22034008508` full pipeline green)** |
| **Owner** | DevOps |
| **協作** | Frontend, Backend |
| **估工** | 1.0 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 51, 58, 60 |
| **完成定義 (DoD)** | 新環境可 build / test |

**採取措施：**
- [x] CI pipeline — GitHub Actions workflow 建立 (`.github/workflows/ci.yml`)
- [x] CI 跑 lint + test + security scan + migration + frontend build + e2e + dast + reproducibility + docker build（9 jobs）
- [x] 鎖定 Python 版本 — Dockerfile 使用 `python:3.12-slim`，CI 使用 `python-version: "3.12"`
- [x] 鎖定依賴版本 — `pip-compile --generate-hashes` → `requirements.lock`（1686 行，含 SHA256 hash）
- [x] Dockerfile 多階段建置 — Builder(gcc+pip install) → Runtime(slim, non-root user, HEALTHCHECK)
- [x] 已有一次完整 CI 全綠證據（Run `22029666045` + Run `22031345836`，後者含 e2e/DAST/reproducibility/docker）
- [x] 新環境重現報告機制已納入 CI（`reproducibility-report` artifact job）
- [x] CI 連續 3 次綠燈驗證（`22031759710`、`22031766156`、`22031771983`）
- [x] 最新手動全綠驗證（workflow_dispatch: `22033478586`，含 `e2e-extended-journeys`）
- [x] 最新 push 全綠驗證（Run `22034008508`，含 critical E2E/DAST/docker-build）
- [x] 新環境重建 Runbook（`docs/operations/environment-rebuild-runbook.md`）
- [x] 本地重建演練報告（`docs/operations/reproducibility-reports/2026-02-15-local-rebuild-drill.md`）

**實作內容（Session 6 + Session 8 + Session 9 + Session 10 + Session 11）：**
- `.github/workflows/ci.yml`: 10-job CI pipeline:
  1. `backend-test`: Python 3.12 + Redis service + pytest (SQLite for tests)
  2. `backend-lint`: flake8（依賴鎖版後單獨安裝 flake8）
  3. `security-scan`: bandit with pyproject.toml config, uploads JSON report artifact
  4. `migration-check`: PostgreSQL 16 service + `alembic upgrade head`
  5. `frontend-build`: npm ci +（條件式）tsc + vite build
  6. `e2e-critical-journey`: Playwright critical journey + video/report artifacts
  7. `dast-scan`: OWASP ZAP baseline + High-risk gate
  8. `reproducibility-report`: CI run metadata + lockfile hash report artifact
  9. `docker-build`: builds Docker image + verifies container starts (health check)
  10. `e2e-extended-journeys`: Playwright extended journeys（schedule / workflow_dispatch 可選啟用）
- Triggers: push/PR + weekly schedule + workflow_dispatch
- Environment: `TESTING=true`, `DATABASE_URL=sqlite+aiosqlite:///./test.db`

**實作內容（W1 — 鎖版 + 多階段 Docker）：**
- `backend/requirements.lock`: pip-compile 生成，1686 行含 `--hash=sha256:` 完整性驗證
- `backend/Dockerfile`: 2-stage multi-stage build:
  - Stage 1 (builder): `python:3.12-slim` + gcc + `pip install --prefix=/install -r requirements.lock`
  - Stage 2 (runtime): `python:3.12-slim` + `COPY --from=builder /install /usr/local` + non-root user `chaticu` + HEALTHCHECK
  - 只複製 `app/`, `alembic/`, `alembic.ini`, `seeds/`（無 tests/requirements/Dockerfile 等開發檔案）
- `.github/workflows/ci.yml`: cache-dependency-path 改為 `backend/requirements.lock`，install 改用 lock file
- Docker image 尺寸顯著減小（無 gcc/build artifacts）

**驗證方式：**
- [x] CI workflow YAML valid (10 jobs, proper triggers, Redis/PostgreSQL services)
- [x] requirements.lock 生成完成（含 hash 完整性）
- [x] Dockerfile multi-stage 建立完成（non-root, HEALTHCHECK）
- [x] CI 改用 requirements.lock 安裝
- [x] CI 首次完整綠燈紀錄：Run `22029666045`（all jobs passed）
- [x] Session 9（含 E2E+DAST+reproducibility）首次全綠 run `22031345836`
- [x] CI 紀錄（連續 3 次綠燈）：`22031759710` → `22031766156` → `22031771983`
- [x] 新環境重現測試報告（Run `22031771983` + `docs/operations/reproducibility-reports/2026-02-15-run-22031771983.md`）
- [x] 新環境重建步驟文件（`docs/operations/environment-rebuild-runbook.md`）
- [x] 最新全綠 run（`22033478586`）：含 critical + extended E2E、DAST、docker-build 全數通過
- [x] 最新全綠 run（`22034008508`）：push pipeline 全 job 綠燈（extended journeys 為非 blocking，該次 skipped）
- [x] 本地重建演練（versions + lock hashes + `npm ci/build` + PostgreSQL migration/seed）— `docs/operations/reproducibility-reports/2026-02-15-local-rebuild-drill.md`

---

## Phase H — Security Testing

### T23 | P0 | 安全檢測門檻 (SAST/DAST)

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15 (Run `22034008508` SAST/DAST gate green)** |
| **Owner** | Security Eng |
| **協作** | DevOps, QA |
| **估工** | 1.0 人天 |
| **依賴** | T22 |
| **對應 ISMS** | 54, 56 |
| **完成定義 (DoD)** | 高風險阻擋部署 |

**採取措施：**
- [x] SAST 工具導入 — Bandit 配置完成 (`backend/pyproject.toml`)
- [x] CI gate — `security-scan` job 在 CI pipeline 中（T22 ci.yml）
- [x] DAST 工具導入（OWASP ZAP baseline）— `dast-scan` job 已納入 CI
- [x] 定期掃描排程（每週 + 每次 MR）— CI 已設 push/PR + schedule trigger
- [x] 首次掃描報告產出（Run `22029666045`，artifact: `bandit-report`）
- [x] 安全掃描摘要文件（`docs/security/evidence/t23-security-scan-summary-2026-02-15.md`）
- [x] 最新 run artifact 已下載驗證（Run `22033478586`，含 `dast-gate-summary.md`）
- [x] CORP/cache 風險程式碼修補（`SecurityHeadersMiddleware` + contract test）
- [x] 修補後 DAST 回歸驗證（Run `22033663309`: High=0, Medium=0, Low=0）
- [x] 最新 push DAST gate 綠燈（Run `22034008508`）

**實作內容（Session 6 + Session 9 + Session 10 + Session 11 + Session 12）：**
- `backend/pyproject.toml`: Bandit SAST 配置:
  - `exclude_dirs`: tests, seeds, alembic
  - `skips`: B101 (assert_used — 測試中常用)
  - `severity`: medium (中等以上才報告)
- 同檔案包含 flake8 + pytest 配置:
  - flake8: max-line-length=120, exclude venv/__pycache__/alembic
  - pytest: asyncio_mode=auto, testpaths=tests
- `.github/workflows/ci.yml`: 新增 `dast-scan` job
  - 啟動 backend 測試服務後執行 `OWASP ZAP baseline`
  - 產出 `zap-report.json/html/warnings` artifact
  - Gate 規則：若 High 風險數量 > 0，pipeline fail
  - 產出 `dast-gate-summary.md`（直接摘要 Gate 結果）
- `backend/app/main.py`: `SecurityHeadersMiddleware` 新增
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Cache-Control: no-store`
  - `Pragma: no-cache`
  - `Expires: 0`
- `backend/tests/test_api/test_contract.py`: 安全 header 契約測試補強（含 CORP/cache headers）

**驗證方式：**
- [x] pyproject.toml Bandit 配置有效
- [x] CI workflow 包含 security-scan job
- [x] CI workflow 包含 dast-scan job（ZAP baseline + High-risk gate）
- [x] 掃描報告（Run `22029666045`，`bandit-report` artifact）
- [x] 已有一次完整 CI 全綠證據（Run `22029666045`，security-scan job in green run）
- [x] Gate 紀錄（Run `22029584324` 曾因 security-scan fail 阻擋）
- [x] DAST 首次掃描 artifact（Run `22031345836` 產出 `zap-report` artifact）
- [x] 掃描摘要文件（`docs/security/evidence/t23-security-scan-summary-2026-02-15.md`）
- [x] 最新 SAST/DAST gate 綠燈（Run `22033478586`）
- [x] 最新 artifact 指標核對（Run `22033478586`: High=0, Medium=0, Gate=PASS）
- [x] Header hardening 測試通過（`pytest tests/test_api/test_contract.py`）
- [x] 修補效果確認（Run `22033663309`: Low `1 -> 0`, 僅剩 Informational）
- [x] 最新 push gate 驗證（Run `22034008508`: `security-scan` + `dast-scan` 均為 success）

---

### T24 | P0 | 漏洞修補 SLA 與驗證

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | Backend, DevOps |
| **估工** | 0.8 人天 |
| **依賴** | T23 |
| **對應 ISMS** | 70, 71 |
| **完成定義 (DoD)** | 漏洞修補閉環 |

**採取措施：**
- [x] 漏洞修補 SLA（Critical: 24h, High: 7d, Medium: 30d）→ `docs/security/vulnerability-sla.md`
- [x] 修補驗證流程（修 → retest → close）→ `docs/security/vulnerability-sla.md`
- [x] 依賴更新政策（Dependabot）→ `.github/dependabot.yml`

**實作內容（Session 9 + Session 10 + Session 11）：**
- `docs/security/vulnerability-sla.md`:
  - 定義 Critical/High/Medium/Low SLA
  - 閉環流程（detect → triage → mitigate → retest → close）
  - 每筆漏洞 required evidence 欄位
  - 逾期 escalation 規則
- `docs/security/vulnerability-register-template.md`:
  - 漏洞台帳範本（finding id/source/severity/owner/SLA due/fix reference/retest evidence）
- `.github/dependabot.yml`:
  - npm/pip/github-actions 每週自動更新 PR（含 security labels）
- `docs/security/evidence/t24-remediation-drill-2026-02-15-case2.md`:
  - 第二筆閉環演練案例（含 SLA 判定、修補與 retest 證據）
- `docs/security/vulnerability-register-2026-02.md`:
  - 2 筆案例台帳落地（Case 1/Case 2，含 SLA due / retest evidence / close date）

**驗證方式：**
- [x] 修補台帳模板建立
- [x] 首筆修補閉環演練紀錄（`docs/security/evidence/t24-remediation-drill-2026-02-15.md`）
- [x] 第二筆修補閉環演練紀錄（`docs/security/evidence/t24-remediation-drill-2026-02-15-case2.md`）
- [x] 驗證紀錄（Run `22031771983` SAST/DAST/E2E job evidence）
- [x] 漏洞台帳實例（`docs/security/vulnerability-register-2026-02.md`）
- [x] 最新驗證紀錄（Run `22033478586` SAST/DAST/E2E 全綠）

---

### T25 | P0 | 入侵 / 異常監控與通報

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | SOC |
| **協作** | SRE, Security |
| **估工** | 0.8 人天 |
| **依賴** | T23 |
| **對應 ISMS** | 72, 73, 74 |
| **完成定義 (DoD)** | 可偵測並通報 |

**採取措施：**
- [ ] 異常流量偵測（大量 4xx/5xx, 非預期來源）
- [ ] 未授權連線監控
- [ ] 通報 SOP（偵測 → 通知 → 處置 → 復原）
- [ ] 事件分級與應變計畫

**驗證方式：**
- [ ] 告警演練
- [ ] 事件單範例

---

### T26 | P0 | 完整性檢查與伺服器端驗證

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15** |
| **Owner** | Security Eng |
| **協作** | Backend, QA |
| **估工** | 1.0 人天 |
| **依賴** | T23 |
| **對應 ISMS** | 75, 76, 77, 78 |
| **完成定義 (DoD)** | 變更可偵測且可處置 |

**採取措施：**
- [ ] File Integrity Monitoring（FIM）佈署 — 需 infra 層配置
- [x] 伺服器端輸入驗證 — Pydantic schema 全面強化
- [x] SQL Injection 防護（SQLAlchemy ORM 已涵蓋）
- [ ] XSS 防護（API 輸出 encoding）— JSON API 已自動 escape
- [x] 檔案上傳驗證（如適用）— 目前無 multipart 上傳端點，已加契約守門測試

**實作內容（Session 6 — Pydantic schema 強化）：**
- `schemas/admin.py`:
  - UserCreate: `name` (2-100), `username` (3-50, regex `^[a-zA-Z0-9._-]+$`), `email` (regex validated, max 254), `unit` (1-100)
  - UserCreate: `password` (min 12, strength validator), `role` (enum validator)
  - UserUpdate: 同樣 email regex + role validator + password strength
  - ErrorReportCreate: `severity` pattern `^(low|moderate|high)$`, `errorType` (1-100), `description` (1-5000)
  - ErrorReportUpdate: `status` pattern `^(pending|resolved)$`, `resolution` (max 5000)
- `schemas/message.py`:
  - MessageCreate: `content` (1-10000), `messageType` validator (allowed: general, medication-advice, urgent, note)
  - TeamChatCreate: `content` (1-10000)
- `schemas/clinical.py`:
  - All request models: `patient_id` (1-50), `scenario/question` (max 2000), `message` (1-10000)
  - CKDStageRequest: `egfr` (0-200), `age` (0-150)
  - RAGQueryRequest: `question` (1-2000), `top_k` (1-20)
- `main.py` / `test_contract.py`:
  - 新增 CORP/cache-control 安全 header 與契約測試（DAST low finding 對應防護）
- `test_contract.py`:
  - 新增 `test_no_multipart_upload_endpoints_present`（確保 OpenAPI 無 `multipart/form-data` 上傳端點）

**驗證方式：**
- [x] Pydantic schema validation 全面增強 (email regex, username pattern, field length limits)
- [x] 60/60 backend tests pass（無回歸）
- [x] Schema hardening tests 補齊（`backend/tests/test_schemas/test_validation_hardening.py`）
- [x] 安全 header 契約測試補強（`backend/tests/test_api/test_contract.py`）
- [x] 上傳端點防回歸測試（`test_no_multipart_upload_endpoints_present`）
- [ ] FIM 報告（需 infra）
- [ ] 滲測驗證紀錄

---

## Phase I — QA & Compliance

### T27 | P1 | 前端 E2E 測試補齊

| Field | Value |
|-------|-------|
| **Status** | `[~]` **Partially Complete 2026-02-15 (Run `22033478586` critical + extended journeys green；Run `22034008508` critical gate green)** |
| **Owner** | QA Lead |
| **協作** | Frontend, Backend |
| **估工** | 1.2 人天 |
| **依賴** | T02, T04 |
| **對應 ISMS** | 51, 56 |
| **完成定義 (DoD)** | 關鍵旅程自動化 |

**採取措施：**
- [x] E2E 框架選定（Playwright）
- [x] 核心旅程覆蓋：登入 → 病患列表 → 詳情 → AI Chat → 登出
- [x] CI 整合（E2E 作為 deployment gate）
- [x] 測試錄影保留（Playwright video artifact）
- [x] Extended journeys 納入固定排程（schedule + workflow_dispatch 可選執行）
- [x] Release gate policy 文件（required vs optional）已定義
- [x] Branch protection 套用清單（`docs/qa/t27-branch-protection-checklist.md`）

**實作內容（Session 9 + Session 10 + Session 11）：**
- `playwright.config.js`:
  - reporter: list + html + json（輸出到 `output/playwright/`）
  - trace/screenshot/video 設定（CI 下保留錄影）
- `e2e/critical-journey.spec.js`:
  - critical flow: login → patients → patient detail → AI chat → logout
  - 使用真實 UI 操作與路由斷言
- `e2e/t27-extended-journeys.spec.js`:
  - 擴充 journey: login → team chat → logout
  - 擴充 journey: login → patients → detail tab switch
  - 新增回歸案例: login → patient lab → click trendable card → trend dialog opens（防止 `Objects are not valid as a React child` 類型崩潰）
- `.github/workflows/ci.yml`:
  - 新增 `e2e-critical-journey` job（PostgreSQL + Redis + migration + seed + frontend/backend 啟動 + Playwright）
  - 產出 `e2e-playwright-artifacts`（report/video/logs）
  - 新增 `e2e-extended-journeys` job（schedule 例行 + workflow_dispatch 手動開關）
- `docs/qa/t27-release-gate-policy.md`:
  - 定義 release required gate: `e2e-critical-journey`
  - 定義 supporting gate: `e2e-extended-journeys`（schedule/workflow_dispatch）
  - 定義連續失敗升級規則（2 連敗時暫時升級為 blocking）

**驗證方式：**
- [x] 覆蓋清單（critical 1 條 + extended 2 條）
- [x] 測試報告機制（Playwright html/json report）
- [x] 首次 CI E2E 綠燈 run `22031345836`，artifact: `output/playwright` video + html report
- [x] CI E2E 最新綠燈 run `22031771983`（critical journey）
- [x] Extended journeys CI 首次綠燈 run `22033478586`（workflow_dispatch with `run_extended_e2e=true`）
- [x] 最新 push critical gate 綠燈 run `22034008508`（required gate）
- [x] Gate policy 文件（`docs/qa/t27-release-gate-policy.md`）
- [x] Extended journey 新增 lab trend runtime regression case（`e2e/t27-extended-journeys.spec.js`）
- [ ] Branch protection 套用與 PR 截圖證據（待 repo 設定實施）

---

### T28 | P1 | 錯誤最小揭露與嚴重錯誤通知

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Security, SRE |
| **估工** | 0.8 人天 |
| **依賴** | T11, T25 |
| **對應 ISMS** | 53, 55 |
| **完成定義 (DoD)** | 前端不洩漏堆疊 |

**採取措施：**
- [x] Production 錯誤訊息去敏（`DEBUG=false` 時隱藏 stack trace, 僅顯示 "An unexpected error occurred"）
- [x] 錯誤 ID 機制（`errorId` in 500 response + server-side logger.error with traceback）
- [x] 嚴重錯誤主動告警（structured CRITICAL log + optional webhook）

**實作內容：**
- `main.py` 500 handler: 產生 12 位 `error_id`，回傳給前端，server-side 記錄完整 traceback
- 前端可回報 `errorId`，後端可透過 log 查找全文
- **補修 (re-audit 2):** `main.py` 500 handler 新增 `_emit_severe_error_alert()`:
  - Structured CRITICAL log: `{"event": "severe_error", "error_id": ..., "exception": ..., "path": ..., "traceback": ...}`
  - SIEM 可透過 `event=severe_error` 觸發告警規則
  - Optional webhook 支援 via `ALERT_WEBHOOK_URL` env var (Slack / PagerDuty / email gateway)
  - `config.py` 新增 `ALERT_WEBHOOK_URL: str = ""`

**驗證方式：**
- [x] 錯誤頁驗證（production 不顯示 traceback，顯示 errorId）
- [x] CRITICAL log 輸出驗證（JSON structured, SIEM-ready）
- [ ] Webhook 端對端測試（需配置外部 webhook URL）

**補修 (re-audit 3)：**
- `.env.example`: 新增 `ALERT_WEBHOOK_URL=` 欄位（附說明 "Slack/Teams incoming webhook URL"）

---

### T29 | P1 | 委外安全條款補強（如適用）

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | PM / 法務 |
| **協作** | Security, 採購 |
| **估工** | 0.5 人天 |
| **依賴** | T01 |
| **對應 ISMS** | 61 |
| **完成定義 (DoD)** | 契約含安全驗收條款 |

**採取措施：**
- [ ] 委外契約納入安全需求（如適用）
- [ ] 各階段安全驗收標準
- [ ] 責任歸屬明確

**驗證方式：**
- [ ] 契約條款
- [ ] 驗收文件

---

### T30 | P1 | AI 醫療輸出安全護欄

| Field | Value |
|-------|-------|
| **Status** | `[x]` **Completed 2026-02-15** |
| **Owner** | Backend Lead |
| **協作** | Clinical SME, QA |
| **估工** | 1.0 人天 |
| **依賴** | T04, T28 |
| **對應 ISMS** | 52, 53 |
| **完成定義 (DoD)** | 高風險問答可控 |

**採取措施：**
- [x] AI 輸出加入免責聲明 → 所有 LLM 回應自動附加「僅供臨床參考，不可取代醫師專業判斷」
- [x] 來源揭露（RAG 引用來源已在 ai_chat.py 的 citations 中顯示）
- [x] 高警訊藥物劑量偵測 → 偵測 heparin/insulin/warfarin 等 15 種藥物 + 數字劑量 → 警告
- [x] 確定性診斷用語偵測 → 「確定診斷為」等 pattern → 警告
- [x] 醫療專家審閱機制 → `POST /ai/messages/{id}/review` endpoint

**實作內容：**
- `app/services/safety_guardrail.py`: `apply_safety_guardrail()` — 3 層檢查:
  1. 高警訊藥物劑量比對 (15 種 high-alert medications, 中英文)
  2. 確定性診斷用語偵測 (regex patterns)
  3. 標準醫療免責聲明自動附加
- `routers/ai_chat.py`: AI 回覆經過 guardrail 後返回, `safetyWarnings` 欄位通知前端
- `routers/clinical.py`: guideline + decision 回覆經過 guardrail
- `tests/test_services/test_safety_guardrail.py`: 5 項安全護欄測試
- **補修 (re-audit 2):**
  - `safety_guardrail.py`: 輸出新增 `requiresExpertReview` 欄位（flagged 時自動要求專家審閱）
  - `ai_chat.py`: chat response 新增 `requiresExpertReview` 欄位通知前端
  - `ai_chat.py`: 新增 `POST /ai/messages/{message_id}/review` — 僅 doctor/admin 可操作
    - 存儲審閱 metadata (reviewedBy, reviewedAt, status) 至 AIMessage.suggested_actions JSONB
    - 建立 audit log 追蹤合規（action="AI 輸出專家審閱"）

**驗證方式：**
- [x] 情境測試: 5 項通過 (免責聲明、高警訊藥物、確定診斷、安全內容、複合警告)
- [x] Expert review endpoint 實作（doctor/admin RBAC + audit log）
- [ ] 醫療審閱紀錄 E2E 驗證（待前端整合 review UI）

---

### T31 | P2 | 滲透測試與修復閉環

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | Security Eng |
| **協作** | Backend, DevOps |
| **估工** | 1.5 人天 |
| **依賴** | T23, T24, T25 |
| **對應 ISMS** | 57 |
| **完成定義 (DoD)** | 高風險缺失關閉 |

**採取措施：**
- [ ] 執行滲透測試（OWASP Top 10 覆蓋）
- [ ] 缺失分級與修復追蹤
- [ ] 複測驗證

**驗證方式：**
- [ ] PT 報告
- [ ] 複測報告

---

### T32 | P2 | 靜態資料加密深化

| Field | Value |
|-------|-------|
| **Status** | `[ ]` Not Started |
| **Owner** | Security Eng |
| **協作** | DevOps, DBA |
| **估工** | 1.0 人天 |
| **依賴** | T16, T17 |
| **對應 ISMS** | 69 |
| **完成定義 (DoD)** | 敏感資料 at-rest 加密 |

**採取措施：**
- [ ] PostgreSQL TDE 或磁碟加密
- [ ] 敏感欄位加密（如需要：病患姓名、身份證字號）
- [ ] 金鑰分權管理

**驗證方式：**
- [ ] 組態審核
- [ ] 加密驗證報告

---

## Dependency Graph

```
T01 ─┬─→ T02 ─┬─→ T05 ─┬─→ T07 ──→ T08
     │        │        └─→ T10
     │        ├─→ T09
     │        ├─→ T03 ──→ T04 ──→ T27 (P1)
     │        │                  └─→ T30 (P1)
     │        └─→ T11 ─┬─→ T12 ──→ T13
     │                 └─→ T14
     ├─→ T06
     ├─→ T15 ──→ T16
     ├─→ T17 ──→ T18 ──→ T19
     │          └─→ T32 (P2)
     ├─→ T20 ──→ T21
     └─→ T22 ──→ T23 ─┬─→ T24
                       ├─→ T25 ──→ T28 (P1)
                       ├─→ T26
                       └─→ T31 (P2)
T29 (P1) ── depends on T01 only
```

---

## Execution Log

| Date | Task | Action | Result |
|------|------|--------|--------|
| 2026-02-15 | Phase 4 Merge | ChatICU/ AI → backend/ merge completed | 39/39 tests pass |
| 2026-02-15 | T01 | 封存 ChatICU/, 建立架構圖 + 59 endpoint 路由清單, 驗證 Docker Compose | Done |
| 2026-02-15 | T02 | 統一 response envelope, 全域異常處理, OpenAPI 匯出, 契約測試 7 項 | Done (46/46 tests) |
| 2026-02-15 | T05 | JWT 加入 iat/jti claims, logout 撤銷 refresh token, refresh 黑名單檢查 | Done |
| 2026-02-15 | T06 | 移除硬編密鑰 (config/alembic/docker-compose), 建立 .gitignore + .env.example | Done |
| 2026-02-15 | T07 | 密碼強度驗證 (12 字元+大小寫+數字+特殊), Pydantic validator | Done |
| 2026-02-15 | T08 | Redis 帳號鎖定 (5 失敗→15min lockout), 嘗試計數, 審計日誌 | Done |
| 2026-02-15 | T09 | RBAC 審計 16 routers, 修正 4 處缺口 (pharmacy/patients/clinical/ventilator) | Done |
| 2026-02-15 | T10 | 閒置逾時 30min (Redis last_activity tracking), token 壽命 15min/1day | Done (46/46 tests) |
| 2026-02-15 | Re-audit | 獨立審計發現 T05/T06/T11/T28 缺口 | 15 🟡 / 15 ⬜ / 1 ⚪ |
| 2026-02-15 | T05 補修 | Refresh token rotation: 新 refreshToken + 舊 token blacklist | Done |
| 2026-02-15 | T06 補修 | 移除 datamock 明文密碼、.mcp.json 硬編帳密、config.py DB 預設密碼 | Done |
| 2026-02-15 | T11 補修 | 審計日誌擴展: auth logout, admin CRUD, patients CRUD, meds, pharmacy, AI chat, RAG | Done |
| 2026-02-15 | T28 先修 | 500 回應加入 errorId + server-side traceback 記錄 | Done (46/46 tests) |
| 2026-02-15 | T17 | 手動撰寫 2 份 Alembic migration: 001 (15 tables) + 002 (password_history) | Done |
| 2026-02-15 | T07 完整 | 密碼效期 90 天 + 歷史 5 次: PasswordHistory model, change-password endpoint, login expiry check | Done |
| 2026-02-15 | T08 完整 | 密碼重設 token: reset-password-request + reset-password (Redis one-time, 30min TTL) | Done |
| 2026-02-15 | T30 | 醫療安全護欄: safety_guardrail.py, 免責聲明 + 高警訊藥物偵測 + 確定診斷攔截 | Done |
| 2026-02-15 | Seeds fix | seed_data.py: 修正 users.json 結構解析、移除明文密碼引用、Python 3.9 相容性 | Done |
| 2026-02-15 | Tests | 新增 14 項測試 (password_policy 9 + safety_guardrail 5) | 60/60 tests pass |
| 2026-02-15 | Re-audit 2 | 29 findings 全面複查，修正 13 項 code-addressable issues | See below |
| 2026-02-15 | T02 補修 | API_CONTRACT.md 新增 3 auth endpoints + JWT iat/jti + Token Flow 8 步驟 | Done |
| 2026-02-15 | T03 完成 | 移除 7 個前端頁面 mock fallback → API calls + loading/error states | Done |
| 2026-02-15 | T04 部分 | 修正 streaming endpoint, 移除 admin/pharmacy mock stats → real DB queries | Partial |
| 2026-02-15 | T05 補修 | Frontend logout 補發 refreshToken body | Done |
| 2026-02-15 | T06 補修 | seed_data.py 密碼改讀 SEED_DEFAULT_PASSWORD env var | Done |
| 2026-02-15 | T08 補修 | 移除 reset-password-request response 中的 resetToken 欄位 | Done |
| 2026-02-15 | T09 補修 | patients.py list/get: 新增 role-based data filtering (admin/doctor/nurse/pharmacist) | Done |
| 2026-02-15 | T11 補修 | 新增 3 router audit logging + structured JSON logging + sensitive field masking | Done |
| 2026-02-15 | T28 完成 | Severe error alerting: CRITICAL structured log + optional webhook (ALERT_WEBHOOK_URL) | Done |
| 2026-02-15 | T30 補修 | Expert review: POST /ai/messages/{id}/review + requiresExpertReview field | Done |
| 2026-02-15 | Tests | 全部 60/60 tests pass，無回歸 | 60/60 pass |
| 2026-02-15 | Re-audit 3 | 27 findings 複查，修正 8 項 code-addressable issues | See below |
| 2026-02-15 | T02 補修 | openapi.json 完整重新生成: 50 paths, 61 methods (新增 5 遺漏端點, 移除 2 過時端點, 新增 2 藥局端點) | Done |
| 2026-02-15 | T03 補修 | 移除額外 6 檔案 mock data: lab-data-display, statistics, interactions, compatibility, dosage, medical-records | Done (13 total) |
| 2026-02-15 | T04 補修 | 前後端契約對齊 6 處: admin User.status→active, pharmacy ErrorReport.drug→medicationName, vectors URL 修正 | Done |
| 2026-02-15 | T06 補修 | seed_data.py 移除明文密碼 fallback → sys.exit(1); .env.example 新增 SEED_DEFAULT_PASSWORD | Done |
| 2026-02-15 | T09 驗證 | patients.py 資料層過濾已正確實作 (lines 74-87), 無需修改 | Verified |
| 2026-02-15 | T11 補修 | messages.py 新增 create_message + mark_message_read 審計; lab_data.py 新增 correct_lab_data 審計 (12 categories) | Done |
| 2026-02-15 | T28 補修 | .env.example 新增 ALERT_WEBHOOK_URL 欄位 | Done |
| 2026-02-15 | T30 補修 | review endpoint 已納入 openapi.json (via T02 重新生成) | Done |
| 2026-02-15 | Pharmacy | 新增 2 後端端點: GET /pharmacy/drug-interactions + GET /pharmacy/iv-compatibility | Done |
| 2026-02-15 | Tests | Re-audit 3 修正後全部 60/60 tests pass，無回歸 | 60/60 pass |
| 2026-02-15 | Re-audit 4 | 驗證 Round 3 修正皆已持久化，3 項新 code-addressable issues | See below |
| 2026-02-15 | T04 補修 | patient-detail.tsx 趨勢圖改用 labDataApi.getLabTrends() API + labCategoryMap 對照 | Done |
| 2026-02-15 | T15 部分 | HSTS middleware (main.py) + CORS production 設定說明 (.env.example) | Partial |
| 2026-02-15 | T20 部分 | Dockerfile 移除 --reload; docker-compose 移除 source code bind mounts | Partial |
| 2026-02-15 | Tests | Re-audit 4 修正後全部 60/60 tests pass，無回歸 | 60/60 pass |
| 2026-02-15 | T14 部分 | 程式碼 UTC 合規性 100% 驗證: 零 utcnow(), 所有 datetime.now() 使用 timezone.utc | Verified |
| 2026-02-15 | T21 部分 | CHANGELOG.md v1.0.0 (Keep a Changelog 格式): Added/Security/Infrastructure/Frontend | Done |
| 2026-02-15 | T22 部分 | .github/workflows/ci.yml: 4 jobs (test+lint+security-scan+docker-build), Python 3.12+Redis | Done |
| 2026-02-15 | T23 部分 | pyproject.toml: Bandit SAST config (exclude tests/seeds, skip B101, severity medium) + flake8 + pytest | Done |
| 2026-02-15 | T26 部分 | Pydantic schema 全面強化: admin.py (email regex, username pattern, field limits), message.py, clinical.py | Done |
| 2026-02-15 | T04 驗證 | 團隊聊天 chat.tsx 已完全使用後端 API (teamChatApi), 無 mock data | Verified |
| 2026-02-15 | Tests | Session 6 全部修正後 60/60 tests pass，無回歸 | 60/60 pass |
| 2026-02-15 | Re-audit 5 | 識別 6 項前後端契約落差 + LabDataDisplay 趨勢圖 placeholder | See below |
| 2026-02-15 | T04 補修 | lab-data-display.tsx 趨勢圖從空 placeholder → 真實 API (getLabTrends, 40+ onClick 修正) | Done |
| 2026-02-15 | T04 補修 | admin.ts createUser/updateUser return type 修正: {message, user} → flat User | Done |
| 2026-02-15 | T04 補修 | users.tsx result.user.username → result.username (避免 runtime crash) | Done |
| 2026-02-15 | T04 補修 | pharmacy.ts ErrorReportsResponse 移除 pagination + stats optional; UpdateErrorReportData 對齊 | Done |
| 2026-02-15 | T04 補修 | lab-data.ts LabTrendsResponse 修正為 {trends: LabData[], days} 對齊後端 | Done |
| 2026-02-15 | Tests | Re-audit 5 修正後全部 60/60 tests pass，無回歸 | 60/60 pass |
| 2026-02-15 | Re-audit 5 補充 | 3 項殘餘 mock 清理: advice-statistics mock import, patients.tsx mockPatients 類型, .env.example USE_MOCK | See below |
| 2026-02-15 | T03 補修 | advice-statistics.tsx 移除 mock-data import → getAdviceRecords() API + inline ADVICE_CATEGORIES + loading/error | Done |
| 2026-02-15 | T03 補修 | patients.tsx typeof mockPatients[0] → PatientWithFrontendFields 類型修正 | Done |
| 2026-02-15 | T03 補修 | .env.example VITE_USE_MOCK=true → false | Done |
| 2026-02-15 | T04 補修 | pharmacy.ts 新增 PharmacyAdviceRecord interface + getAdviceRecords() API function | Done |
| 2026-02-15 | Tests | 補充修正後全部 60/60 tests pass，grep mock-data src/ → 0 matches | 60/60 pass |
| 2026-02-15 | **W1 Start** | 開始 W1 排程執行 | — |
| 2026-02-15 | T04 W1 | PharmacyAdvice model + migration 003 + GET/POST /pharmacy/advice-records + 8 tests | Done (68/68 pass) |
| 2026-02-15 | T04 W1 | 前後端契約驗證: PharmacyAdviceRecord 11 欄位 100% 對齊 | Verified |
| 2026-02-15 | T22 W1 | requirements.lock 生成 (pip-compile --generate-hashes, 1686 行) | Done |
| 2026-02-15 | T22 W1 | Dockerfile multi-stage: builder(gcc) → runtime(slim, non-root chaticu, HEALTHCHECK) | Done |
| 2026-02-15 | T22 W1 | CI workflow 改用 requirements.lock + image size 驗證步驟 | Done |
| 2026-02-15 | conftest | override_get_db 加入 commit (修復跨 request 資料可見性) | Done |
| 2026-02-15 | Tests | W1 全部修正後 68/68 tests pass，無回歸 | 68/68 pass |
| 2026-02-15 | T27 部分 | Playwright config + critical journey spec + CI e2e job + report/video artifacts | Partial |
| 2026-02-15 | T23 部分 | CI 新增 DAST (OWASP ZAP baseline) + High-risk gate + artifact upload | Partial |
| 2026-02-15 | T22 部分 | CI 擴充為 9 jobs + reproducibility-report artifact job + weekly schedule/workflow_dispatch | Partial |
| 2026-02-15 | T24 部分 | 建立 vulnerability SLA、register template、Dependabot policy (npm/pip/actions) | Partial |
| 2026-02-15 | T27 續作 | 觸發 workflow_dispatch(`run_extended_e2e=true`) 成功，Run `22033478586` extended journeys 綠燈 | Verified |
| 2026-02-15 | T23 續作 | 下載並核對 Run `22033478586` DAST artifact：High=0, Medium=0, Gate=PASS | Verified |
| 2026-02-15 | T22 續作 | 本地重建演練（versions/hash/npm ci+build/PostgreSQL migration+seed）報告落地 | Verified |
| 2026-02-15 | T24 續作 | 漏洞台帳實例 `docs/security/vulnerability-register-2026-02.md` 建立（2 cases） | Done |
| 2026-02-15 | T23 續作 | 修補 DAST low 風險 header：CORP + Cache-Control/Pragma/Expires | Done |
| 2026-02-15 | T26 續作 | 補強安全 header 契約測試，`test_contract + schema` 共 14 passed | Verified |
| 2026-02-15 | T23 驗證 | 修補後 CI Run `22033663309`：DAST `High=0, Medium=0, Low=0`，僅 Informational | Verified |
| 2026-02-15 | T26 續作 | 新增無上傳端點守門測試 `test_no_multipart_upload_endpoints_present`，共 15 passed | Verified |
| 2026-02-15 | T21 續作 | 新增 CR 與 rollback drill 紀錄（`CR-2026-02-15-001`, `RB-2026-02-15-001`）並回填追蹤欄位 | Verified |
| 2026-02-15 | T21 續作 | 建立並推送 release tag `v1.0.0`（對應 commit `7d0aeee`） | Done |
| 2026-02-15 | T04 續作 | 修正 `lab-data-display.tsx` 物件值容錯渲染（避免 React child object crash），`npm run build` 通過 | Done |
| 2026-02-15 | CI 驗證 | Push Run `22033862853` 全綠（critical E2E + DAST + docker-build success） | Verified |
| 2026-02-15 | T04/T27 續作 | 新增 T04 UAT 草案報告 + T27 lab trend runtime regression E2E 測項（`playwright --list` 驗證） | Done |
| 2026-02-15 | CI 驗證 | Push Run `22033938836` 全綠（critical E2E + DAST + docker-build success） | Verified |
| 2026-02-15 | T27 續作 | 新增 branch protection 套用清單（required/optional checks + 證據清單） | Done |
| 2026-02-15 | CI 驗證 | Push Run `22034008508` 全綠（critical E2E + DAST + docker-build success） | Verified |

---

## Estimated Total Effort

| Priority | Tasks | Person-Days |
|----------|-------|-------------|
| P0 | 26 | 24.5 |
| P1 | 4 | 3.5 |
| P2 | 2 | 2.5 |
| **Total** | **32** | **30.5** |

> **Note:** 人天估工以單人計。可並行的任務（無依賴衝突）可縮短總時程。
> Critical path: T01 → T02 → T05 → T07 → T08（約 4 天）

---

## W0-W6 Deployment Schedule

### W0 基線（已完成，凍結）

T01, T02, T03, T05, T06, T07, T08, T09, T10, T11, T17, T28, T30

### W1-W6 排程

| 週次 | 任務 | Owner | 交付物 | 驗收點 |
|------|------|-------|--------|--------|
| W1 | T04 | Backend Lead + Frontend Lead + QA | 補齊 /pharmacy/advice-records 後端端點、前端串接、API 契約更新、UAT 腳本 | 核心流程 100% 走真 API；UAT 腳本可執行；無 mock 依賴 |
| W1 | T22（啟動） | DevOps + Backend Lead | CI 改造計畫、鎖版策略、Docker 多階段草案 | CI pipeline 設計評審通過 |
| W1 | T29（並行啟動） | PM/法務 + Security | 委外安全條款草案 | 條款草案完成並進入審閱 |
| W2 | T22（完成） | DevOps | requirements.lock、Docker multi-stage、CI 3-run 計畫 | 至少 1 次完整 CI 綠燈、可重現 build 成功 |
| W2 | T23 | Security Eng + DevOps | DAST（ZAP）接入、掃描產物上傳、阻擋規則 | SAST+DAST 同時可跑；有首份報告 artifact |
| W2 | T27（啟動） | QA Lead + Frontend Lead | Playwright 測試骨架、核心旅程 case 清單 | 測試可在 CI 觸發，至少 1 條旅程通過 |
| W3 | T27（完成） | QA Lead | 登入→病患→詳情→AI Chat→登出 全旅程 E2E | E2E 報告與錄影產出，作為 deployment gate |
| W3 | T15 | Security Eng + DevOps | 反向代理 TLS1.2+ 設定、內網 TLS（Redis/DB）方案 | TLS 掃描通過（禁 TLS1.0/1.1）；HSTS/CORS 驗證通過 |
| W3 | T14 | SRE/Platform | NTP/chrony 設定、時鐘偏移監控規則 | 節點偏移在門檻內，監控面板可追蹤 |
| W4 | T20 | DevOps | dev/stg/prod 分離、環境權限/DB 隔離 | 三環境清單與存取控制驗證完成 |
| W4 | T21 | PM/Release + DevOps | tag 流程、CR 流程、發版審批、rollback SOP | 完成一次發版演練與一次回滾演練紀錄 |
| W4 | T16 | Security Eng + DevOps | 金鑰/憑證輪替計畫、憑證自動更新、KMS/Vault 規範 | 輪替演練完成且有稽核證據 |
| W5 | T26 | Security Eng + Backend | FIM 佈署、XSS 驗證、上傳驗證策略 | FIM 可告警；安全測試證據可追溯 |
| W5 | T12 | SRE + Security | 日誌留存>=6月、完整性機制、異地備份 | 留存策略與完整性驗證報告完成 |
| W5 | T13 | SOC + SRE | 日誌審查排程、失效告警、異常告警 | 告警演練完成；審查紀錄可查 |
| W5 | T24 | Security Eng | 漏洞修補 SLA、修補閉環流程 | SLA 生效，至少 1 筆修補閉環案例 |
| W5 | T25 | SOC | 事件分級、通報 SOP、偵測規則 | 一次 IR 演練完成並出具報告 |
| W6 | T18 | DBA + SRE | 備份/還原機制、RPO 文件與演練報告 | 還原成功且達 RPO 目標 |
| W6 | T19 | SRE + DBA | 故障切換 SOP、RTO 演練 | 切換成功且達 RTO 目標 |
| W6 | T31 | Security Eng + Backend + DevOps | 滲透測試、修補台帳、複測報告 | Critical/High 風險關閉或有核准風險接受 |
| W6 | T32 | Security Eng + DBA + DevOps | at-rest 加密（DB/磁碟/欄位）與金鑰分權 | 加密驗證報告與組態審核完成 |
| W6 | T29（完成） | PM/法務 | 正式契約條款與驗收文件 | 委外安全條款簽署完成 |

### 每週出關（Go/No-Go）

1. **W1 出關：** T04 API 閉環可跑、UAT 腳本完成。
2. **W2 出關：** CI + DAST 有可用報告。
3. **W3 出關：** E2E 成為 gate，TLS/NTP 上線。
4. **W4 出關：** 環境隔離與發版治理完成。
5. **W5 出關：** 監控/日誌/SLA/IR 閉環完成。
6. **W6 出關：** RPO/RTO/PT/加密完成，具正式上線證據。
