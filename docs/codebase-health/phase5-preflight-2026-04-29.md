# Phase 5 Preflight — Vercel `/api/*` Namespace + Router 整合

- **日期**：2026-04-29
- **目的**：把 Phase 5（高風險長期）的真實工作量、blast radius、是否值得做盤點清楚，**不改任何 code**
- **本檔不改任何代碼**
- **方法**：直接讀 codebase 統計（vercel.json / vite.config.ts / 33 個 router / 24 個 lib/api / SPA route）

---

## 1. Phase 5 要解決的問題（重述）

`/patients` 同時是：
- **前端 SPA 路由**：`<Route path="/patients">` 由 React Router 接管，回 HTML
- **後端 API endpoint**：`GET /patients` 回 JSON

兩者用同一個 URL prefix。Vercel 用一個 header gate（`x-request-id`）區分：
- 帶 header → 轉到 Railway（API path）
- 不帶 header → fall through 到 SPA index.html

風險點：
1. **監控誤判**：用 curl 測 `/patients` 不帶 header 會拿到 HTML，誤以為 API 壞了
2. **Vercel rewrite 暗藏**：rewrite 規則 18 條，header gate 4 path × 2 rules = 8 條條件式
3. **新人易踩**：寫新 endpoint 想加 `/admin/foo`，可能跟 `<Route path="/admin/audit">` 共存或衝突，要懂 header trick
4. **未來 Vercel 政策變動**：Vercel 改了 rewrite header gate 行為（不太可能但不是零），prod 直接掛

收益點：
- 一條清楚規則：`/api/*` → Railway API，其他 → SPA
- 移除 8 條 header-gated rewrite
- 監控 / curl / 第三方工具不用搞懂 header trick
- **沒有 user-facing 收益**（純整潔）

---

## 2. 後端 33 個 router 的 prefix 現況

按 prefix 分類盤點：

### 2.1 已 `/api/v1` prefix（2 個，namespace 已正確）
| Router | Prefix |
|---|---|
| `clinical.py` | `/api/v1/clinical` |
| `rules.py` | `/api/v1/rules` |

→ **0 動作**。已合規。

### 2.2 Top-level 非衝突（7 個，無 SPA 路由衝突）
| Router | Prefix | Vercel rewrite |
|---|---|---|
| `auth.py` | `/auth` | `/auth/:path*` |
| `ai_chat.py` | `/ai` | `/ai/:path*` |
| `health.py` | （無）`/health` | `/health` + `/health/:path*` |
| `notifications.py` | `/notifications` | `/notifications/:path*` |
| `sync_status.py` | `/sync` | `/sync/:path*` |
| `team_chat.py` | `/team/chat` + `/team/users` | `/team/:path*` |
| `record_templates.py` | `/record-templates` | `/record-templates` + `/record-templates/:path*` |

→ **可改 `/api/{auth,ai,health,...}` namespace**，但都不衝突 SPA，純整潔，blast radius 中（前端 callsite 全改）。

### 2.3 Patient sub-resource（10 個，掛在 `/patients/{patient_id}/...`）
| Router | Prefix |
|---|---|
| `patients.py` | `/patients` |
| `medications.py` | `/patients/{patient_id}/medications` |
| `lab_data.py` | `/patients/{patient_id}/lab-data` |
| `vital_signs.py` | `/patients/{patient_id}/vital-signs` |
| `ventilator.py` | `/patients/{patient_id}/ventilator` |
| `messages.py` | `/patients/{patient_id}/messages` |
| `scores.py` | `/patients/{patient_id}/scores` |
| `diagnostic_reports.py` | `/patients/{patient_id}/diagnostic-reports` |
| `message_activity.py` | `/patients/messages` |
| `fhir_export.py` | `/patients`（**與 patients.py 重疊**，靠 endpoint path 區分） |

→ **與 SPA 路由 `/patients` 直接衝突**。所有這些都靠 `x-request-id` header gate 區分。Phase 5 主戰場。

### 2.4 Top-level 衝突（4 個，靠 header gate）
| Router | Prefix | SPA 衝突路徑 |
|---|---|---|
| `dashboard.py` | `/dashboard` | `/dashboard` |
| `admin.py` | `/admin` | `/admin/{audit,users,statistics}` |
| `admin_his_sync.py` | `/admin` | 同上（與 admin.py 共用 prefix） |
| `pharmacy.py` | `/pharmacy` | `/pharmacy/{workstation,interactions,...}` 共 9 條 |

→ Phase 5 第二戰場。`pharmacy.py` 內部 compose 7 個 sub-router（`pharmacy_routes/*.py`）。

### 2.5 無 prefix 路由（3 個，靠 endpoint path）
| Router | 備註 |
|---|---|
| `discharge_check.py` | `tags=["medications"]`，無 prefix |
| `medication_duplicates.py` | 兩個 router；`pharmacy_summary_router` 也無 prefix |
| `symptom_records.py` | 看起來無 prefix（細節未深入） |

→ **必須個別審視**，未來 namespace 統一時要決定它們落到哪個 prefix。

### 2.6 已退役（1 個，本日已刪）
- ~~`patients_v2.py`~~ → Phase 2.1 已刪除（commit `bf7e75c12`）

---

## 3. Vercel rewrite 現況

`vercel.json` 共 **18 條 rewrite rules**：

### 3.1 乾淨 rewrite（10 條，無 header gate）
```
/auth/:path*    → Railway/auth/:path*
/ai/:path*      → Railway/ai/:path*
/api/:path*     → Railway/api/:path*
/health         → Railway/health
/health/:path*  → Railway/health/:path*
/team/:path*    → Railway/team/:path*
/record-templates       → Railway同
/record-templates/:path*→ Railway同
/sync/:path*    → Railway/sync/:path*
/notifications/:path*   → Railway同
```

### 3.2 Header-gated rewrite（8 條，需 `x-request-id`）
```
/patients       (with header) → Railway/patients
/patients/:path*(with header) → Railway/patients/:path*
/dashboard      (with header) → Railway/dashboard
/dashboard/:path*(with header)→ Railway/dashboard/:path*
/admin          (with header) → Railway/admin
/admin/:path*   (with header) → Railway/admin/:path*
/pharmacy       (with header) → Railway/pharmacy
/pharmacy/:path*(with header) → Railway/pharmacy/:path*
```
**8 條都依賴 `x-request-id` header**。沒帶 header 就 fall through 到 SPA。

### 3.3 SPA fallback（1 條）
```
/(.*)  → /index.html
```

---

## 4. X-Request-ID header 使用點

### 4.1 前端注入（5 處）
| 檔案 | Line | 用途 |
|---|---|---|
| `src/lib/api-client.ts` | 196 | 每個 axios request 的 interceptor 自動加 |
| `src/lib/api-client.ts` | 250 | refresh token path 手動加 |
| `src/lib/api/ai.ts` | 280 | streaming `/ai/chat/stream` |
| `src/lib/api/ai.ts` | 479 | streaming clinical |
| `src/lib/api/ai.ts` | 651 | streaming `/api/v1/clinical/polish/stream` |

### 4.2 後端讀取（4 處）
| 檔案 | Line | 用途 |
|---|---|---|
| `backend/app/main.py` | 176 | request ID middleware：讀或生成 |
| `backend/app/main.py` | 215 | 響應 header 回傳 |
| `backend/app/main.py` | 224 | 內部錯誤 trace 取 ID |
| `backend/app/main.py` | 247 | 錯誤響應 header |

→ **header 同時是 trace ID + Vercel rewrite gate**。如果 Phase 5 移除 rewrite gate，後端 trace ID 邏輯可保留（純內部用）。

---

## 5. SPA 路由（20 條）

`src/App.tsx` 路由：
```
/login, /change-password,
/dashboard,
/patients, /patients/discharged, /patient/:id,
/chat, /ai-chat,
/admin/audit, /admin/users, /admin/statistics,
/pharmacy/workstation, /pharmacy/interactions, /pharmacy/duplicates,
  /pharmacy/compatibility, /pharmacy/dosage, /pharmacy/advice-statistics,
  /pharmacy/drug-library, /pharmacy/drug-library/proposals,
  /pharmacy/drug-library/:name
```

衝突 prefix：`/dashboard` `/patients` `/admin` `/pharmacy`（4 條）。

---

## 6. 前端 API client 現況

- **單一 entry**：`src/lib/api-client.ts`，axios instance + interceptor
- **baseURL**：`API_BASE_URL = import.meta.env.VITE_API_URL || ''`
- **Vercel build**：`buildCommand: "VITE_API_URL= npm run build"` 強制空字串 → 走 Vercel proxy
- **lib/api/ 共 24 個檔**：所有對外 API 呼叫透過 axios 客戶端，path 都以 `/auth/...`、`/patients/...`、`/dashboard/...` 等開頭

→ Phase 5 改 baseURL `/api` 一行，**所有 callsite 不改**（前綴自動加上）。但前提是後端 router prefix 也都加 `/api`。

---

## 7. Vite dev proxy（dev-only）

`vite.config.ts:90-125` 共 12 條 proxy：
- 9 條無 conflict：`/auth`、`/ai`、`/api`、`/health`、`/team`、`/docs`、`/openapi.json`、~~`/v2`~~
- 4 條 conflict（`/patients`、`/dashboard`、`/admin`、`/pharmacy`）：用 `bypass()` 看 `Accept: text/html` 區分

→ **發現一個漏網**：`vite.config.ts:99` 仍有 `'/v2': 'http://127.0.0.1:8000'`，但 Phase 2.1 已刪 v2 router → **dev-only、零 prod 影響的死 code，可獨立 cleanup**。

---

## 8. Phase 5 兩種收斂策略

### 策略 A：完整重構（Big Bang）
所有 router prefix 加 `/api`，前端 baseURL 改 `/api`，刪所有 header-gated rewrite。

**Pros**：
- 一次到位，namespace 乾淨
- Vercel rewrite 從 18 條 → 1-2 條

**Cons**：
- 33 個 router 全改 prefix（包含內部互相 reference 的 namespace）
- 24 個 frontend lib/api 雖然透過 axios baseURL，但 hardcoded path 仍可能有 `/auth/login` 等不能加 prefix 的（需逐個 review）
- 整個 OpenAPI 重生成
- 部署同時改前後端，rollback 痛
- 1-2 個月舊路徑相容期不可少
- 高風險

### 策略 B：分段（漸進）
**Phase 5a**：後端 router 加 `/api` prefix，**保留**舊路徑用 alias（FastAPI router 註冊兩次）
**Phase 5b**：前端 baseURL 改 `/api`，prod 觀察 1-2 週
**Phase 5c**：刪後端舊路徑 alias、刪 Vercel rewrite 中的 header-gated 規則
**Phase 5d**：清 vite.config.ts dev proxy、刪 X-Request-ID 注入（保留作 trace 用）

**Pros**：
- 每階段可獨立 rollback
- 各階段 prod 可觀察
- 風險分散

**Cons**：
- 工時加倍（路徑雙寫期間 OpenAPI / 測試 / docs 都要兼顧）
- 中間態混亂（同時兩條 path 都能 work）

---

## 9. 風險矩陣

| 風險 | 概率 | 影響 | 緩解 |
|---|---|---|---|
| `/api` prefix 造成原本 hardcoded path 的 frontend 死掉 | 中 | 中 | grep 全 callsite + smoke test 全頁 |
| Vercel rewrite 改完後某條 path 沒 catch 到 | 中 | 高（白屏 / 401 / 502） | staging 先驗 / 1-2 月 alias |
| 前端 streaming endpoint（ai/chat/stream）特殊處理 | 高 | 中 | 三個 streaming path 個別 review |
| OpenAPI 重生成造成 types.generated.ts 大改 | 高 | 低 | 預期內 |
| 第三方 webhook / monitor 配置在舊 path | 低 | 高 | 1-2 月 alias 內聯絡 stakeholders |
| 後端 router 內部互相 include（pharmacy 7 個 sub）的 prefix 計算錯 | 中 | 中 | 跑 OpenAPI dump 對照前後 |
| dev 環境 vite proxy 沒同步改 | 高 | 低（只影響本機） | 同 PR 改完 |

---

## 10. 實際真要做時的 Step 拆解（建議走策略 B）

### Step 5a — 後端 router prefix alias（半天）
1. 寫 `app/main.py` helper：每個 router 同時註冊 `prefix=/foo` 和 `prefix=/api/foo` 兩次
2. 跑 OpenAPI dump，對照 path 翻倍
3. 跑既有 backend tests，全綠
4. push prod，curl `/api/auth/login` 與 `/auth/login` 都應該 work
5. **`/api/v1/clinical`、`/api/v1/rules` 不動**（已合規）

### Step 5b — 前端 baseURL 改 `/api`（半天）
1. `src/lib/api-client.ts` baseURL 從 `''` → `'/api'`
2. **三個 streaming endpoint 手動 review**（`ai.ts:273/472/644`，這些用 `${API_BASE_URL}/ai/chat/stream` 等格式，會自動繼承）
3. 加 Vercel rewrite：`/api/:path* → Railway/api/:path*`（已存在，不用加）
4. tsc + build + Playwright smoke 全頁
5. push prod，觀察 24h

### Step 5c — Cleanup（1 天）
**前提**：5b 上線觀察 1 週無 regression
1. 後端 router 移除舊 prefix alias，只留 `/api/foo`
2. Vercel rewrite 刪 8 條 header-gated 規則 + 10 條無 conflict 規則 → 只留 `/api/:path*` + `/health` + SPA fallback
3. 前端 streaming `/ai/chat/stream` 等改成 `/api/ai/chat/stream`
4. dev `vite.config.ts` 移除 4 條 conflict bypass、保留 `/api` 一條
5. 移除 X-Request-ID 注入的 4 處（保留 backend trace ID 邏輯）
6. push prod，觀察 1 週

### Step 5d — Phase 5.2 Router 整合（1 天）
（看實際維護需求才動）
- `admin.py` + `admin_his_sync.py` 評估合併
- `medication_duplicates.py` 兩個 router 是否合併
- `pharmacy.py` 與 `pharmacy_routes/*.py` 結構檢視

---

## 11. 工時與決策建議

### 真要動的工時（策略 B）
| Step | 工時 |
|---|---|
| 5a alias 雙寫 | 半天 |
| 5a 後端測試 + push | 半天 |
| 5b 前端 baseURL + Playwright smoke | 半天 |
| 5b push + 24h 觀察 | — |
| 5c cleanup（後端 + Vercel + dev proxy + header 注入） | 1 天 |
| 5c 觀察期 1 週 | — |
| 5d router 整合（可選） | 1 天 |
| **總計** | **3.5 天 + 觀察期** |

### 不做的價值
- prod 已穩定（Phase 3 + 4 收完）
- 無 user-facing 收益
- 監控誤判風險目前不存在（沒人在用 curl 監控 `/patients` 沒帶 header）
- header gate 對使用者透明
- **dormant 不算問題**

### 建議
**保持 dormant**。只在以下事件出現時開：
1. Vercel 改了 rewrite header gate 政策
2. 第三方監控/工具撞到 namespace 混淆
3. 新人不只一次寫錯 prefix
4. 加新 SPA route 撞到 backend prefix

---

## 12. 順手可獨立做的小清理（與 Phase 5 解耦）

| 項目 | 動作 | 工時 |
|---|---|---|
| `vite.config.ts:99` `/v2` proxy 殘留 | 刪一行（dev-only） | 5 min |
| `medication_duplicates.py` 兩個 router 命名 | 純 review，看是否合併 | 30 min |

---

## 13. 結論

**Phase 5 不必開**——除非上述 4 種觸發事件出現。

**現況勉強合用**：
- Header gate 看起來醜，但完全 work
- 33 個 router、18 條 rewrite、X-Request-ID 同時當 trace + gate，是歷史演進結果
- 真要動的工時不多（~3.5 天），但收益純整潔

**這份 preflight 的價值**：未來真撞到痛點時，**不用再花半天重新盤點**——直接看這份照 Step 5a/b/c 走。

---

## 附錄 A：Phase 5 開工前 checklist

未來真要動，**先確認**：
- [ ] Phase 5 觸發事件已具體出現（不是「想做就做」）
- [ ] 1-2 月 alias 期可以接受（不能急）
- [ ] 有 staging 環境或 prod canary 機制（建議先做這個）
- [ ] X-Request-ID 注入點全部 grep 確認（目前 5 處）
- [ ] OpenAPI client generation 流程清楚（避免 types.generated.ts 大改後 review 不完）
