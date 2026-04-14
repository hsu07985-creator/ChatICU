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

## Step 2 — [TODO] 補 P0-a feedback endpoint 的 authenticated round-trip

**為什麼第二**：路由註冊只證明「沒部署失敗」（401），不代表 schema/DB 寫入正確。

### 動作清單
- [ ] 用 Playwright MCP 登入 `https://chat-icu.vercel.app`
- [ ] 建一則 ai chat message（透過 UI 或直接 API call）
- [ ] `PATCH /ai/chat/messages/{id}/feedback {"rating":"up"}` → 預期 200
- [ ] 直連 Supabase 確認 `chat_message_feedback`（或對應表）有寫入
- [ ] 更新 `docs/coordination/api-contracts.md` 補上 P0-a 的 request/response schema
- [ ] `docs/coordination/frontend-tasks.md` 新增 `[READY]` task 通知前端

### 完成判準
- round-trip 200 + DB 有 row
- api-contracts.md 文件更新
- frontend-tasks.md 有 `[READY]` 條目

### Evidence（完成後填）
- 測試 message id：
- DB row 證據：
- api-contracts commit hash：

---

## Step 3 — [TODO] vercel.json `/sync/*` 修復的 end-to-end 驗證

**為什麼第三**：commit `c8b665b` 已 push railway remote，但還沒做完整的「polling 60s + version cascade」end-to-end 確認。

### 動作清單
- [ ] curl `https://chat-icu.vercel.app/sync/status` → 確認 401 application/json（不是 SPA HTML）
- [ ] Playwright：登入 → 觀察 5 個 polling 週期（5 分鐘）
- [ ] Force HIS sync → 確認 version cascade 觸發 `/patients` + `/dashboard/stats`
- [ ] `frontend-tasks.md` 把 F15 從 `[DONE-pending-deploy]` 改成 `[DONE]`

### 完成判準
- production polling 拿到 application/json
- version 變化會觸發 refresh cascade
- F15 status 更新

### Evidence（完成後填）
- curl 結果：
- Playwright 觀察的 polling 次數：
- version cascade 截圖/log：

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
