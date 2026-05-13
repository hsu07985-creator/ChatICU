# 管理者稽核紀錄頁面缺口修補計畫（2026-05-13）

> 範圍：`/admin/audit` 頁面（`src/pages/admin/placeholder.tsx:64-307`）與其對應後端 `GET /admin/audit-logs`（`backend/app/routers/admin.py:84-169`）。
>
> 本文只列「**功能/UX 缺口**」與修補步驟，不涵蓋「哪些 action 該記錄但目前沒記」（屬於另一份盤點）。
>
> **嚴重度**：🔴 高（影響稽核可用性）｜🟡 中（體驗/正確性）｜🟢 低（清理/重構）。

---

## 0. 現況一句話

後端 endpoint 完整支援 `action/user/userId/status/startDate/endDate` 篩選與分頁，**但前端只丟 `limit=50` 一個參數，剩下全部 client-side 切**。等於買了一台多缸引擎只用一缸。

---

## 1. 缺口總表

| # | 缺口 | 嚴重度 | 主檔案 | 工作量 |
|---|------|--------|--------|--------|
| G1 | 後端篩選參數沒接上 UI（日期區間、狀態、操作、角色、用戶下拉/輸入） | 🔴 | `src/pages/admin/placeholder.tsx` | 中 |
| G2 | 分頁是「前端切片 50 筆」，不是真分頁；資料量一多就只看得到最新 50 筆 | 🔴 | 同上 + `src/lib/api/admin.ts` | 中 |
| ~~G3~~ | ~~沒有 `details` JSONB 詳細檢視~~ — T03 已完成 | 🟡 | — | — |
| G4 | 狀態 Badge 只認 `success/failed`；後端 schema 還允許 `error / degraded`，遇到會 fallback 成紅 Badge 但文字仍寫「失敗」 | 🟡 | `placeholder.tsx:110-115` + i18n | 小 |
| G5 | 「活躍用戶」統計卡片是 client-side 算當頁 50 筆的 `Set(user)`，不是真實值；換頁/篩選後會跳動 | 🟡 | `placeholder.tsx:179-181` + 後端 stats | 小（需後端補回值） |
| G6 | 沒有 匯出 CSV / Excel | 🟡 | 新增後端 endpoint + UI 按鈕 | 中 |
| ~~G7~~ | ~~角色 Badge 仍保留中文舊 key fallback~~ — T06 已刪 dead code（DB 100% 英文） | 🟡 | — | — |
| G8 | 搜尋框是 client-side 過濾當頁 50 筆 — 跟 G1 重疊，但建議至少把搜尋串到後端 `?user / ?action` | 🟡 | 同上 | 小 |
| G9 | `AuditPage` 仍寄生在 `src/pages/admin/placeholder.tsx`，名稱誤導，難找 | 🟢 | 拆檔 → `src/pages/admin/audit.tsx` | 小 |
| G10 | 沒有 e2e/integration 測試覆蓋（篩選/分頁/權限 403） | 🟢 | `e2e/` | 小 |

---

## 2. 修補 Plan（依「使用者價值優先」順序）

> 順序原則：
> 1. **真的能用** > 美觀 — G1/G2 先做完，admin 才能查到第 51 筆以後的紀錄。
> 2. 看到 `details` 才能做案件回溯（G3）。
> 3. 體驗修飾與資料正確性（G4/G5/G7）。
> 4. 匯出與重構（G6/G9/G10）放最後。

### Wave 1 — 讓篩選與分頁真正可用 🔴

#### T01：把後端篩選參數接到 UI
- **檔案**：`src/pages/admin/placeholder.tsx`
- **動作**：
  - 加 4 個控制項：日期區間（`startDate / endDate`）、狀態下拉（`success/failed/error/degraded/all`）、操作關鍵字 input（`action`）、用戶關鍵字 input（`user`）。
  - 角色下拉（`admin/doctor/np/nurse/pharmacist/all`）→ **後端目前沒有 `role` 篩選參數**，需先在 `backend/app/routers/admin.py:84-114` 補上 `AuditLog.role == role_filter`。
  - 把這些參數塞進 `getAuditLogs({...})`；移除 `filteredLogs` 的 client-side `.filter()`（搜尋框改為「直接送 `?user / ?action`」）。
- **i18n key**：`admin:audit.filters.*`（zh-TW + en-US 各補一份；現有字典已在 `src/i18n/locales/zh-TW/admin.json:96-136` 與 `src/i18n/locales/en-US/admin.json:96-136`，沿用同 namespace）。
- **驗證**：選一個日期區間 + status=failed，後端 SQL log 應看到 `WHERE timestamp >= ... AND status = 'failed'`。

#### T02：真分頁
- **檔案**：`src/pages/admin/placeholder.tsx`、`src/lib/api/admin.ts`
- **動作**：
  - 移除「一次撈 50 筆 + 前端切 20」的兩層分頁。
  - 改用 `getAuditLogs({ page, limit: 20, ...filters })`，每次切頁打 API。
  - `totalPages` 改用 `apiData.pagination.totalPages`。
  - 篩選條件變動時 `setPage(1)`。
- **驗證**：插入 50+ 筆假資料（或直接看 prod），可以翻到第 3、4 頁。

---

### Wave 2 — Details 詳細檢視 🟡

#### T03：點 row 開 Drawer 看 `details` JSONB
- **檔案**：`src/pages/admin/placeholder.tsx`
- **動作**：
  - 用 `components/ui/sheet.tsx`（Drawer）或 `dialog.tsx`。
  - Drawer 內容：時間、用戶、角色、action、target、status、ip + `<pre>` 顯示格式化 JSON `details`（敏感欄位後端已遮罩，不必再處理）。
  - row 加 `cursor-pointer` + `onClick={setActiveLog(log)}`。
- **i18n**：`admin:audit.detail.*`。
- **邊界**：`details` 可能為 `null / {} / 大物件`，UI 要分別處理。

---

### Wave 3 — 體驗/正確性修飾 🟡

#### T04：status Badge 完整化
- **檔案**：`placeholder.tsx:110-115` + i18n `admin:audit.status.{error,degraded}`
- **動作**：
  - `success` → 綠；`failed` → 紅；`error` → 深紅或紫；`degraded` → 橘黃。
  - `getStatusBadge` 改成 map 查表，未知狀態 fallback 灰色 + 顯示原始字串。

#### T05：活躍用戶卡片改用後端值
- **後端**：`backend/app/routers/admin.py:142-168` 的 `stats` 加 `active_users`（`SELECT COUNT(DISTINCT user_id) FROM filtered`）。
- **前端**：`placeholder.tsx:179-181` 改讀 `apiData.stats.activeUsers`，移除 client-side `new Set(...)`.
- **API 契約**：同步更新 `docs/coordination/api-contracts.md` 與 `src/lib/api/admin.ts` 的 `AuditLogsResponse.stats`。

#### T06：清理 `role` 中英混存
- **盤點**：跑一次 `SELECT DISTINCT role FROM audit_logs;`，確認是否還有中文（管理者/醫師/...）。
- **若有**：寫一支 one-off migration 把中文 → 英文 key；之後可移除前端 `LEGACY_ROLE_KEY`。
- **若無**：直接刪 `LEGACY_ROLE_KEY` 與其引用（`placeholder.tsx:40-45, 118-120`）。

---

### Wave 4 — 匯出與重構 🟡 / 🟢

#### T07：CSV 匯出
- **後端**：新增 `GET /admin/audit-logs.csv`（複用 list endpoint 的篩選邏輯，但回 `text/csv` + `Content-Disposition`；不分頁，預設給目前篩選結果，hard cap 10,000 筆避免 OOM）。
- **前端**：頁面右上加「匯出 CSV」按鈕，帶上目前篩選條件當 query string。
- **稽核這支匯出本身**：在 endpoint 內呼叫 `create_audit_log(action="export_audit_logs", target="audit_logs", details={"filters":..., "rows":...})` — 否則匯出本身不留痕。

#### T08：拆出 `AuditPage` 到獨立檔
- **動作**：把 `src/pages/admin/placeholder.tsx` 的 `AuditPage` 抽到 `src/pages/admin/audit.tsx`，更新 `src/App.tsx:217` 的 import。
- **placeholder.tsx 留什麼**：若該檔還有其他 page 才留；若沒有就刪。

#### T09：測試
- **e2e**（`e2e/admin-audit.spec.ts`）：
  - 非 admin 訪問 `/admin/audit` 應被擋。
  - 切換 status=failed 後表格只剩失敗紀錄。
  - 翻第二頁，page indicator 顯示「第 2 / N 頁」。
  - 點 row 開 detail drawer，看得到 `details` JSON。

---

## 3. 驗收（全部完成後一輪走查）

- [ ] admin 登入 → `/admin/audit` 載入正常
- [ ] 日期區間 + status=failed 篩選後，後端 SQL log 顯示帶 `WHERE` 條件
- [ ] 翻第 3 頁仍可正常顯示
- [ ] 點 row → 詳細面板顯示 `details` JSON
- [ ] 匯出 CSV 開檔，欄位/編碼正確（UTF-8 BOM）
- [ ] 匯出動作本身也出現在稽核紀錄
- [ ] 非 admin 角色打 `/admin/audit-logs` 拿 403
- [ ] zh-TW / en-US 兩語系切換，所有新字串都有翻譯（無 raw key 露出）
- [ ] `placeholder.tsx` 不再含 `AuditPage`

---

## 3.5 已知觀察（不擋現在，未來處理）

### O1：每次 list 跑 4 個 query（perf debt）
- 目前 `list_audit_logs` 對 `audit_logs` 連跑：(1) `SELECT logs` (2) `COUNT(*) filtered` (3) `COUNT(*) WHERE status='success'` (4) `COUNT(DISTINCT user_id) filtered`。每個都是 filtered subquery，PG 會重評 `ilike(...)`。
- 量上來（> 100k 筆）會明顯。**現在不動**。
- 修法（Wave 5 perf）：合併成一個 query，用 conditional aggregation：
  ```sql
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status='success') AS success,
    COUNT(DISTINCT user_id) AS active_users
  FROM (filtered);
  ```

### ~~O2~~：「活躍用戶」label 誤導 — 已修（2026-05-13）
- ~~卡片現在的數字是「**篩選範圍內** distinct user_id」。~~
- 採方案 (a)：label 改成「篩選範圍用戶數」/「Distinct users in view」。
- 理由：別用 default `startDate=7d` 騙人；admin 工具裡讓資料完整可見比較重要，label 改字最便宜。
- i18n key（`audit.stats.activeUsers`）暫不改名，留待下次 i18n 整理。

### O3：A11y debt — 稽核 row 不可鍵盤抵達
- `TableRow + onClick` 沒 `tabIndex={0}` / `role="button"` / Enter handler。Tab 鍵走不到、screen reader 不知道可點。
- 內部 admin 工具，**不擋現在**。
- 修法：把 row 改成 `<TableRow tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveLog(log); } }} ...>`。

### O4：後端遮罩信任邊界
- T03 把 `details` 整包 JSON 攤給 admin 看，預設「後端寫 audit 時都過了遮罩」（`backend/app/middleware/audit.py`）。
- 風險：新加 endpoint 時忘記過 mask helper → admin drawer 看到 password/token。
- **不在本輪**。修法：寫個小後端 test，grep `create_audit_log` 所有呼叫點，斷言敏感欄位 key 不出現在 `details` payload。

---

## 4. 不在本輪範圍

- 「**哪些 action 該記錄但目前沒記**」 — 屬於後端 instrumentation 盤點，另開 doc。
- 自動記錄 middleware（每個 endpoint 都記）— 設計成本高且雜訊多，先確保現有 manual call 都有覆蓋。
- 非 admin 角色檢視自己團隊的稽核（角色細分權限）— 目前沒有業務需求，等再有人提再做。
- `drug_library_audit_log`（`backend/alembic/versions/072_*.py`）— 那是藥物庫專用 append-only log，不走 `/admin/audit-logs`，獨立模組。

---

## 5. 相關檔案速查

| 用途 | 路徑 |
|------|------|
| 前端頁面 | `src/pages/admin/placeholder.tsx:64-307` |
| 前端 API client | `src/lib/api/admin.ts:11-54` |
| 前端路由 | `src/App.tsx:212-221` |
| 後端 endpoint | `backend/app/routers/admin.py:84-169` |
| 後端 model | `backend/app/models/audit_log.py:11-38` |
| 後端寫入 helper | `backend/app/middleware/audit.py`、`backend/app/utils/audit_async.py` |
| Migration | `backend/alembic/versions/001_initial_schema.py` |
| i18n（zh-TW） | `src/i18n/locales/zh-TW/admin.json:96-136` |
| i18n（en-US） | `src/i18n/locales/en-US/admin.json:96-136` |

---

## 6. 進度追蹤

完成一條打勾一條，commit 訊息照 `chore(audit-Txx): <英文描述>` 或 `feat(admin-audit): ...` 規範。

- [x] T01 — 後端篩選參數接上 UI（+ 後端 role 篩選）  
      _2026-05-13: `backend/app/routers/admin.py` 加 `role` 參數；`src/pages/admin/placeholder.tsx` 加篩選 Card（日期/狀態/角色/操作/用戶）+ draft/applied 模式，移除 client-side `filteredLogs.filter`；i18n `audit.filters.*` + `audit.status.{error,degraded}` 雙語齊備；順手把 status Badge map 化（T04 部分）。tsc 0 錯。_
- [x] T02 — 真分頁  
      _2026-05-13: 移除 client-side `auditLogs.slice((page-1)*20, page*20)` 切片；`buildParams(filters, page, limit)` 改帶 `page/limit` 給後端；`useEffect` deps 加 `page`；`totalPages` 改讀 `apiData.pagination.totalPages`；分頁列顯示條件改 `totalPages > 1`；refresh/reload 按鈕帶 page。後端原本就支援 `page/limit/total/totalPages`，無需改後端。tsc 0 錯。_
      _**遺留**：~~`activeUsers` 卡片仍是 `Set(當頁 user)`~~ — 已由 T05 修掉。_
- [x] T03 — Details Drawer  
      _2026-05-13: 點 row 開右側 Sheet（`components/ui/sheet.tsx`，`sm:max-w-lg`）；整 row clickable + hover；DetailRow 元件 7 個欄位（時間/用戶/角色/操作/目標/狀態/IP）；`details` JSONB 三態（空 → 「無附加資訊」i18n；有 → `<pre>` + `max-h-[60vh]` + `overflow-auto` + `whitespace-pre-wrap`）；不重做敏感欄位遮罩（後端已做）。i18n `audit.detail.*` 雙語齊備。ESC + click outside 走 Radix 內建。**不寫 query string**（稽核 ID 無記憶價值，無分享需求）。tsc 0 錯。_  
      _**後續修補（同輪）**：(1) row onClick 加 `window.getSelection()?.toString()` 檢查，admin 複製 IP/user 時不會誤觸開 drawer；(2) drawer 內 IIFE 收成 const `ts = formatTaipei(...)` + `targetIsSystem`，可讀性 +。_
- [x] T04 — status Badge 完整化（含 error/degraded）  
      _2026-05-13: 隨 T01 一併完成。`getStatusBadge` 改為 map 查表，含 success/failed/error/degraded 配色 + 未知狀態灰色 fallback；i18n `audit.status.{error,degraded}` 雙語齊備（`placeholder.tsx:161-171`）。_
- [x] T05 — 活躍用戶卡片改後端值  
      _2026-05-13: 後端 `admin.py` stats 加 `activeUsers`（`COUNT(DISTINCT user_id)` 跨**篩選後**全集，非當頁）；NULL user_id 自然排除（postgres COUNT DISTINCT 行為）。前端 `AuditLogsResponse.stats.activeUsers` 補欄位；卡片改讀 `stats.activeUsers`，移除 client-side `new Set(auditLogs.map(...))`. tsc 0 錯。_
- [x] T06 — `role` 中英混存清理  
      _2026-05-13: DB 盤點確認 `audit_logs.role` 100% 英文 key（admin 1373 / pharmacist 85 / doctor 30 / nurse 24 / np 3，0 筆中文）。刪 `LEGACY_ROLE_KEY` const、`ROLE_COLOR` 4 個中文 keys、`getRoleBadge` 內 fallback 邏輯 → `role` 直接餵 `t()` + `ROLE_COLOR[role] ?? gray`。順手附 1 行 comment 記錄盤點時點。_
- [ ] T07 — CSV 匯出（含自我稽核）
- [ ] T08 — `AuditPage` 拆檔
- [ ] T09 — e2e / integration 測試
