# 團隊聊天室審查與修補計畫（2026-05-03）

> **進度追蹤**：本文是「發現與計畫」的靜態快照。**實際開發進度請看** [`docs/team-chat-fixes-progress.md`](team-chat-fixes-progress.md)。
> **任務佇列**：後端 → [`docs/coordination/backend-tasks.md`](coordination/backend-tasks.md)（搜 `TC-B`）；前端 → [`docs/coordination/frontend-tasks.md`](coordination/frontend-tasks.md)（搜 `TC-F`）。
>
> 本文整合 2026-05-03 對「團隊聊天室」功能的四面向深度審查（後端 / 前端 / 整合面 / 資料層），列出所有發現並按優先序給出修補計畫。
>
> **審查範圍**：`backend/app/routers/team_chat.py`、`backend/app/models/chat_message.py`、`backend/app/schemas/message.py`、相關 alembic migrations、`src/pages/chat.tsx`、`src/lib/api/team-chat.ts`、`src/hooks/use-team-chat-unread.ts`、`src/components/{app-sidebar,notification-bell,ui/mention-textarea}.tsx`、`src/components/patient/patient-messages-tab.tsx`、`src/lib/api/notifications.ts`。
>
> **嚴重度標記**：🔴 高（必修）｜🟡 中（應修）｜🟢 低（可修）｜ℹ️ 觀察（記錄即可）。

---

## 0. 整體風險判讀

| 面向 | 風險等級 | 一句話 |
|------|---------|--------|
| 權限 / RBAC | 🔴 高 | pin / mark_read / 首發即 pinned 全無 admin gate，`/team/users` 跨單位曝露員工清單 |
| 未讀計數模型 | 🔴 高 | `is_read` 全域 vs `last_chat_visit_at` per-user vs `read_by` 三套並行，三個 surface 永遠對不齊 |
| 即時性 | 🔴 高 | ChatPage 無 polling/WebSocket，停留頁面看不到別人新訊息 |
| Cache / Session | 🔴 高 | 三個 module-level cache 在 logout 不清，跨帳號污染 |
| 資料增長 | 🟡 中 | mention 用 JSONB→TEXT cast、無 GIN、無 retention、`read_by` 無上限 |
| PII / 安全 | 🟡 中 | content 不遮罩、無 rate limit、`/team/users` 無單位過濾 |
| Accessibility | 🟡 中 | hover-only 操作、強制捲底、缺 aria-live |
| 測試覆蓋 | 🟡 中 | 全用單一 user，未驗多人交互場景 |
| 程式品質 | 🟡 中 | 805 行單檔、stale closure、雙重 toast、cache 不同步寫回 |

> **三大核心架構問題（必須先決策再動手）**
> 1. **未讀模型統一**：要選 per-user `read_by` 還是 visit-based？目前混用是所有 badge bug 的根源。
> 2. **Pin 權限策略**：pin = 一般功能（任何人可釘）還是 admin 公告權？目前後端開放、UI 一半收緊。
> 3. **List 排序**：`ASC LIMIT 50` 顯示最舊訊息是 bug 還是刻意（例如 onboarding 引導）？

---

## 1. 🔴 高 — 必修項目（建議 2 週內處理）

### F-01｜Pin / mark_read / 首發即 pinned 加 admin gate

**問題**：`backend/app/routers/team_chat.py:271-304` 的 `toggle_pin_message`、`:187-236` 的 `send_team_chat`（接受 `body.pinned=True`）、`:239-268` 的 `mark_read` 完全沒 role 檢查。任何使用者能 pin/unpin 別人的訊息、首發即 pinned、或把任意訊息標讀（→ 全團隊 mention badge 消失）。

**修補**：
1. `toggle_pin_message`：改 `Depends(require_roles("admin"))`，或改成「作者可解自己 pin、admin 可任意」。
2. `send_team_chat`：若 `body.pinned=True` 且 `user.role != "admin"`，回 403。
3. `mark_read`：加「呼叫者必須是訊息作者」或「呼叫者必須在 `mentioned_user_ids` 或 role 在 `mentioned_roles`」的檢查；同時補 audit log（這個動作會影響全團隊紅點，必須留痕）。
4. 前端 `src/pages/chat.tsx:417-428` 的 Pin 按鈕加 `user?.role === 'admin'` gate（與 `:429` 的 Trash 一致）。

**測試**：在 `backend/tests/test_api/test_team_chat.py` 加 multi-user fixture，驗證 nurse pin 訊息回 403、`mark_read` 對非被 mention 對象回 403。

**風險**：若團隊本來就習慣 nurse 也能 pin（無記載），需先與 PM 確認再收緊。

---

### F-02｜拆解 `is_read` 全域旗標 → per-user 未讀計算

**問題**：`team_chat.py:263` `msg.is_read = True` 是全域 boolean。任一人標讀 → 所有被 @ 對象的 mention badge 都消失。`mentions/count`（`:130`）與 `notifications.py:31-45, 65-72` 都用 `is_read==False` 過濾，污染擴及鈴鐺。**測試只有單一 user 完全沒抓到**。

**修補（兩個方案擇一）**：
- **方案 A（保守）**：保留 `is_read` 給 audit / 統計，但 `mentions/count` 改用 `read_by` JSONB 過濾——「我未讀」= `NOT (read_by @> '[{"userId": "<me>"}]'::jsonb)`。需建 GIN index 在 `read_by`。
- **方案 B（推薦，較乾淨）**：完全移除 `is_read` 與 `read_by` 從 mention 計數的 critical path，全改用 `users.last_chat_visit_at` + per-mention timestamp 比對。`read_by` 降級為「展示誰讀過」的純資訊欄位。

**順帶處理**：`notifications.py:213-214` 的 `mark-all-read` append 沒做 dedup，改與 `team_chat.py:255-261` 共用 helper。

**測試**：兩位被 @ 的 admin，A 進 chat 標讀後，B 的 `/notifications/summary` 與 `/team/chat/mentions/count` 仍應回非 0。

**風險**：方案 B 需 migration 把舊 `is_read` 資料遷出，且 `notifications.py` 邏輯需大改，影響範圍廣。

---

### F-03｜`list_team_chat` 改 `DESC` + cursor 分頁

**問題**：`team_chat.py:158` `ORDER BY timestamp ASC LIMIT 50` 永遠取最舊 50 筆。訊息超過 50 條後使用者打開 chat 看到的是「歷史古董」。

**修補**：
1. 改成 `ORDER BY timestamp DESC LIMIT N`，回傳前在 router 反轉成 ASC（保持前端 chronological 顯示）。
2. 加 `cursor` 參數（`before_timestamp` 或 `before_id`）支援「載入更舊訊息」。
3. 前端 `src/pages/chat.tsx:115-140` 改成支援 reverse infinite scroll（往上滑載入更舊）。

**測試**：seed 100 筆訊息，預設 GET 應回最新 50 筆；帶 cursor 應回前 50 筆。

**風險**：前端 scroll 行為需重做，與 F-12（自動捲底）一起處理。

---

### F-04｜登出清空 module-level cache

**問題**：`src/pages/chat.tsx:18-26` 的 `_msgsCache` / `_mentionsCache` 與 `src/lib/api/team-chat.ts:113-115` 的 `_teamUsersCache` 在 `src/lib/auth-context.tsx:101-111` 的 `logout()` 流程中**完全沒清**。同 tab 切帳號 → user B 進 `/chat` 前 30s–5min 看到 user A 的訊息與 mentions。

**修補**：
1. 在 `team-chat.ts` 與 `chat.tsx` 各 export 一個 `resetTeamChatCache()` 函式。
2. `auth-context.tsx` 的 `logout()` 與 `login()` 兩處都呼叫所有 reset。
3. 或更乾淨：把 module-level cache 改用 React Query / SWR 管理，自動依 user.id 隔離。

**測試**：手動測——A 登入 → 進 /chat 看到訊息 → 登出 → B 登入 → /chat 第一秒不應出現 A 看到的東西。

---

### F-05｜ChatPage 即時更新（polling 或 WebSocket）

**問題**：`src/pages/chat.tsx` 只在 mount 時 fetch 一次。停留頁面**永遠看不到別人新訊息**。對「團隊聊天室」的產品定位是核心功能缺失。

**修補（短期 → 長期）**：
1. **短期**：加 30s polling（`useInterval` 或 `setInterval` 包進 useEffect），visibility hidden 時暫停，refocus 立即 refetch（複製 `use-team-chat-unread.ts` 的模式）。
2. **長期**：上 WebSocket 或 SSE。後端 FastAPI 可用 `WebSocketRoute`，broadcast 新訊息 / pin 事件 / delete 事件。

**順帶處理**：visibility 變成 visible 時主動呼 `markChatVisited()`（不要等 60s polling）。

**風險**：Railway 與 Vercel 的 SSE/WebSocket proxy 需驗證；polling 簡單但每位使用者每 30s 就一個請求。

---

### F-06｜三套未讀計數定義收斂

**問題**：
| Surface | 來源 | 定義 |
|---|---|---|
| Sidebar 紅點 | `/team/chat/unread-count` | visit-based，不論是否被 @ |
| 鈴鐺數字 | `/notifications/summary` | mentions（patient board + team chat） |
| Chat 頁「@我的留言」tab | `getMyMentions` | **只查 patient board，不含 team chat** |

進 chat 頁標 visit → sidebar 歸零，但 bell 數字不變（`is_read` 沒動）；點 bell `markAllRead` → bell 歸零，但 sidebar 不變。

**修補**：
1. 與 F-02 一起決策統一語意：團隊紅點 = 「這個人在這個團隊有未讀訊息」（per-user）。
2. Chat 頁的「@我的留言」應分兩個 tab 或合併查詢：「team chat 中 @ 我」+「patient board 中 @ 我」。目前 UI 標題誤導使用者。
3. 任一處 mark-read 應 publish 事件給其他 surface（broadcast channel 或 React Query mutation invalidation）。

---

### F-07｜`handleSend` 改 functional updater（stale closure）

**問題**：`src/pages/chat.tsx:205-215` 用 `setMessages([...messages, newMessage])`、`_msgsCache = [...messages, newMessage]`。連續送訊（極端 race）可能造成第一封樂觀訊息丟失。`handlePostAnnouncement`（`:286`）同樣問題。

**修補**：
```ts
setMessages(prev => {
  const next = [...prev, newMessage];
  _msgsCache = next;
  _msgsTimestamp = Date.now();
  return next;
});
```

**風險**：低，純改寫法。

---

### F-08｜`roleDisplayName` 缺 `np` + 改用嚴格 type

**問題**：`src/pages/chat.tsx:37-42` 是 `Record<string, string>`，缺 `np` 對應。NP 使用者發訊顯示原始英文 `np`。`mention-textarea.tsx:6-12` 反而完整定義 `ROLE_LABEL = { np: '專科護理師', ... }`。

**修補**：
1. 把 `mention-textarea.tsx` 的 `ROLE_LABEL` export 出來。
2. `chat.tsx` import 共用，刪除自己的 `roleDisplayName`。
3. Type 改為 `Record<UserRole, string>`，未來 enum 新增會編譯失敗提醒補。

**風險**：無，純重構。

---

### F-09｜自動 scroll-to-bottom 加 near-bottom 判斷

**問題**：`src/pages/chat.tsx:181-188` 任何 messages 變動就強制捲底，使用者往上看歷史時新訊息會把畫面捲走。

**修補**：
```ts
const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;
if (isNearBottom) scrollToBottom();
```
否則顯示「↓ 新訊息」浮動 chip 讓使用者主動點。

---

### F-10｜Hover-only 操作鍵盤可達性

**問題**：`src/pages/chat.tsx:406` `opacity-0 group-hover:opacity-100`，pin/reply/delete 對鍵盤使用者不可見。

**修補**：改 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`。

---

### F-11｜錯誤 toast 雙重觸發

**問題**：`src/lib/api/team-chat.ts` 多數函式沒設 `suppressErrorToast`，`apiClient` interceptor 會 toast 一次；前端 catch 又自己 toast 一次。每個失敗跳兩個 toast。

**修補**：
1. 凡是「前端 catch 並有自己處理（inline error 或自訂 toast）」的呼叫，加 `{ suppressErrorToast: true }`。
2. `getTeamChatMessages`、`sendTeamChatMessage`、`postAnnouncement`、`togglePinMessage`、`deleteTeamChatMessage`、`getTeamUsers` 都需加。
3. 或反過來：移除前端自家 catch toast，全交給 interceptor。擇一風格貫徹。

---

### F-12｜PII：`/team/users` 無單位過濾、訊息 content 不遮罩

**問題**：
- `backend/app/routers/team_chat.py:21-40` 回傳所有 active 員工 id/name/role，不分院區/單位。北院藥師看到南院全部護理師清單。
- `src/pages/chat.tsx:401` 訊息 content 不做 PII 遮罩，使用者可能直接寫「王○○ MRN 50480738」。`maskPatientName`（`patient-name.ts`）只用在側欄 mention groups。

**修補**：
1. `/team/users` 加 `?unit=<id>` 或自動依當前使用者單位過濾（需 `users` 表有 unit/campus 欄位）。
2. 訊息 content 顯示時可選做 client-side PII detector（pattern：`MRN \d{8}`、健保字號等），對非醫師角色 mask。短期：在輸入框加 lint 提示「偵測到病歷號，建議改用病歷號連結而非明文」。
3. 法遵層面（個資法）需與 PM / Legal 確認 retention 與 audit 要求。

**風險**：高 — 涉及產品政策決策，不純技術修補。

---

### F-13｜Mention SQL 用 `cast(JSONB, String).contains` 反模式

**問題**：`backend/app/routers/team_chat.py:121, 125` 與 `backend/app/routers/notifications.py:34-44`：

```python
cast(TeamChatMessage.mentioned_roles, String).contains(f'"{user.role}"')
```

放棄 GIN index、無法走 PostgreSQL `@>` operator、`'"all"'` 子字串若未來 enum 加入 `"all_doctors"` 之類會誤命中。

**修補**：
```python
TeamChatMessage.mentioned_roles.contains([user.role])  # SQLA JSONB.contains == @>
TeamChatMessage.mentioned_user_ids.contains([user.id])
```

並加 GIN index：
```python
op.create_index(
    "ix_team_chat_messages_mentioned_user_ids_gin",
    "team_chat_messages",
    ["mentioned_user_ids"],
    postgresql_using="gin",
)
op.create_index(
    "ix_team_chat_messages_mentioned_roles_gin",
    "team_chat_messages",
    ["mentioned_roles"],
    postgresql_using="gin",
)
```

**測試**：seed 一筆 `mentioned_roles=["doctor"]`、一筆 `["all_admins"]`，查 role=`doctor` 應只回第一筆（目前 bug 會誤命中第二筆若有 `"all"` 模糊條件）。

---

## 2. 🟡 中 — 應修項目（建議 1 月內處理）

### F-14｜`read_by` JSON 無上限與重複保護
- `backend/app/routers/notifications.py:213-214` `mark-all-read` 沒 dedup（`team_chat.py:255-261` 有）。
- 50 人團隊 × 重複呼叫 → 單筆訊息 `read_by` 可累積數百條。
- **修補**：抽 helper `append_read_receipt(read_by, user)` 統一 dedup，兩處共用。

### F-15｜訊息發送 / pin / mark_read 無 rate limit
- `backend/app/routers/team_chat.py` 全部端點未掛 `@limiter.limit(...)`（對照 `auth.py`、`clinical.py` 都有）。
- **修補**：`POST /team/chat` 加 `@limiter.limit("20/minute")`、`PATCH .../pin` 加 `5/minute`、`PATCH .../read` 加 `60/minute`。

### F-16｜admin 刪訊息 hard delete + 無 content snapshot
- `backend/app/routers/team_chat.py:307-328` `db.delete(msg)`，audit log 只記 `target=msg.id`，沒記 content/author。一週後刪光所有訊息再離職，無法重建。
- reply 子訊息 `ON DELETE SET NULL` 變孤兒，前端 `messageById.get(repliedTo.id)` 找不到 → quote 靜默消失。
- **修補**：
  1. 加 `deleted_at` / `deleted_by_id` 欄位改軟刪除。
  2. audit log 帶 `details={"content": msg.content[:500], "author": msg.user_name, "timestamp": msg.timestamp.isoformat()}`。
  3. 前端對「parent 已刪」reply 顯示 `[原訊息已刪除]` placeholder。

### F-17｜`mentions/count` 沒時間窗
- `backend/app/routers/team_chat.py:113-137` 全表掃；`notifications.py:25` 用 168h cutoff。
- 鈴鐺顯示 5 條，進 chat 看到 28 條，使用者錯亂。
- **修補**：兩處統一用同一個 `MENTION_LOOKBACK_HOURS = 168` 常數。

### F-18｜`mentionedUserIds` 不驗 user 是否存在
- `backend/app/schemas/message.py:78-86` 只檢查長度。
- 前端可能因 typo 送出不存在的 ID，後端 200 OK 寫入，UI 靜默忽略。
- **修補**：在 router 層 `SELECT id FROM users WHERE id IN (...)` 過濾掉不存在的 ID，或 422 回報。

### F-19｜`MENTION_REGEX` 重複定義
- `src/components/ui/mention-textarea.tsx:16` 與 `src/pages/chat.tsx:239` 兩份字面相同的 regex。
- **修補**：抽到 `src/lib/utils/mention-parser.ts` 共用 export。

### F-20｜重名使用者 mention 行為
- `chat.tsx:69-72` `userByName.set(u.name, u)` 後者覆蓋前者。
- `mention-textarea.tsx:69-71` `for (const u of users) if (u.name === name)` 反而**所有同名都加進 mentionedUserIds** → 通知到錯人。
- **修補**：picker 顯示「陳明（藥師）」「陳明（護理師）」消歧義；`@姓名` 不夠用時提示使用者用 picker 選擇。

### F-21｜英文 / 含空白姓名 mention 完全壞掉
- `mention-textarea.tsx:16` regex `/@([\p{L}\p{N}_-]+)/gu` 遇空白截斷。`Mary Jane Smith` 永遠抓不到。
- **修補**：picker 插入時用括號界定 `@[Mary Jane Smith]`，或改 markdown-style `@<id>` 內部標記。

### F-22｜sidebar badge 與 chat 頁 visit 不協同
- 進 `/chat` → 後端 `last_chat_visit_at` 已 bump，但 sidebar `useTeamChatUnread` 仍要等 60s 才下次 polling 才歸零。
- **修補**：`useTeamChatUnread` 已 export `refresh`，在 `chat.tsx` 的 `markChatVisited()` 完成後透過 context / event bus 觸發。

### F-23｜sidebar + bell 重複 instantiate `useNotificationSummary`
- `src/components/app-sidebar.tsx:33` 與 `src/components/notification-bell.tsx:41` 各自跑一份 60s polling。
- **修補**：抽 `NotificationSummaryProvider`，兩個 consumer 共用同一份 state。

### F-24｜`handleTogglePin` / `handleDeleteMessage` 不寫回 cache
- `src/pages/chat.tsx:301-316, 460` 只更新 React state，沒同步寫 `_msgsCache`。
- 30s 內離開 chat 再回來，刪除/解 pin 的訊息「復活」。
- **修補**：每次 mutate state 後同步寫 `_msgsCache`。或改 React Query 自動處理。

### F-25｜公告 dialog ESC 不清 content + 刪除無確認
- `src/pages/chat.tsx:752-802` ESC 關閉 dialog 不會清 `announcementContent`，下次再開殘留。
- `:435` 刪除無二次確認，誤點即刪。
- **修補**：`onOpenChange` 設 false 時清狀態；刪除改用 `AlertDialog`。

### F-26｜時區未強制 Asia/Taipei
- `src/pages/chat.tsx:45-54` `toLocaleString('zh-TW', { ... })` 無 `timeZone`，違反 CLAUDE.md 「一律台北 UTC+8」規範。
- **修補**：加 `timeZone: 'Asia/Taipei'`。

### F-27｜Reply pin 寫入但永不顯示
- `backend/app/routers/team_chat.py:156` list 過濾 `reply_to_id IS NULL`，pin 一個 reply 後 sidebar pinned tab 永遠看不到。
- **修補**：`toggle_pin_message` 拒絕 reply（`if msg.reply_to_id: 400`），或 list pinned 時不過濾 reply。

### F-28｜Accessibility 改進
- 缺 `aria-live="polite"` 公告新訊息。
- mention picker 缺 `aria-activedescendant`。
- 對應 F-10 一起改。

### F-29｜測試覆蓋空白
- `backend/tests/test_api/test_team_chat.py` 全用單一 user，未覆蓋：
  - 多人交互的 `is_read` 污染（F-02）
  - 非 admin 嘗試 pin / delete 應 403（F-01）
  - mention `cast contains` 子字串誤命中（F-13）
  - `read_by` 累積上限
  - reply 父訊息被刪後的孤兒處理
  - `mentioned_user_ids` Path B 計數
- **修補**：補 multi-user fixture，每條 critical bug 都加 regression test。

### F-30｜Schema 漂移與一致性
- `reply_count` 欄位（migration 015）model 未定義、runtime 不維護，永遠是 0（dead schema）。
- `reply_to_id` ORM 沒宣告 ForeignKey 但 DB 有（schema 不對稱）。
- `user_role` / `mentioned_roles` 沒 DB CHECK constraint。
- **修補**：要嘛在 model 補欄位（並維護），要嘛 migration drop。CHECK constraint 一次性加上。

### F-31｜`total` 每次 list 都 `count(*)` 但前端沒用
- `backend/app/routers/team_chat.py:147-152` 額外一次 query。
- `src/lib/api/team-chat.ts:30-33` 前端解構時根本沒用 `total`。
- **修補**：移除 `count(*)` query 或讓 `total` 真有用途。

### F-32｜訊息 retention policy
- 訊息表無限累積，半年後 30 萬+ 筆對 mention 全表 cast scan 會明顯慢。
- **修補**：加 `archived_at` 欄位 + 90 天 archive job，list 預設過濾 archived。

---

## 3. 🟢 低 / ℹ️ 觀察

### F-33｜時間戳全顯示完整日期
- `chat.tsx:45-54` 不論訊息是 1 分鐘前或一年前都顯示 `2026/05/03 14:30`。
- **建議**：今天 → `HH:mm`，昨天 → `昨天 HH:mm`，更早 → `MM/DD`。

### F-34｜`flatMessages` 同秒 reply 排序不穩定
- `chat.tsx:269` `localeCompare(timestamp)` 對同秒訊息順序未定。
- **建議**：先排 root，每個 root 後緊接 replies；或加 `id` tie-breaker。

### F-35｜四種 loading spinner 同頁出現
- `chat.tsx:583, 427, 441, 731, 790` 混用 `LoadingSpinner` / `ButtonLoadingIndicator` 兩套樣式。
- **建議**：統一。

### F-36｜公告與一般 pinned 訊息 UI 差異微弱
- 只多一個小金色 badge「已釘選」（`chat.tsx:365-369`）。
- **建議**：公告改 banner-style，與一般訊息明顯區分。

### F-37｜Avatar 對英文名只取首字
- `chat.tsx:349` `slice(0, 1)`，英文名 `MS` 變 `M`。
- **建議**：英文名取兩個字母縮寫。

### F-38｜`MessageCreate.messageType` 與 `TeamChatCreate` 同檔混淆
- `backend/app/schemas/message.py:19-22` 把 patient board 的 `progress-note/nursing-record` 與 team chat schema 放一起。
- **建議**：拆檔 `team_chat.py` / `patient_message.py`。

### F-39｜Migration 053 是資料銷毀型
- 一次性 `DELETE FROM team_chat_messages` 寫進 schema migration history，downgrade no-op。
- **觀察**：屬反模式但已發生，僅作記錄。

### F-40｜訊息搜尋功能缺
- 整頁無 search box。
- **建議**：未來功能。

### F-41｜ChatPage 805 行單檔
- 可拆 `<MessageBubble />`、`<MentionsSidebar />`、`<PinnedSidebar />`、`<AnnouncementDialog />`、`<MessageComposer />`、`useTeamChat` hook。
- **建議**：整體重構時順便處理。

---

## 4. 修補順序與任務對照表

> 各 F-XX 已派發為 progress tracker (`TC-W{N}-T{M}`)、後端佇列 (`TC-B{NN}`)、前端佇列 (`TC-F{NN}`)。動工請從 progress tracker / 佇列著手，**本表只是 audit → task 的對照**。

### Sprint 1（必修，2 週，可立即動工）
| F-XX | Progress | Backend task | Frontend task |
|------|----------|--------------|---------------|
| F-01 權限 gate | TC-W2-T1 | TC-B01 | TC-F02（UI 半，與 TC-B01 同 release） |
| F-04 cache 清空 | TC-W1-T1 | — | TC-F01 |
| F-07 functional updater | TC-W1-T2 | — | TC-F02 |
| F-08 np 角色 | TC-W1-T3 | — | TC-F03 |
| F-09 捲底判斷 | TC-W1-T4 | — | TC-F04 |
| F-10 鍵盤可達 | TC-W1-T5 | — | TC-F05 |
| F-11 toast 重複 | TC-W1-T6 | — | TC-F06 |
| F-13 mention `@>` + GIN | TC-W2-T2 | TC-B02 | — |
| F-15 rate limit | TC-W2-T3 | TC-B03 | — |
| F-17 mentions/count 168h | TC-W2-T4 | TC-B04 | — |
| F-18 mentionedUserIds 驗證 | TC-W2-T5 | TC-B05 | — |
| F-19 regex 共用 | TC-W1-T7 | — | TC-F07 |
| F-26 時區 Asia/Taipei | TC-W1-T8 | — | TC-F08 |

### Sprint 2（架構決策後，3-4 週）
| F-XX | Progress | Backend | Frontend | 前置決策 |
|------|----------|---------|----------|---------|
| F-02 未讀模型統一 | TC-W3-T1 | TC-B06 ⏸ | (TC-F12 連動) | 決策 1 |
| F-03 list DESC + cursor | TC-W3-T2 | TC-B07 ⏸ | TC-F10 ⏸ | 決策 3 |
| F-05 polling / WebSocket | TC-W3-T3 | (新端點) | TC-F11 ⏸ | 技術路徑 |
| F-06 三套 badge 統一 | TC-W3-T4 | (跟 TC-B06) | TC-F12 ⏸ | 決策 1 |

### Sprint 3（補強，1 月）
| F-XX | Progress | Backend | Frontend |
|------|----------|---------|----------|
| F-12 PII / 單位過濾 | TC-W4-T1 | TC-B08 | (輸入提示，待開) |
| F-14 read_by dedup | TC-W4-T2 | TC-B09 | — |
| F-16 軟刪除 + audit content | TC-W4-T3 | TC-B11 | TC-F09 ⏸ |
| F-29 多人測試補完 | TC-W4-T4 | TC-B10 | — |
| F-30 schema 漂移 | TC-W4-T5 | TC-B12 | — |
| F-31, F-32 retention | TC-W4-T6 | TC-B13 | — |

### Backlog
F-20 ~ F-25, F-27, F-28, F-33 ~ F-41 — 見 progress tracker 的 Backlog 段。

---

## 5. Commit / 分支規範

依 CLAUDE.md：
- 每條 F-XX 單獨 feature branch + 單獨 commit。
- Commit message 格式：`fix(team-chat): F-01 lock pin/delete to admin`、`refactor(team-chat): F-08 share ROLE_LABEL constant`。
- 後端改動 push `personal main`（Railway），前端改動 push `railway main`（Vercel）。
- 每條改動完成執行 `bash scripts/verify_restructure.sh`（如有對應 task token）。

## 6. 部署驗證清單

對應 CLAUDE.md「部署與驗證流程」：

```bash
# 後端（Railway）
curl -s https://chaticu-production-8060.up.railway.app/health

# 前端（Vercel）
curl -s "https://chat-icu.vercel.app/$(curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js')" \
  | grep -oE 'chaticu-production[^"]*' | head -1   # 應為空
```

每條修補完成後：
1. 後端：`backend/tests/test_api/test_team_chat.py` 全綠。
2. 前端：手動驗證 chat 頁打開／發訊／pin／delete／@mention／登出登入。
3. 多人情境：兩個帳號同時開兩個瀏覽器，驗證未讀 badge 與 mention 計數一致。

---

## 7. 引用焦點檔案（速查）

| 檔案 | 行數 | 重點 |
|------|------|------|
| `backend/app/routers/team_chat.py` | 1-328 | 所有 endpoint |
| `backend/app/models/chat_message.py` | 11-47 | DB 欄位 |
| `backend/app/schemas/message.py` | 60-86 | TeamChatCreate 驗證 |
| `backend/app/routers/notifications.py` | 31-229 | Mention predicate / mark-all-read |
| `backend/tests/test_api/test_team_chat.py` | — | 測試覆蓋 |
| `src/pages/chat.tsx` | 1-805 | ChatPage |
| `src/lib/api/team-chat.ts` | 1-135 | API client + cache |
| `src/hooks/use-team-chat-unread.ts` | 1-65 | Sidebar polling |
| `src/components/ui/mention-textarea.tsx` | 1-200 | Mention picker |
| `src/components/app-sidebar.tsx` | 30-50 | Sidebar polling 注入點 |
| `src/components/notification-bell.tsx` | 40-100 | Bell mark-all-read |

Migrations：`001_initial_schema.py`、`010_schema_hardening.py`、`015_team_chat_replies_read.py`、`016_mentioned_roles.py`、`053_clear_messages.py`、`054_add_np_role.py`、`069_add_mentioned_user_ids_to_team_chat.py`、`071_add_last_chat_visit_at_to_users.py`、`075_users_fk_set_null_for_hard_delete.py`。

---

**文件版本**：v1（2026-05-03）
**審查方法**：4 個 Opus 4.7 sub-agents 並行審查（後端 / 前端 / 整合 / 資料層）
**未產出**：修補程式碼，僅列發現與計畫
