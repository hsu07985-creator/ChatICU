# 團隊聊天室後續追加修補計畫（2026-05-03）

> **這份文件是 [`docs/team-chat-audit-fixes-2026-05-03.md`](team-chat-audit-fixes-2026-05-03.md) 的延伸**：原 audit 主任務 21/41 已落地，但使用者實測時發現兩個殘留 bug，三個 Opus 4.7 agent 並行審查後找出系統性盲點。
>
> **規範（用戶指示）**：以後每次工作都先讀這份檔案，確認修補狀態。
>
> **進度追蹤檔**：[`docs/team-chat-fixes-progress.md`](team-chat-fixes-progress.md) — 仍是主進度面板，本檔案的任務以 `TC-FU-XX` 為 ID 列入該檔的「Wave 5」。

**最後更新**：2026-05-03（**Wave 5 全部完成並整合進 main**；尚未 push prod）

## Wave 5 結案總結

| Task | Commit | 主要改動 |
|------|--------|---------|
| TC-FU-T1 | `0375754c9` | 後端 PB mention/alert/list/dashboard/my-mentions 全改 per-user `read_by`，沿用 W3-T1 模式；新 `_pb_unread_predicate` / `_count_pb_unread_for_user` helper；`jsonb_compat.array_contains_user_receipt` 補 `case((expr, True), else_=False)` 解決 NULL `read_by` 誤判（連帶補 W3-T1 同 bug）；新 5 條 multi-user isolation 測試 |
| TC-FU-T2 | `2d9156e57` | 新 `pharmacy_soap_records` 表 + migration 079 + endpoint + 6 測試；前端 SOAP editor 改「先落地後 copy」、4 outcome 處理；`/pharmacy/advice-statistics` 加 SOAP tab |
| TC-FU-T3 | `9b9165b05` | 藥物統計頁加 24 個月 dropdown + 搜尋框 + total 顯示 + 截斷警示 + 預設跳最新紀錄月 fallback |

整合過程修了 3 條衝突：
1. T2 migration 079 `down_revision` 從 worktree 看到的舊 head `"067"` → main 上的 `"078"`
2. `pharmacy.py` HEAD 的 `drug_library_router` 與 T2 的 `soap_records_router` 都保留
3. `pharmacist-soap-editor.tsx` T2 在 CardContent 加的 inline copy button 與 HEAD 的 W4-T2 sticky-bar button 重複，刪 inline 並把 `submitting` 狀態移到 sticky-bar
4. `advice-statistics.tsx` T2/T3 各自加不同 lucide icon 進同一 import，合併

驗證：
- `pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py tests/test_api/test_messages.py tests/test_api/test_dashboard.py tests/test_api/test_message_activity.py tests/test_api/test_patient_board_per_user_unread.py tests/test_services/test_read_receipt.py tests/test_api/test_advice_per_user_scope.py tests/test_api/test_pharmacy_soap.py -q` → 83/83 pass
- `npx tsc --noEmit` 對觸碰的檔案 0 新增 error
- `npm run build` ✓ in 2.38s

---

## 起因

W3-T1（per-user `read_by` mention 計數）只改了 team_chat 那條路徑。使用者問「鈴鐺紅點 1 不消失的 bug 是否還在？」，三個 agent 並行審查發現：

1. **Patient board mention / alert 仍用全域 `is_read`** — **同症狀不同來源**，多人協作下「A 讀完 B 紅點消失」的 bug 仍在，只是位置從 team chat 換到病人留言板 / patient list / dashboard / chat 頁的「病人留言提到我」面板。
2. **使用者問「之前寫的用藥建議在哪查」**：藥物統計頁可達，但 UX 死角嚴重（無搜尋、月份只能 ←→ 一格切換、limit=500 靜默截斷、預設停當月不跳最近紀錄月）。
3. **更深的系統盲點**：`pharmacist-soap-editor` SOAP 寫完只 `copyToClipboard`，**完全沒落地任何資料庫**，使用者要找回只能去 HIS 翻自己貼上的紀錄。Medical-records 草稿純 `localStorage`，換瀏覽器即失。

---

## 三個 Agent 的關鍵發現

### Agent 1（鈴鐺修復確認）— `ae32d31881ca016a6`

- ✅ team_chat 路徑端到端時序正確：popover-open → mark-all → refresh = 紅點 ~400-600ms 內歸零；setTimeout(1500) 是防禦性備援
- ✅ Race conditions（已在 chat 頁、雙擊 popover、跨 tab、tz）全部審完，team_chat 路徑可用
- 🔴 **Patient board mentions 與 alerts 仍全域 `is_read`**（`backend/app/routers/notifications.py:90, 107, 248, 267`、`backend/app/routers/messages.py:619`）— A 讀過 B 看不到
- 🔴 **mark-all-read 失敗無 retry / 無使用者可見 feedback**（`src/components/notification-bell.tsx:76-80`）
- 🟡 多分頁不同步：tab A 落後 tab B 最多 60 秒
- 🟡 SQLite 測試覆蓋不到 PG `@>` 真實行為，缺 multi-user PG-fixtured integration test

### Agent 2（藥物統計頁可達性）— `aebb498ed6c60799d`

- ✅ Per-user scope 嚴謹，列表顯示「床號 + 病人姓名」，時間倒序
- 🔴 **完全沒搜尋功能**（不能搜病人姓名、床號、內容、藥名）
- 🔴 **月份切換只有 ←→ 一格按**（半年前要按 6 次；admin 統計頁有 12 個月 dropdown，本頁沒對齊）
- 🔴 **`limit: 500` 靜默截斷**（後端 `total` 有回但前端不顯示）
- 🔴 **預設停在「當月」**，沒有 fallback 到「最近一條紀錄所在月份」
- 🟡 SOAP / record-templates 是不同資料流（不會出現在統計頁，使用者沒被告知差異）
- 🟢 角色 gate 正確（藥師 / admin only）

### Agent 3（系統橫向掃描）— `a4e95c3e320593385`

- 🔴 **使用者寫的「建議」分散在 7 條路徑**：
  - A 藥事工作站 → `pharmacy_advices` + `patient_messages` 雙寫 ✅ 統計頁找得到
  - B 統計頁本身表單 → 同上 ✅
  - C 留言板帶 VPN tag → 同上 ✅
  - D 留言板送 medication-advice 不帶 VPN tag → **只 `patient_messages`**，統計頁看不到 ❌
  - E **`pharmacist-soap-editor` SOAP → 只 `copyToClipboard`，DB 完全沒寫**，要去 HIS 找 ❌
  - F **medical-records 草稿 → 純 `localStorage`**，換瀏覽器消失 ❌
  - G AI Chat session → `ai_messages`，要去 `/patient/:id?tab=chat` ❌
- 🔴 **Patient list / dashboard / chat 頁「病人提到我」紅點**也全部踩同樣 `is_read==False` 全域 bug
- 🟡 sidebar + bell 兩處各跑一份 `useNotificationSummary`，互不同步
- ✅ 沒 service worker，bundle hash 會自動換版

---

## Wave 5 修補計畫

### TC-FU-T1（最高優先）：Patient board mention / alert 改 per-user `read_by`

**對應**：F-02 的延伸（W3-T1 只修 team_chat，這是同模式 patient board 版）

**範圍（後端）**：
- `backend/app/routers/notifications.py`：
  - `_patient_board_mention_predicate` — 加 `~array_contains_user_receipt(read_by, user.id)` filter，移除 `is_read==False` 依賴
  - `get_notification_summary` 對 `pb_mentions_stmt` 與 `alerts_stmt` 改 per-user
  - `mark_all_notifications_read` PB 部分改用 `append_read_receipt` 已就緒（W4-T2 已抽 helper）
- `backend/app/routers/messages.py`：`mark_message_read` 已用 `append_read_receipt`（W4-T2 改過），但 list query 端可能仍依賴 is_read
- `backend/app/routers/patients.py:235, 377, 434`：`hasUnreadMessages` / patient bootstrap unread 改 per-user
- `backend/app/routers/dashboard.py:88`：dashboard `messages.unread` 改 per-user
- `backend/app/routers/message_activity.py:151`：`my-mentions` `unread_only` 改 per-user

**範圍（前端）**：
- `src/pages/patient-detail.tsx:930-931`：`unreadMessageCount = messages.filter(m => !m.isRead).length` — 服務端 `isRead` 已是 per-user 計算後值的話，前端可直接用；否則前端需改成「我是否在 read_by 中」

**baseline 處理**：
- 沿用 W3-T1 模式：`users.last_chat_visit_at` 太 chat-specific，PB 需要另一個 baseline。
- 選項 A：直接用 `messages.read_by` per-user，不加額外 baseline（舊資料若 `read_by` 空則對所有人都顯示為未讀 — 會「歷史氾濫」）
- 選項 B：加 `users.last_patient_board_visit_at`（新欄位 + migration backfill NOW）
- 選項 C：簡化 — 用 `users.last_chat_visit_at`（已存在）作為跨 PB+TC 統一 baseline，反正都是「使用者活躍時間」
- **建議：C**（最少 schema 變更，與 TC 統一語意）。風險：使用者只看 PB 不看 TC 的話，TC 的 visit 不會 bump 到 PB baseline，但實務上 PB 訊息會直接在患者頁面被看到→各 patient 頁面 mark-read，Per-message `read_by` 自然處理

**測試**：
- 模仿 `test_per_user_unread_isolation`：兩個 user 都被 @ 在某 PatientMessage，A mark-read → B 仍看到 unread

### TC-FU-T2：藥師 SOAP editor 落地 DB

**對應**：Agent 3 路徑 E 系統盲點

**現狀**：`src/components/pharmacist-soap-editor.tsx:329-338` 寫完 polish → 只 `navigator.clipboard.writeText(...)` + toast「已複製到剪貼簿」，使用者貼到 HIS 之後 ChatICU 端 0 紀錄。

**範圍（後端）**：
- 新 endpoint `POST /patients/{patient_id}/soap-records`（或 `POST /pharmacy/soap-records`）：保存 `subjective / objective / assessment / plan` + polish 前後內容
- 新表 `pharmacy_soap_records` 或重用 `record_templates`？應新建 — record_templates 是「模板」不是「實例」
- Schema：`id / patient_id / pharmacist_id / subjective / objective / assessment / plan / created_at`
- 新 migration

**範圍（前端）**：
- `pharmacist-soap-editor.tsx`：`onSubmitted` callback 改成「先 POST 落地 → 再 copyToClipboard 給 HIS 用」雙寫
- 在 `/pharmacy/advice-statistics` 加「SOAP 紀錄」tab 或在病人 detail tab 顯示
- API client `src/lib/api/pharmacy.ts` 加 `createSoapRecord` / `getSoapRecords`

**測試**：
- pytest 寫 SOAP → GET 回來確認內容完整
- per-user scope（藥師只看自己的）

**風險**：較大，影響資料模型。需 PM 確認「使用者是否真的需要在 ChatICU 重看 SOAP」— 也許他們的工作流程就是 HIS 為主、ChatICU 不需保留。

### TC-FU-T3：藥物統計頁 UX 修補

**對應**：Agent 2 三個 🔴 發現

**範圍（前端 only）**：
- `src/pages/pharmacy/advice-statistics.tsx`：
  1. **加月份 dropdown**：抄 `src/pages/admin/statistics.tsx:20-30` 的 12 個月清單實作，併存於現 `<` `>` 按鈕旁
  2. **加搜尋框**：本地搜尋 `record.patientName / bedNumber / content / drugName / category`，client-side filter（不需後端改動）
  3. **顯示 total + 截斷警示**：當 `records.length === 500 && total > 500` 時顯示「（共 X 筆，已顯示前 500 筆）」
  4. **預設跳最近一筆所在月份**：first load 改 default month — 拉一次 API 看最新一條 `timestamp`，往那個月對齊；fallback 才是 currentMonth
- 不動後端

**測試**：
- 手動：開頁面 → 看到搜尋框 + dropdown
- 手動：輸入「van」→ 列表只剩含 vancomycin 的紀錄
- 手動：seed 501 筆當月紀錄 → 列表顯示「已顯示前 500 筆」

---

## 不在 Wave 5 範圍的 Backlog 增列

從 agent 報告增補到 [`docs/team-chat-fixes-progress.md`](team-chat-fixes-progress.md) Backlog：

| 編號 | 內容 | 嚴重度 | 來源 |
|------|------|--------|------|
| F-42 | medical-records 草稿改後端持久化（取代 localStorage） | 🟡 | Agent 3 路徑 F |
| F-43 | 留言板送 medication-advice 但無 VPN tag → advice 表也建 row（路徑 D） | 🟡 | Agent 3 |
| F-44 | sidebar + bell 共用 `useNotificationSummary` Provider（已在 F-23 backlog） | 🟡 | Agent 3 A2 / 已在原 backlog |
| F-45 | mark-all-read 失敗 retry + toast | 🟡 | Agent 1 §3.3 |
| F-46 | 多分頁鈴鐺 BroadcastChannel 同步 | 🟢 | Agent 1 §3 / 已在 F-22 |
| F-47 | PG-fixtured multi-user integration test（rather than SQLite） | 🟡 | Agent 1 §4 |
| F-48 | document.title 升級期短暫 stale（unmount cleanup gap） | 🟢 | Agent 3 C6 |

---

## 部署與驗證

依 CLAUDE.md：
- 後端 → `git push personal main`（Railway 會跑 alembic upgrade）
- 前端 → `git push railway main`（Vercel build）

每個 TC-FU-T{N} 完成後：
1. `cd backend && python3 -m pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py tests/test_api/test_advice_per_user_scope.py tests/test_services/test_read_receipt.py -q` 全綠
2. `npx tsc --noEmit` exit 0
3. `npm run build` 通過
4. 更新本檔案的 task 狀態
5. 更新 `docs/team-chat-fixes-progress.md` 的 Wave 5 段落
6. 推送對應 remote

---

## 引用焦點檔案速查

| 檔案 | 重點 |
|------|------|
| `backend/app/routers/notifications.py` | bell summary / recent / mark-all-read，PB mention 仍全域 `is_read` |
| `backend/app/routers/messages.py` | patient board mark-read / list / send |
| `backend/app/routers/patients.py:235, 377, 434` | patient list 紅點 / bootstrap |
| `backend/app/routers/dashboard.py:88` | dashboard.messages.unread |
| `backend/app/routers/message_activity.py:151` | my-mentions unread filter |
| `backend/app/utils/jsonb_compat.py` | `array_contains_user_receipt` 已就緒（W3-T1 加） |
| `backend/app/utils/read_receipt.py` | `append_read_receipt` 已就緒（W4-T2 加） |
| `backend/app/models/message.py` | `PatientMessage.is_read` 仍全域、`read_by` JSONB |
| `src/pages/pharmacy/advice-statistics.tsx` | UX 改造目標 |
| `src/components/pharmacist-soap-editor.tsx` | SOAP 落地目標 |
| `src/components/notification-bell.tsx` | mark-all-read race / retry / title flash |
| `src/pages/admin/statistics.tsx:20-30` | 12 個月 dropdown 範本 |

**Audit 全文 + 主進度**：[`docs/team-chat-audit-fixes-2026-05-03.md`](team-chat-audit-fixes-2026-05-03.md)、[`docs/team-chat-fixes-progress.md`](team-chat-fixes-progress.md)
