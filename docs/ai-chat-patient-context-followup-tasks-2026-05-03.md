# AI 對話助手病患資料讀取強化 — 後續待辦

> 日期：2026-05-03
> 對應主計畫：[`ai-chat-patient-context-enhancement-plan-2026-05-03.md`](ai-chat-patient-context-enhancement-plan-2026-05-03.md)
> 範圍：主計畫 8 條中「已上 prod 但仍有 follow-up」與「尚未啟動」的工作。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄／不做

---

## 0. 已完成回顧（對照主計畫 §8 表）

`feature/advice-history-management` → `main` → `personal/main` (Railway) + `railway/main` (Vercel) + `origin/main` 全部同步在 `c2ef77505`。

| Phase | 主計畫項目 | 狀態 | 對應 commit |
|-------|-----------|------|------------|
| 0 | Tool loop / 後端預取架構決策 | ✅ 已選後端關鍵字預取（過渡方案） | 隨 Phase 3-7 一起 |
| 1 | 資料新鮮度 / 缺口提示 | ✅ | `aa116ac8c` |
| 2 | CrCl / 腎功能給藥摘要 | ✅ | `aa116ac8c` |
| 3 | 用藥安全摘要 | ✅ | `ee3469cd8` |
| 4 | 微生物培養預取 | ✅ | `e95634ac9` |
| 5 | 72h 用藥變更預取 | ✅ | `5400296ed` |
| 6 | 藥師建議歷史搜尋 | ✅ | `e0b7f1132` |
| 7 | 完整影像/報告預取 | ✅ | `c2ef77505` |
| 8 | 留言板/團隊聊天室全文 | ❌ 計畫表本就標「暫不做」 | — |

**驗證**：本地 75 tests passed、Railway v1.4.5 healthy、Vercel `index-DJUkuS-t.js`、ACL 閘 401 正常。

---

## 1. 短期可做（建議本週／下週收）

### F1. 同步主計畫文件（避免文件落後實作）
- **狀態**：☐
- **問題**：主計畫 §1「目前狀態」仍寫著「沒有放進 snapshot：培養、CrCl、MAR、72h 用藥變更、藥師建議」，但這些已全部上線。新加入的人讀文件會被誤導。
- **觸碰檔案**：`docs/ai-chat-patient-context-enhancement-plan-2026-05-03.md`
- **要改哪幾段**：
  - §1「目前狀態」：把已完成項目從「沒有放進」搬到「已讀取」，並標 commit hash
  - §3 Phase 0：標「✅ 已選後端關鍵字預取」
  - §5 Phase 1-6 加 ✅ 與 commit hash
  - §10 Definition of Done：把 1-7 條 check 起來，留 8 條（留言板）作為 out-of-scope 註記
- **預估工時**：15 min
- **驗收**：文件描述跟程式狀態一致，連 commit。
- **風險**：低

### F2. 「重新整理快照」按鈕
- **狀態**：☐
- **問題**：主計畫 §7.2 提到 snapshot 過 30 分鐘可能變舊，但目前使用者只能「開新對話」才能重抓 snapshot；同 session 內病況變化（新檢驗、新生命徵象）只能靠 delta 偵測，碰不到的欄位（如 vent、reports、cultures）會卡在第一輪的快照。
- **設計**：
  - 前端：對話區工具列加一顆「重新整理快照」按鈕，按下去呼叫新後端 endpoint
  - 後端：新增 `POST /ai/chat/sessions/{session_id}/refresh-snapshot`，重跑 `build_critical_snapshot` + `build_deferred_snapshot`，覆寫 `ai_sessions.snapshot_metadata`，回傳新 `snapshot_taken_at`
  - 提示：刷新後在對話區插入一條 system 訊息「📋 已重新整理病患快照（HH:MM）」讓使用者知道
- **觸碰檔案**：
  - `backend/app/routers/ai_chat.py`（新 endpoint）
  - `src/pages/ai-chat.tsx`（按鈕 + handler）
  - `src/lib/api/ai.ts`（新 API function）
  - `backend/tests/test_api/test_chat_snapshot_refresh.py`（新測試）
- **預估工時**：1.5-2h（後端 30 min + 前端 30 min + 測試 30 min + 部署驗證）
- **驗收**：
  - 同 session 按下按鈕後，下一輪 LLM 看到的 snapshot 是新的
  - 30 分鐘規則：snapshot 超過 30 min 時 UI 顯示「快照已過 N 分鐘」提示按鈕高亮
  - 權限：仍走 `assert_patient_chat_access` ACL 閘
- **風險**：低-中（需注意 OpenAI prompt cache：新 snapshot 會破當前 session 的 cache，但這是預期行為）

### F3. AI chat 結果裡 deep link 到藥師建議頁
- **狀態**：☐
- **問題**：Phase 5 後端會把藥師建議內容回傳給 LLM，但 LLM 引用後使用者點不回原始記錄。主計畫 §5 Phase 5 frontend §3 提到「回答中附上可點回的 deep link」，這條沒做。
- **設計**：
  - 後端：`format_pharmacy_advice_context` 在每筆 advice 結尾加上 `[advice_id=adv_xxx][bed=NN][patient=usr_xxx]` 標記，讓 LLM 能引用
  - 前端：在訊息渲染層偵測這類標記，轉成可點的 chip 連到 `/pharmacy/advice-statistics?advice_id=xxx` 或病人頁
  - 或更簡單：訊息下方加一個「📎 引用的藥師建議」區，列出本輪預取的 advice_id 與床號，每個都是連結
- **觸碰檔案**：
  - `backend/app/services/ai_question_prefetch.py`（format_pharmacy_advice_context）
  - `src/pages/ai-chat.tsx`（訊息渲染 + chip）
  - `src/pages/pharmacy/advice-statistics.tsx`（接 query param highlight）
- **預估工時**：2-3h
- **驗收**：
  - 問「我之前在哪床寫過 vancomycin」→ 回答下方有 chip 列出實際 advice_id 與床號
  - 點 chip 跳到 `/pharmacy/advice-statistics` 並 highlight 該筆
  - 個資：chip 顯示床號，不顯示病人姓名（沿用後端 mask 規則）
- **風險**：中（前端訊息渲染要小心 XSS / Markdown injection）

---

## 2. 中長期升級項目（業務驅動再做）

### F4. 升級成正式 LLM tool loop
- **狀態**：☐
- **目前痛點**：後端用關鍵字 (`_CULTURE_INTENT_KEYWORDS` 等) 猜使用者要什麼，缺點：
  - 中文同義詞不易窮舉（例：「降階」/「退階」/「停掉」/「縮窄抗生素」都該觸發 culture，但漏了「縮窄」）
  - 語意相近但沒命中關鍵字會漏（例：「他現在發燒，要不要換抗生素」沒有「culture」關鍵字）
  - 一輪只能預取一次，無法多輪 tool call（例：先查 culture 再查 72h 用藥變更）
- **正式方案**：
  - 後端：新增 `backend/app/ai_tools/` registry，定義 5 個 tool（cultures / med_changes / advice_search / reports / labs_history）
  - 改 `_event_stream` 支援 tool calling loop（OpenAI function calling 規格）
  - 加 tool call audit log，限制每輪最多 3 個 tool call 防迴圈
- **觸碰檔案**：
  - 新增 `backend/app/ai_tools/`（registry + 5 個 tool handler）
  - `backend/app/routers/ai_chat.py`（多輪 tool loop）
  - `backend/app/llm.py`（加 tool 參數）
  - `backend/tests/test_api/test_ai_chat_tools.py`（新測試）
- **預估工時**：6-10h（含設計 + 測試 + 部署驗證）
- **觸發條件**：等 prod 用了一陣子，**實際看到 prefetch 漏掉哪些問題類型** 再做。沒實際 user data 之前不要憑空優化。
- **風險**：中-高（碰核心 SSE 串流，破 OpenAI prompt cache 的可能性高，要小心 byte-stable prefix）

### F5. 留言板 / 團隊聊天室全文 tool
- **狀態**：❌ 不做
- **理由**：主計畫 §4.3 已說明：
  - token 成本高（每輪都塞）
  - 容易混入過期資訊
  - 容易受到自由文字 prompt injection
  - 對大多數臨床問題不是必要資料
- **若未來真的要做**：必須走 F4 正式 tool loop，受控查詢 + 限制時間範圍 + 權限 + audit。

---

## 3. 真實環境驗證（最重要、目前完全沒做）

### V1. 護理師 / 藥師 prod 實測 5 個 case
- **狀態**：☐
- **問題**：6 個 commit 已上 prod，但**沒有實際 user 在 prod 用過**。後端測試綠 ≠ 臨床上有用。
- **方法**：用 prod 帳號（pharmacist 一個 + nurse 一個）開 `/ai-chat`，挑一床有完整資料的病人，依序問下面 5 題，記錄 LLM 回答品質。
- **5 個必試 case**：

| # | 問題 | 期望看到 | 對應 Phase |
|---|------|---------|-----------|
| 1 | 「這床抗生素要不要 de-escalate？」 | LLM 引用 culture organism + susceptibility（不是只看 WBC/CRP 猜） | Phase 4 |
| 2 | 「這床有沒有腎功能調整問題？」 | LLM 給出 CrCl 數值（或明說「缺體重無法計算」），列出需腎調整的 active meds | Phase 1+2 |
| 3 | 「我昨天在哪一床寫過 vancomycin 建議？」（用 pharmacist 帳號） | LLM 列出 advice 內容 + 床號 + 時間，且只列「自己」寫的 | Phase 6 |
| 4 | 「這 2 天改了什麼藥？」 | LLM 列出 started / discontinued / dose changed | Phase 5 |
| 5 | 「最新 CT 報告寫什麼？」 | LLM 引用 diagnostic_reports body text（不是只給 impression） | Phase 7 |

- **記錄表格**（驗證時填）：
  | # | LLM 回答品質 (1-5) | 缺哪些資料 | 後端 log 有看到 prefetch 觸發嗎 | 備註 |
  |---|------------------|----------|----------------------------|------|
  | 1 |                  |          |                            |      |
  | 2 |                  |          |                            |      |
  | 3 |                  |          |                            |      |
  | 4 |                  |          |                            |      |
  | 5 |                  |          |                            |      |

- **驗收**：5 個 case 至少 4 個達到「期望看到」。沒達到的記下來變 F4（tool loop 升級）的 input。
- **預估工時**：30-60 min
- **風險**：低（只讀，不寫）

### V2. 權限與個資邊界驗證
- **狀態**：☐
- **問題**：Phase 6 藥師建議搜尋是跨病人的，權限沒做對會洩露不該看的病人資訊。
- **必試**：
  - 用 nurse 帳號問「有沒有藥師建議」→ **不應**得到跨病人結果
  - 用 doctor 帳號問同樣問題 → 同上
  - 用 pharmacist A 帳號問「我之前的建議」→ 只看 A 自己寫的
  - 用 admin 帳號問同樣問題 → 看得到所有藥師的
  - 檢查 `backend/.logs/audit/` 或 audit_logs 表，確認每次跨病人查詢都有 log
- **驗收**：4 個權限 case 全對 + audit log 有寫
- **預估工時**：20-30 min

---

## 4. 建議實作順序

按 **user-value-first** 原則（不照計畫文件號碼順序）：

| 優先級 | 項目 | 工時 | 為何排這順序 |
|-------|------|------|------------|
| 🔴 1 | **V1 prod 實測 5 case** | 30-60 min | 沒實測就不知道 prefetch 在 prod 真的有用嗎；其他項目可能因實測結果改方向 |
| 🔴 2 | **V2 權限驗證** | 20-30 min | 個資洩漏是 hard fail，必須先排除 |
| 🟡 3 | **F1 同步主計畫文件** | 15 min | 沒做別人看文件會誤判；最便宜 |
| 🟡 4 | **F2 重新整理快照按鈕** | 1.5-2h | V1 若發現 30 min 後資料明顯過期會推這條優先級 |
| 🟢 5 | **F3 deep link 到藥師建議頁** | 2-3h | 等 V1 確認藥師會用這功能再做 |
| ⚪ 6 | **F4 正式 tool loop** | 6-10h | 等累積 1-2 週 prod usage data，知道漏什麼再做 |
| ❌ — | **F5 留言板全文** | — | 不做 |

---

## 5. 部署協議（依 CLAUDE.md）

- 後端改 → `git push personal main` → Railway
- 前端改 → `git push railway main` → Vercel
- 都改 → 兩個都 push
- Branch 規則：feature branch + `--no-edit` merge，不可直接 commit `main`
- 部署後驗證：Railway `/health` + Vercel bundle hash + VITE_API_URL leak check

---

## 6. 變更記錄

- **2026-05-03**：建立本文件，盤點主計畫 8 條 → 7 條完成、1 條不做、列出 3 條前端 follow-up + 2 條 prod 驗證 + 1 條長期升級。
