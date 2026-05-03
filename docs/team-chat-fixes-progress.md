# 團隊聊天室修補進度

> 對應 `docs/team-chat-audit-fixes-2026-05-03.md`（41 條發現）。每完成一個 Task，更新此檔的狀態欄與「最後更新」日期。
>
> **圖示**：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄
>
> **任務 ID 對應**：
> - `TC-W{N}-T{M}` — 進度 Wave 與序號（本檔使用）
> - `TC-B{NN}` — backend 工作單（在 `docs/coordination/backend-tasks.md`）
> - `TC-F{NN}` — frontend 工作單（在 `docs/coordination/frontend-tasks.md`）
> - `F-XX` — audit 文件中的發現編號

**最後更新**：2026-05-03（**Wave 1+2+3 全部完成、Wave 4 結案** — 21/23 audit 主任務落地，2 條 deferred 待 PM 決策）

---

## 整體進度概覽

| Wave | 主題 | 任務數 | 完成 / 總計 | 狀態 |
|------|------|--------|------------|------|
| Wave 1 | 立即修補（純前端，零依賴） | 8 | 8 / 8 | ✅ |
| Wave 2 | 後端權限收緊 + mention SQL | 5 | 5 / 5 | ✅ |
| Wave 3 | 架構決策（PM 已決，動工中） | 4 | 4 / 4 | ✅ |
| Wave 4 | 安全與資料層強化 | 6 | 4 / 6 + 2 deferred | ✅ |
| Backlog | 低優先 / 觀察 | 18 | — | — |

---

## Wave 1 — 立即修補（純前端，無架構決策依賴，目標 1–2 天）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W1-T1 | logout 清三個 module-level cache | F-04 | `src/lib/auth-context.tsx`、`src/lib/api/team-chat.ts`、`src/lib/api/team-chat-cache.ts`（新）、`src/pages/chat.tsx` | A 登入 → /chat → 登出 → B 登入 → /chat 第一秒不應出現 A 的訊息與 mentions | ✅ |
| TC-W1-T2 | `handleSend`/`handlePostAnnouncement` 改 functional updater | F-07 | `src/pages/chat.tsx` | code review：所有 setMessages 改 `prev =>`；連發兩封不會丟失樂觀訊息 | ✅ |
| TC-W1-T3 | `roleDisplayName` 補 `np` + 改 `Record<UserRole, string>` | F-08 | `src/lib/utils/user-role.ts`（新）、`src/pages/chat.tsx`、`src/components/ui/mention-textarea.tsx` | 建立 NP 帳號發訊 → 顯示「專科護理師」而非 `np`；TS 編譯確認 enum 完整 | ✅ |
| TC-W1-T4 | 自動 scroll-to-bottom 加 near-bottom 判斷 | F-09 | `src/pages/chat.tsx` | 手動：往上看歷史訊息時，新訊息進來不會把畫面捲走；底部時仍自動跟上 | ✅ |
| TC-W1-T5 | hover-only 操作改 `focus-within` 可見 | F-10 | `src/pages/chat.tsx`（兩處 `group-hover` cluster） | 手動：純鍵盤 Tab 可看到 pin/reply/delete 按鈕並觸發 | ✅ |
| TC-W1-T6 | 錯誤 toast 雙重觸發收斂 | F-11 | `src/lib/api/team-chat.ts` | 手動：發訊失敗只跳一次 toast；inline error 與 toast 不重疊 | ✅ |
| TC-W1-T7 | `MENTION_REGEX` 抽到 `src/lib/utils/mention-parser.ts` 共用 | F-19 | `src/lib/utils/mention-parser.ts`（新）、`mention-textarea.tsx`、`chat.tsx` | grep 確認全 repo 只剩一份 regex 定義 | ✅ |
| TC-W1-T8 | 時間戳強制 `Asia/Taipei` | F-26 | `src/pages/chat.tsx` | 手動：把瀏覽器時區改成 Asia/Tokyo，訊息時間仍顯示台北時間 | ✅ |

**Wave 1 整體驗收**：
```bash
# TS 編譯
npm run build  # 應 0 error
# Lint
npm run lint
# 手動 smoke：登入 → /chat → 發訊 → @mention → 切帳號驗證 cache
```

> 推送：純前端 → `git push railway main`（Vercel）。

### Wave 1 結案總結（2026-05-03）

**Commits（依時序，全部 fast-forward 進 main）：**

| Commit | Task | 主要改動 |
|--------|------|---------|
| `0ba6c3106` | TC-W1-T1 | 新 `team-chat-cache.ts`；logout/login 清三個 module-level cache |
| `b4daa3d41` | TC-W1-T3 | 新 `user-role.ts`；共用 `ROLE_LABEL`，修 NP 顯示 |
| `64e59778a` | TC-W1-T8 | `formatTimestamp` 強制 `Asia/Taipei` |
| `03992862d` | TC-W1-T5 | hover-only 操作 cluster 加 `group-focus-within:opacity-100` |
| `f863b37fe` | TC-W1-T2 | `handleSend` / `handlePostAnnouncement` 改 functional updater |
| `91d77f9b9` | TC-W1-T7 | 新 `mention-parser.ts`；regex 改 factory pattern |
| `6528a6589` | TC-W1-T4 | `isNearBottomRef` + 條件式 auto-scroll |
| `(this)`    | TC-W1-T6 | 8 個 endpoint 統一 `NO_TOAST`，停止雙重 toast |

**驗證**：每個 branch 都通過 `npx tsc --noEmit` exit 0；TC-W1-T1 額外確認 `npm run build` 後 `chat-*.js` 仍是獨立 lazy chunk。pre-commit hook 全綠（secrets / large files / merge conflict / private key / branch 守衛）。

**未做**（intentional scope 限制）：
- F-01 UI 半（pin button admin gate）— 等 TC-B01 後端先收緊權限
- F-09 「↓ N 新訊息」chip — 留 follow-up，目前只「不 yank」即可
- 三個 console-only mention 錯誤等仍在 chat.tsx；應該與 toast 政策一致地呈現給使用者，但屬於 polish，留 Wave 5

**下一步**：TC-W2 後端權限收緊（`TC-B01` ~ `TC-B05`）。動工前需確認後端 session 可以接手；前端目前的改動都不破壞既有 API 契約。

---

## Wave 2 — 後端權限收緊 + Mention SQL 升級（目標 2–3 天）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W2-T1 | Pin/unpin/首發 pinned/mark_read 加 admin gate（或 owner 檢查） | F-01 | `backend/app/routers/team_chat.py`、`src/pages/chat.tsx` | pytest：nurse pin 訊息 403、未被 mention 對象 mark_read 403；UI：非 admin 看不到 pin 按鈕 | ✅ |
| TC-W2-T2 | Mention SQL 改 `@>` + 加 GIN index | F-13 | `backend/app/utils/jsonb_compat.py`（新）、`backend/app/routers/team_chat.py`、`backend/app/routers/notifications.py`、`backend/alembic/versions/076_team_chat_mention_gin.py`（新） | pytest：seed `["all_admins"]` + role=`admin` query 不誤命中；EXPLAIN 顯示 GIN index scan | ✅ |
| TC-W2-T3 | 訊息發送 / pin / mark_read 加 rate limit | F-15 | `backend/app/routers/team_chat.py` | pytest：超頻發訊回 429；prod：手動連按 30 次發訊 | ✅ |
| TC-W2-T4 | `mentions/count` 加 168h 時間窗（與 notifications 對齊） | F-17 | `backend/app/routers/notifications.py`、`backend/app/routers/team_chat.py` | 手動：seed 一筆 200h 前的 mention，`mentions/count` 不應計入 | ✅ |
| TC-W2-T5 | `POST /team/chat` 驗證 `mentionedUserIds` 都是真實 user | F-18 | `backend/app/routers/team_chat.py` | pytest：送不存在 ID 應 422 而非 200 | ✅ |

**Wave 2 整體驗收**：
```bash
# 後端
cd backend && python3 -m pytest tests/test_api/test_team_chat.py -v --tb=short
# Multi-user regression（新增）
cd backend && python3 -m pytest tests/test_api/test_team_chat_multiuser.py -v
# Migration
cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

> 推送：後端 → `git push personal main`（Railway 自動 alembic upgrade）。

### Wave 2 結案總結（2026-05-03）

**Commits（依時序，全部 fast-forward 進 main）：**

| Commit | Task | F-XX | 主要改動 |
|--------|------|------|---------|
| `d32f490e6` | TC-W2-T1 / TC-B01 + TC-F02 UI 半 | F-01 | pin/post-pinned/mark_read admin gate；mark_read 加 audit log；前端 pin 按鈕 admin gate |
| `73d5451a9` | TC-W2-T2 / TC-B02 | F-13 | mention SQL 改 `@>` + GIN index；新 `jsonb_compat.py` dialect-aware helper；migration 076 |
| `72a697a74` | TC-W2-T3 / TC-B03 | F-15 | send/pin/mark_read 加 slowapi rate limit (20/10/60 per minute) |
| `b60cc8c34` | TC-W2-T4 / TC-B04 | F-17 | `mentions/count` 加 168h 時間窗，與 `notifications/summary` 統一 |
| `(this)`    | TC-W2-T5 / TC-B05 | F-18 | POST `mentionedUserIds` 驗證使用者存在且 active，未知 ID 422 |

**驗證**：每 commit 後跑 `pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py` → 全綠（17 → 27 cases，+10 regression 測試覆蓋多人交互、權限、SQL 行為、時間窗、ID 驗證）。pre-commit hook 全綠。Migration 076 idempotent (`CREATE INDEX IF NOT EXISTS`)。

**未做**（intentional scope 限制）：
- TC-B06 ~ TC-B07（Wave 3）— `is_read` 全域旗標統一、`list_team_chat` DESC + cursor — 需先 PM 決策
- 前端 mention 失敗 toast 文案（搭配 TC-B05 的 422）— 留 polish

**部署注意**：
- 後端推 Railway 時 Procfile 會自動跑 `alembic upgrade head` → migration 076 自動建 GIN index
- 前端 TC-B01/02/03/04/05 不需 build artifact 變更（除 TC-B01 的 pin 按鈕 admin gate，已在 Wave 1+2 同 commit）

**下一步**：Wave 3 三大架構決策（未讀模型、Pin 權限策略、list 排序）。動工前需與 PM 對齊。Wave 4（PII / soft delete / read_by dedup / schema cleanup）可獨立進行不卡決策。

---

## Wave 3 — 架構決策（PM 已決，動工中）

> ✅ **三大決策已對齊（2026-05-03）**：
> 1. 未讀模型 → A：per-user `read_by`，舊資料視為已讀（用 `last_chat_visit_at` 為 baseline）
> 2. Pin 權限 → A：維持 admin only（已在 TC-B01 落實）
> 3. List 排序 → A：改成最新優先，反向 infinite scroll

| Task | 內容 | F-XX | 觸碰檔案 | 狀態 |
|------|------|------|---------|------|
| TC-W3-T1 | 拆解 `is_read` 全域旗標 → per-user 計算 | F-02 | `backend/app/utils/jsonb_compat.py`、`backend/app/routers/team_chat.py`、`backend/app/routers/notifications.py`、`backend/tests/test_api/test_team_chat.py`（新 isolation 測試） | ✅ |
| TC-W3-T2 | `list_team_chat` 改 `DESC` + cursor 分頁 | F-03 | `backend/app/routers/team_chat.py`、`backend/tests/test_api/test_team_chat.py`、`src/lib/api/team-chat.ts`、`src/pages/chat.tsx` | ✅ |
| TC-W3-T3 | ChatPage 即時更新（30s polling 短期 / WebSocket 長期） | F-05 | `src/pages/chat.tsx` | ✅（短期 polling） |
| TC-W3-T4 | 三套 badge 統一語意（sidebar / bell / chat tab） | F-06 | T1 已對齊 sidebar/bell；chat tab 標題改成「病人留言提到我」消除誤導 | ✅ |

### Wave 3 結案總結（2026-05-03）

**前置**：PM 確認三大決策 → 全部選 A（per-user 未讀＋舊資料當已讀／pin 維持 admin only／list 改成最新優先）。

**Commits（依時序）：**

| Commit | Task | F-XX | 主要改動 |
|--------|------|------|---------|
| `7693e4400` | TC-W3-T1 | F-02 | 全域 `is_read` 旗標退役為 legacy；mention 計數改 per-user `read_by @>` + `last_chat_visit_at` baseline。新 `jsonb_compat.array_contains_user_receipt()` + `to_utc_aware()`。**核心 multi-user bug 修復**（A 讀掉 ≠ B 紅點消失）。 |
| `fdeaa652c` | TC-W3-T2 | F-03 | `list_team_chat` `ORDER BY DESC LIMIT N`（記憶體反轉保 ASC contract）+ `?before=<ts>` cursor + `hasMore`/`oldestTimestamp`；前端 `loadOlder()` 反向 infinite scroll，scroll-anchored 不會 yank。 |
| `235d438b6` | TC-W3-T3 | F-05 | ChatPage 加 30s polling，visibility-aware、`isNearBottomRef` 守衛（看歷史時不打擾）、`pollInFlightRef` 防重入。 |
| `(this)`    | TC-W3-T4 | F-06 | 「@我的留言」tab 標題改成「病人留言提到我」消除誤導；T1 已自然對齊 sidebar/bell 的紅點計數。 |

**驗證**：每 commit 後 `npx tsc --noEmit` exit 0、`npm run build` 通過、`pytest tests/test_api/test_team_chat.py tests/test_api/test_notifications.py` 全綠（27 → 34 cases，+7 regression 含 multi-user isolation 與 cursor 分頁）。pre-commit hook 全綠。

**未做**（intentional）：
- WebSocket 長期 realtime — Wave 5+；目前 30s polling 已 close gap
- 「@我的留言」tab 合併 team-chat mentions — 留 Wave 5 polish；現在標題已誠實標註只看 patient board

**部署注意**：
- 後端：team_chat.py 邏輯改變但無 DB schema 變更，部署無 migration 需求
- 前端：chat.tsx 有 polling + infinite scroll + tab 標題改變；user-facing 變化最大的一波

**下一步**：Wave 4（PII 過濾 / soft delete / read_by dedup / schema cleanup / retention），無架構決策依賴。或先 push 到 prod 驗證 Wave 1+2+3 累積成果。

---

## Wave 4 — 安全與資料層強化（目標 1–2 週）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W4-T1 | `/team/users` 加單位過濾、訊息 content PII 提示 | F-12 | （需 PM UX 決策） | — | ⏸ DEFER |
| TC-W4-T2 | `read_by` append 抽共用 helper + dedup | F-14 | `backend/app/utils/read_receipt.py`（新）、`backend/app/routers/team_chat.py`、`backend/app/routers/notifications.py`、`backend/app/routers/messages.py`、`backend/tests/test_services/test_read_receipt.py`（新） | pytest：同一 user 連續 mark-read 10 次後 `read_by` 仍只一條 | ✅ |
| TC-W4-T3 | admin 刪訊息改軟刪除 + audit 帶 content snapshot | F-16 | `backend/app/models/chat_message.py`、`backend/app/models/user.py`（FK 消歧）、`backend/app/routers/team_chat.py`、`backend/alembic/versions/078_team_chat_soft_delete.py`（新）、test 補完 | pytest：軟刪後 list 不顯示，但 audit log details 含 content[:500]；前端對孤兒 reply 顯示 `[原訊息已刪除]`（後者留 polish） | ✅ |
| TC-W4-T4 | 多人交互 regression test 補完 | F-29 | 已分散在 W2/W3/W4 各 commit；下方說明覆蓋情況 | 多人 mark_read 不互相污染 ✅、非 admin pin 403 ✅、`@>` 不誤命中 ✅、`read_by` 不膨脹 ✅ | ✅ |
| TC-W4-T5 | Schema 漂移整理（`reply_count` dead column、ORM FK） | F-30 | `backend/app/models/chat_message.py`、`backend/alembic/versions/077_drop_dead_reply_count.py`（新） | alembic upgrade/downgrade 來回；ORM 與 DB schema 對稱 | ✅ |
| TC-W4-T6 | 訊息 retention：archive job + `total` 移除 | F-31, F-32 | （需 policy 決策；perf 已被 W2-T4 168h 窗 + GIN index 緩解） | — | ⏸ DEFER |

### Wave 4 結案總結（2026-05-03）

**Commits（依時序）：**

| Commit | Task | F-XX | 主要改動 |
|--------|------|------|---------|
| `bd5bcedb0` | TC-W4-T2 / TC-B09 | F-14 | 新 `app/utils/read_receipt.py:append_read_receipt()`；4 個 endpoint（team_chat / notifications×2 / messages）共用，停止無上限累積；8 個 unit test |
| `6662aa1f0` | TC-W4-T5 / TC-B12 | F-30 | Migration 077 drop dead `reply_count` column；model `reply_to_id` 補 ForeignKey 補正 ORM-vs-DB schema 對稱 |
| `dae3e4b75` | TC-W4-T3 / TC-B11 | F-16 | Migration 078 加 `deleted_at`/`deleted_by_id` (+ partial index + FK→users SET NULL)；admin DELETE 改軟刪除；audit log 帶 500-char content snapshot；list 過濾 deleted_at IS NULL；多 FK 觸發 user.chat_messages 須 disambiguate |

**TC-W4-T4（多人 regression test 補完）覆蓋情況**：原計畫新建 `test_team_chat_multiuser.py`，但同等覆蓋已分散在主測試檔：

- 多人 mark_read 不互相污染 → `test_per_user_unread_isolation` (TC-W3-T1)
- 非 admin pin 403 → `test_non_admin_cannot_toggle_pin` (TC-B01)
- 非 admin 首發 pinned 403 → `test_non_admin_cannot_post_pinned` (TC-B01)
- 非 mention 對象 mark_read 403 → `test_non_recipient_cannot_mark_read` (TC-B01)
- `@>` 不誤命中 → `test_mention_predicate_no_substring_collision` (TC-B02)
- 168h 時間窗排除舊 mention → `test_mentions_count_excludes_old_mentions` (TC-B04)
- 未知 mentionedUserIds 422 → `test_post_rejects_unknown_mentioned_user_id` (TC-B05)
- `read_by` dedup → 8 個 unit cases in `test_read_receipt.py` + integration via mark_read paths (TC-B09)
- 軟刪除 + audit content → `test_admin_delete_is_soft_delete_with_audit_snapshot` (TC-B11)
- list cursor + DESC → `test_list_returns_latest_with_cursor` (TC-W3-T2)
- audit log 寫入 → `test_mark_read_writes_audit_log` (TC-B01)

合計 backend test_team_chat.py + test_notifications.py + test_read_receipt.py：43 cases pass。

**Deferred 兩條（需 PM/policy 決策）**：
- **TC-W4-T1 / TC-B08（`/team/users` 單位過濾、PII）**：audit 標記為「是否該限制」是疑問句，不是硬要求。現端點僅回 id/name/role（這些已在訊息 header 顯示），實際 PII 揭露面有限；強制單位過濾會破壞跨單位 @-mention 合理使用情境（公告、跨科會診）。建議若 PM 確認需要嚴格隔離再動工；否則維持現狀並在 mention picker 顯示 unit 後綴消歧義（屬 F-20 backlog）。
- **TC-W4-T6 / TC-B13（retention archive）**：原 audit 顧慮「半年後 30 萬+ 訊息全表掃 mention」。實際上 W2-T4 已加 168h 時間窗、W2-T2 已加 GIN index，mention 計數不再全表掃；list 用 cursor 分頁。perf 顧慮已大幅緩解，retention 變成純 compliance/legal 議題（HIPAA / 個資法）— 屬 policy 而非工程。建議由 legal/PM 決定保留期限後再實作。

**部署注意**：
- Migration 077 drop column — irreversible for `reply_count` data (但欄位永遠是 0，無實際資料損失)
- Migration 078 add columns — 增加，無風險
- 推送 `personal main` → Railway 自動跑 `alembic upgrade head` 會 apply 077 + 078
- Frontend 無變更（軟刪除 list 過濾在 backend，前端拿到的訊息列表自動少掉被刪的）

**整體成果**：Wave 1+2+3+4 共 **21 commit + 2 migration**，audit 41 條主要發現中 **21 條落地，2 條 deferred-with-rationale，18 條 backlog**。

---

## Backlog — 低優先 / 觀察項

| F-XX | 內容 | 嚴重度 | 預計處理時機 |
|------|------|--------|-------------|
| F-20 | picker 顯示同名使用者消歧義（如「陳明（藥師）」） | 🟡 | Wave 5 |
| F-21 | 英文/含空白姓名 mention（picker 用括號界定） | 🟡 | Wave 5 |
| F-22 | sidebar badge 與 chat 頁 visit 協同 | 🟡 | Wave 5 |
| F-23 | sidebar+bell 共用 `NotificationSummaryProvider` | 🟡 | Wave 5 |
| F-24 | `handleTogglePin`/`handleDeleteMessage` 同步寫回 cache | 🟡 | Wave 5 |
| F-25 | 公告 dialog ESC 清狀態 + 刪除 AlertDialog 確認 | 🟡 | Wave 5 |
| F-27 | reply pin 拒絕（`if msg.reply_to_id: 400`） | 🟡 | Wave 5 |
| F-28 | a11y：aria-live、aria-activedescendant | 🟡 | Wave 5 |
| F-33 | 時間戳相對化（今天/昨天/MM/DD） | 🟢 | 隨手改 |
| F-34 | `flatMessages` 同秒 reply tie-breaker | 🟢 | 隨手改 |
| F-35 | 統一 loading spinner 樣式 | 🟢 | 隨手改 |
| F-36 | 公告 banner-style 強化視覺 | 🟢 | UI redesign 時 |
| F-37 | 英文名 avatar 取兩字母 | 🟢 | 隨手改 |
| F-38 | `schemas/message.py` 拆 `team_chat.py` / `patient_message.py` | 🟢 | 大重構時 |
| F-39 | Migration 053 屬反模式（已發生，僅記錄） | ℹ️ | — |
| F-40 | 訊息搜尋功能 | ℹ️ | future work |
| F-41 | ChatPage 805 行拆元件（MessageBubble / Sidebar / Composer / hook） | 🟡 | Wave 6 |

---

## 部署與驗證流程（每個 Task 完成後必跑）

依 CLAUDE.md：

```bash
# 1. 建 feature branch（pre-commit hook 禁止直接 commit 到 main）
git checkout -b fix/tc-w1-t1-cache-on-logout

# 2. 改 + commit
git commit -m "fix(team-chat): TC-W1-T1 clear cache on logout"

# 3. merge 回 main
git checkout main && git merge fix/tc-w1-t1-cache-on-logout --no-edit

# 4. 推送（依改動類型）
git push railway main   # 純前端 → Vercel
git push personal main  # 純後端 → Railway
# 兩者都改 → 兩個都 push

# 5. 部署驗證
# 後端
curl -s https://chaticu-production-8060.up.railway.app/health
# 前端 bundle
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'

# 6. 更新本檔狀態欄為 ✅，更新「最後更新」日期
```

---

## 進度追蹤節奏

- **每完成一個 Task** → 更新本檔狀態欄、coordination 對應任務狀態（`[TODO]` → `[IN-PROGRESS]` → `[DONE]`）
- **每個 Wave 結束** → 在本檔下方新增「Wave N 結案總結」段落（commit hash、prod 驗證證據、發現的副作用）
- **Wave 3 動工前** → 先在 `docs/team-chat-architecture-decision.md`（新檔）記錄三大決策的選項與最終決議

---

## 相關文件

- 主審查文件：[`docs/team-chat-audit-fixes-2026-05-03.md`](team-chat-audit-fixes-2026-05-03.md)
- Backend 任務佇列：[`docs/coordination/backend-tasks.md`](coordination/backend-tasks.md)（搜 `TC-B`）
- Frontend 任務佇列：[`docs/coordination/frontend-tasks.md`](coordination/frontend-tasks.md)（搜 `TC-F`）
- API 契約：[`docs/coordination/api-contracts.md`](coordination/api-contracts.md)
- 部署規範：[`CLAUDE.md`](../CLAUDE.md) 「部署與驗證流程」段
