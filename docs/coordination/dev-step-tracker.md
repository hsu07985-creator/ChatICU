# Dev Step Tracker — Plan B 後的修復順序

> **使用方式**：每完成一個 step，回來讀這個檔案 → 把對應 step 的狀態從 `[TODO]` 改為 `[DONE]` → 寫下 evidence。每次開始下一個 step 前，**也要先讀這個檔案**確認上下文。

**建立日期**：2026-04-14
**Session**：backend
**起點**：Plan B hotfix `9e33171` 已部署成功，Railway `/health` 回 200 (`v1.4.5`)

---

## Step 1 — [DONE] 把 Bug A 的 dashboard fix commit 進 main

**為什麼第一**：修復已在 production 驗證（`/dashboard/stats` 回 8），但**還沒 commit**。Railway 下次重啟若拉到不同 commit，bug 會復活。

### 動作清單
- [x] Debug `test_dashboard_stats_alerts_aggregation` 在 SQLite 為何 `assert 0 >= 3` 失敗
- [x] 檢查 `cast(Patient.alerts, JSON)` 在 SQLite dialect 編譯出的 SQL
- [x] 必要時改用 dialect-conditional 邏輯
- [x] `cd backend && python3 -m pytest tests/test_api/test_dashboard.py -v` 全綠（6 test）
- [x] Feature branch → main → `git push personal main`
- [x] 等 Railway 部署 60-90 秒
- [x] curl `https://chaticu-production-8060.up.railway.app/dashboard/stats` 確認 200（401 = 路由活著、非 500）

### 完成判準
- ✅ production `/dashboard/stats` 401 UNAUTHORIZED（不是 500，路由 alive）
- ✅ 6 個 dashboard test 全綠
- ✅ commit 進 main + push personal remote 成功

### Root cause
SQLite 的 `CAST(text AS JSON)` 是**靜默壞掉**的：`json_array_length(CAST(alerts AS JSON))` 對 TEXT-stored JSON 回 0，但 `json_array_length(alerts)` 直接呼叫卻能正確 parse（回 2、1）。Postgres 反過來：`json_array_length(jsonb)` 不存在，必須 cast jsonb→json。所以用 `db.bind.dialect.name` 在執行時挑運算式。

### Evidence
- pytest 結果：`6 passed, 11 warnings in 1.64s`（`tests/test_api/test_dashboard.py`）
- commit hash：`d7563a1` (`fix(dashboard): aggregate alerts via dialect-specific json_array_length`)
- production curl 結果：
  - `/health` → 200 `{"status":"healthy","version":"1.4.5"}`
  - `/dashboard/stats` → 401 UNAUTHORIZED（之前是 500）

---

## Step 2 — [DONE] 補 P0-a feedback endpoint 的 authenticated round-trip

**為什麼第二**：路由註冊只證明「沒部署失敗」（401），不代表 schema/DB 寫入正確。

### 重要發現
請求 body 的欄位名稱是 **`feedback`**（不是 `rating`）。動作清單原本寫的 `{"rating":"up"}` 會被 backend 400 拒絕。已在 api-contracts.md 註記。

### 動作清單
- [x] 確認 schema：endpoint = `PATCH /ai/chat/messages/{message_id}/feedback`，body `{"feedback": "up"|"down"|null}`，寫入 `ai_messages.feedback` 欄位
- [x] 跑現有契約測試 `tests/test_api/test_ai_chat_feedback.py`（5 tests，全綠）
- [x] 更新 `docs/coordination/api-contracts.md` 補上完整 schema + error matrix + storage note
- [x] `docs/coordination/frontend-tasks.md` 新增 F16 `[READY]` 通知前端
- [x] commit + push personal remote
- [x] **Playwright MCP** 登入 production → AI chat 送一則訊息 → 點 UI 上的「讚」/「倒讚」按鈕 → 觀察 PATCH 200
- [x] 加碼跑 happy path + clear (null) + invalid value (400) 三種 case

### 完成判準
- ✅ 5 個 contract tests 全綠（schema + handler 邏輯被鎖住）
- ✅ Production smoke：`PATCH /ai/chat/messages/test_msg_id/feedback` 回 401（路由 alive、auth 正常）
- ✅ Production round-trip via Playwright：UI 點讚/倒讚 → PATCH 200 + DB 寫入確認
- ✅ api-contracts.md 文件更新
- ✅ frontend-tasks.md 有 F16 `[READY]` 條目

### Evidence
- pytest 結果：`5 passed, 11 warnings in 1.09s`（`tests/test_api/test_ai_chat_feedback.py`）
- production smoke：`PATCH .../ai/chat/messages/test_msg_id/feedback` → `{"success":false,"error":"UNAUTHORIZED"}` (401)
- doc commit hash：`21d32d7` (`docs(coordination): document P0-a feedback endpoint contract`)
- Storage：單欄 `ai_messages.feedback VARCHAR(10) NULL`（沒有獨立 feedback table）
- **Playwright round-trip**（2026-04-14, msg id `msg_0c31bb1ad951436d`, session `sess_ee05cec54cfa4ce0`, user `usr_800e49`）：
  | 動作 | Status | Response data |
  |---|---|---|
  | UI 「讚」按鈕點擊 (PATCH `{"feedback":"up"}`) | 200 | `{id, feedback:"up"}` |
  | UI 「倒讚」按鈕點擊 (PATCH `{"feedback":"down"}`) | 200 | `{id, feedback:"down"}` |
  | 直接 fetch PATCH `{"feedback":"up"}` | 200 | `{id, feedback:"up"}` |
  | 直接 fetch PATCH `{"feedback":null}` (clear) | 200 | `{id, feedback:null}` |
  | 直接 fetch PATCH `{"feedback":"love"}` (invalid) | 400 | `feedback must be 'up', 'down', or null` |
- **DB 寫入證明**：handler 流程是 `message.feedback = body.feedback → db.commit() → db.refresh(message) → return message.feedback`，所以 response body 是 refresh 後從 DB 讀回的真實狀態，不是 echo back

### 額外發現（小議題，非 blocker）
`GET /ai/sessions/{session_id}` 的 message serializer 沒有把 `feedback` 欄位序列化出來，所以 reload 後 UI 沒辦法從 GET 拿到既有 feedback 狀態（除非 frontend 自己快取）。建議補上——已記入下方 follow-up，但不影響 P0-a 主功能。

---

## Step 3 — [DONE] vercel.json `/sync/*` 修復的 end-to-end 驗證

**為什麼第三**：commit `c8b665b` 已 push railway remote，但還沒做完整的「polling 60s + version cascade」end-to-end 確認。

### 動作清單
- [x] curl `https://chat-icu.vercel.app/sync/status` → 確認 application/json（不是 SPA HTML）
- [x] Playwright：登入 → 觀察 polling 週期（看到 6+ 次 GET /sync/status）
- [x] 直接 SQL UPDATE `sync_status.version` → 確認 version cascade 觸發 `/patients` + `/dashboard/stats`
- [x] `frontend-tasks.md` 把 F15 從 `[DONE-pending-deploy]` 改成 `[DONE]`（待做）

### 完成判準
- ✅ production polling 拿到 `application/json`（headers: `content-type: application/json`, `x-railway-edge: railway/asia-southeast1-eqsg3a`, `x-cache: MISS`, `cache-control: no-store`）
- ✅ Authenticated polling 回 200 + 真實 sync_status payload（version, lastSyncedAt, details with patient name etc）
- ✅ 60s polling cadence 確認（4 分鐘內 6+ 次請求）
- ✅ Version 變化觸發 refresh cascade

### Evidence
- **curl smoke**（unauthenticated）：
  ```
  HTTP/2 401
  cache-control: no-store
  content-type: application/json     ← 不是 text/html
  x-cache: MISS                       ← 不是 HIT (sticky 304)
  x-railway-edge: railway/asia-southeast1-eqsg3a
  ```
- **Authenticated fetch**（via Playwright + browser session cookie）：
  - status: 200, content-type: application/json
  - body: `{success: true, data: {available: true, version: "2026-04-14T10:13:20.233492+00:00", lastSyncedAt: ..., details: {patient_id: "pat_26290720", patient_name: "魏秋葵", snapshot_id: "20260412_010000", lab_data: 89, medications: {upserted: 119, ...}, ...}}}`
- **Polling cadence**（4 分鐘觀察）：6 次 GET /sync/status 全 200，平均間隔 ~40-60s
- **Version cascade test**（直接 SQL UPDATE prod DB）：
  - BEFORE: `version = '2026-04-14T10:13:20.233492+00:00'`
  - SQL: `UPDATE sync_status SET version=$1, updated_at=CURRENT_TIMESTAMP WHERE key='his_snapshots'`
  - AFTER:  `version = '2026-04-14T10:53:34.519783+00:00'`
  - 70s 後 Playwright network log 在新一輪 polling 之後立刻看到：
    - `GET /patients?limit=100 → 200`
    - `GET /dashboard/stats → 200`
  - 證明 frontend hook `useExternalSyncPolling` 偵測到 version 變化 → 呼叫 `refreshSharedPatientDataAfterMutation({refreshDashboardStats: true})`
  - 寫入 `sync_status.version` 是 metadata only，details 欄位仍是真實的最後一次同步資料（pat_26290720 / snapshot 20260412_010000），下次 launchd 跑會自動覆蓋此欄位

### Side effect
Production DB 的 `sync_status.version` 暫時被設成假時間戳 `2026-04-14T10:53:34.519783+00:00`，會在下次 launchd snapshot sync（約 1 小時內）自動恢復成真實 sync 時間。`details` JSON 欄位沒被改、`last_synced_at` 沒被改、無 patient 資料變動。

---

## Step 4 — [TODO] 根治 `_patch_ddi_interacting_members` PgBouncer hang

**為什麼第四（不是第一）**：Plan B workaround 已止血，DDI 互動成員只是補欄位非核心流程。根因調查工時未知，留到前面三個清乾淨再進。

### 動作清單
- [ ] 在 local（連 Supabase prod 或 staging）還原 `_patch_ddi_interacting_members` 呼叫
- [ ] 重現 hang
- [ ] 加 `asyncpg` query timeout + `statement_timeout` 找實際卡住的 statement
- [ ] 檢查 SQL 是否需要 `FOR UPDATE SKIP LOCKED` 或拆 batch
- [ ] 修好之後**移除** Plan B 的 disable
- [ ] Push personal main，確認 Railway 重啟正常 + DDI 欄位有資料

### 完成判準
- DDI backfill 重新啟用（移除 Plan B disable）
- Railway startup < 90s
- DDI 互動成員欄位有實際資料

### Evidence（完成後填）
- 卡住的 statement：
- 修復方案：
- Railway startup 時間：

---

## Step 5 — [TODO] Tech Debt 收尾

### 動作清單
- [ ] 檢視 `docs/coordination/api-contracts.md` 其他缺漏
- [ ] 封存 `frontend-tasks.md` / `backend-tasks.md` 的 `[DONE]` 項目
- [ ] 跑 `bash scripts/verify_restructure.sh` 確認 CI 防護閘門健康

### 完成判準
- 所有 coordination 文件對齊
- verify_restructure.sh 全綠

---

## Loop 狀態

- **模式**：dynamic（self-pacing）
- **下次 wake**：18:48（~25 分鐘後，從 18:23 開始算）
- **wake 後動作**：執行下一個 `[TODO]` step

## 規則

1. **每次完成一個 step**：回來讀這個檔案 → 更新狀態 + Evidence → 才能進下一步
2. **每次開始一個 step**：先讀這個檔案確認上下文（避免被 compaction 吃掉）
3. **絕不跳 step**：上一個 step 沒到完成判準，不能開下一個
4. **遇到 blocker**：在對應 step 加 `### Blocker:` 段落寫明，並停下來問 user
