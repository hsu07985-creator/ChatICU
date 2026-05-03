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

**最後更新**：2026-05-03（TC-W1-T1, TC-W1-T3 完成）

---

## 整體進度概覽

| Wave | 主題 | 任務數 | 完成 / 總計 | 狀態 |
|------|------|--------|------------|------|
| Wave 1 | 立即修補（純前端，零依賴） | 8 | 2 / 8 | ⏳ |
| Wave 2 | 後端權限收緊 + mention SQL | 5 | 0 / 5 | ☐ |
| Wave 3 | 架構決策（需 PM 對齊） | 4 | 0 / 4 | ⏸ |
| Wave 4 | 安全與資料層強化 | 6 | 0 / 6 | ☐ |
| Backlog | 低優先 / 觀察 | 18 | — | — |

---

## Wave 1 — 立即修補（純前端，無架構決策依賴，目標 1–2 天）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W1-T1 | logout 清三個 module-level cache | F-04 | `src/lib/auth-context.tsx`、`src/lib/api/team-chat.ts`、`src/lib/api/team-chat-cache.ts`（新）、`src/pages/chat.tsx` | A 登入 → /chat → 登出 → B 登入 → /chat 第一秒不應出現 A 的訊息與 mentions | ✅ |
| TC-W1-T2 | `handleSend`/`handlePostAnnouncement` 改 functional updater | F-07 | `src/pages/chat.tsx:195-229, 282-294` | code review：所有 setMessages 改 `prev =>`；連發兩封不會丟失樂觀訊息 | ☐ |
| TC-W1-T3 | `roleDisplayName` 補 `np` + 改 `Record<UserRole, string>` | F-08 | `src/lib/utils/user-role.ts`（新）、`src/pages/chat.tsx`、`src/components/ui/mention-textarea.tsx` | 建立 NP 帳號發訊 → 顯示「專科護理師」而非 `np`；TS 編譯確認 enum 完整 | ✅ |
| TC-W1-T4 | 自動 scroll-to-bottom 加 near-bottom 判斷 | F-09 | `src/pages/chat.tsx:181-188` | 手動：往上看歷史訊息時，新訊息進來不會把畫面捲走；底部時仍自動跟上 | ☐ |
| TC-W1-T5 | hover-only 操作改 `focus-within` 可見 | F-10 | `src/pages/chat.tsx:406` | 手動：純鍵盤 Tab 可看到 pin/reply/delete 按鈕並觸發 | ☐ |
| TC-W1-T6 | 錯誤 toast 雙重觸發收斂 | F-11 | `src/lib/api/team-chat.ts`（多函式加 `suppressErrorToast: true`） | 手動：發訊失敗只跳一次 toast；inline error 與 toast 不重疊 | ☐ |
| TC-W1-T7 | `MENTION_REGEX` 抽到 `src/lib/utils/mention-parser.ts` 共用 | F-19 | 新檔 + `mention-textarea.tsx:16`、`chat.tsx:239` | grep 確認全 repo 只剩一份 regex 定義 | ☐ |
| TC-W1-T8 | 時間戳強制 `Asia/Taipei` | F-26 | `src/pages/chat.tsx:45-54` | 手動：把瀏覽器時區改成 Asia/Tokyo，訊息時間仍顯示台北時間 | ☐ |

**Wave 1 整體驗收**：
```bash
# TS 編譯
npm run build  # 應 0 error
# Lint
npm run lint
# 手動 smoke：登入 → /chat → 發訊 → @mention → 切帳號驗證 cache
```

> 推送：純前端 → `git push railway main`（Vercel）。

---

## Wave 2 — 後端權限收緊 + Mention SQL 升級（目標 2–3 天）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W2-T1 | Pin/unpin/首發 pinned/mark_read 加 admin gate（或 owner 檢查） | F-01 | `backend/app/routers/team_chat.py:187, 239-268, 271-304`、`src/pages/chat.tsx:417-428` | pytest：nurse pin 訊息 403、未被 mention 對象 mark_read 403；UI：非 admin 看不到 pin 按鈕 | ☐ |
| TC-W2-T2 | Mention SQL 改 `@>` + 加 GIN index | F-13 | `backend/app/routers/team_chat.py:118-137`、`backend/app/routers/notifications.py:31-45`、新 alembic migration | pytest：seed `["all_admins"]` + role=`admin` query 不誤命中；EXPLAIN 顯示 GIN index scan | ☐ |
| TC-W2-T3 | 訊息發送 / pin / mark_read 加 rate limit | F-15 | `backend/app/routers/team_chat.py:187, 239, 271` 套 `@limiter.limit(...)` | pytest：超頻發訊回 429；prod：手動連按 30 次發訊 | ☐ |
| TC-W2-T4 | `mentions/count` 加 168h 時間窗（與 notifications 對齊） | F-17 | `backend/app/routers/team_chat.py:113-137`，抽 `MENTION_LOOKBACK_HOURS` 常數 | 手動：seed 一筆 200h 前的 mention，`mentions/count` 不應計入 | ☐ |
| TC-W2-T5 | `POST /team/chat` 驗證 `mentionedUserIds` 都是真實 user | F-18 | `backend/app/routers/team_chat.py:208-221`（router 層 validate） | pytest：送不存在 ID 應 422 而非 200 | ☐ |

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

---

## Wave 3 — 架構決策（**先決策再動手**，預估 3–4 週）

> ⏸ **需 PM 對齊三大決策後才能動工**：
> 1. 未讀模型統一語意（per-user `read_by` vs visit-based）
> 2. Pin 權限策略（admin only vs 任何人）
> 3. List 排序（`ASC LIMIT 50` 顯示最舊是 bug 還是 onboarding 設計）

| Task | 內容 | F-XX | 觸碰檔案 | 前置決策 | 狀態 |
|------|------|------|---------|---------|------|
| TC-W3-T1 | 拆解 `is_read` 全域旗標 → per-user 計算 | F-02 | `backend/app/routers/team_chat.py:130, 263`、`backend/app/routers/notifications.py:31-45`、新 migration | 決策 1 | ⏸ |
| TC-W3-T2 | `list_team_chat` 改 `DESC` + cursor 分頁 | F-03 | `backend/app/routers/team_chat.py:140-184`、`src/pages/chat.tsx:115-140` | 決策 3 | ⏸ |
| TC-W3-T3 | ChatPage 即時更新（30s polling 短期 / WebSocket 長期） | F-05 | `src/pages/chat.tsx`（新增 polling effect）、（長期）`backend/app/routers/team_chat_ws.py` | 決策技術路徑 | ⏸ |
| TC-W3-T4 | 三套 badge 統一語意（sidebar / bell / chat tab） | F-06 | `src/hooks/use-team-chat-unread.ts`、`src/components/notification-bell.tsx`、`src/pages/chat.tsx` | 決策 1 + 「@我的留言」tab 是否合併 patient board | ⏸ |

---

## Wave 4 — 安全與資料層強化（目標 1–2 週）

| Task | 內容 | F-XX | 觸碰檔案 | 驗證 | 狀態 |
|------|------|------|---------|------|------|
| TC-W4-T1 | `/team/users` 加單位過濾、訊息 content PII 提示 | F-12 | `backend/app/routers/team_chat.py:21-40`、`src/components/ui/mention-textarea.tsx`（輸入時 lint） | 手動：北院藥師 `/team/users` 不應回南院使用者；輸入 MRN 數字模式跳警示 | ☐ |
| TC-W4-T2 | `read_by` append 抽共用 helper + dedup | F-14 | `backend/app/routers/team_chat.py:254-261`、`backend/app/routers/notifications.py:213-214` | pytest：同一 user 連續 mark-read 10 次後 `read_by` 仍只一條 | ☐ |
| TC-W4-T3 | admin 刪訊息改軟刪除 + audit 帶 content snapshot | F-16 | `backend/app/models/chat_message.py`（加 `deleted_at`/`deleted_by_id`）、`backend/app/routers/team_chat.py:307-328`、新 migration | pytest：軟刪後 list 不顯示，但 audit log details 含 content[:500]；前端對孤兒 reply 顯示 `[原訊息已刪除]` | ☐ |
| TC-W4-T4 | 多人交互 regression test 補完 | F-29 | `backend/tests/test_api/test_team_chat_multiuser.py`（新檔） | 涵蓋：多人 mark_read 不互相污染、非 admin pin 403、`@>` 不誤命中、`read_by` 不膨脹 | ☐ |
| TC-W4-T5 | Schema 漂移整理（`reply_count` dead column、ORM FK） | F-30 | `backend/app/models/chat_message.py:27`（補 ForeignKey）、新 migration（drop `reply_count` 或在 model 補欄位） | alembic upgrade/downgrade 來回；ORM 與 DB schema 對稱 | ☐ |
| TC-W4-T6 | 訊息 retention：archive job + `total` 移除 | F-31, F-32 | `backend/scripts/archive_team_chat.py`（新）、`backend/app/routers/team_chat.py:147-152` | 手動：seed 200 筆 90 天前訊息 → 跑 archive → list 預設不含 | ☐ |

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
