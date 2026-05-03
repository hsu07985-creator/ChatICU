# AI 對話助手審查與修補計畫（2026-05-03）

> 本文整合 2026-05-03 對「AI 對話助手 / ChatICU」的六面向深度審查（前端 UI / API & SSE / 後端路由 / LLM & Prompt / 病患快照建構 / 持久層），列出所有發現並按優先序給出修補計畫。
>
> **進度追蹤**：→ `docs/ai-chat-fixes-progress.md`（每完成一個 T 即更新，含 Wave 對應、檔案、驗證步驟、commit/部署註記）。
>
> **審查範圍**：
> - 前端：`src/pages/ai-chat.tsx`、`src/components/patient/chat-message-thread.tsx`、`src/lib/api/ai.ts`、`vercel.json`
> - 後端：`backend/app/routers/ai_chat.py`、`backend/app/llm.py`、`backend/app/services/patient_context_builder.py`、`backend/app/models/ai_session.py`、`backend/app/config.py`
> - Migrations：`backend/alembic/versions/{001,004,008,010,058,074,075}_*.py`
>
> **嚴重度標記**：🔴 高（必修）｜🟡 中（應修）｜🟢 低（可修）｜ℹ️ 觀察（記錄即可）。

---

## 0. 整體風險判讀

| 面向 | 風險等級 | 一句話 |
|------|---------|--------|
| 權限 / ACL | 🔴 高 | `chat_stream` 不檢查 patient_id 歸屬，任何登入者可拉任何病患快照 |
| Fallback 路徑 | 🔴 高 | 前端 `sendChatMessage` 打 `/ai/chat`，後端根本沒這支 endpoint → fallback 一定 404 |
| 訊息持久化 | 🔴 高 | Persistence 在 SSE generator 內，client 斷線 → user + assistant 訊息雙雙不寫入 DB |
| 串流可控性 | 🟡 中 | 無 AbortController、無 stop 鈕、無 idle timeout，LLM 卡住會無限等待 |
| Session 切換競態 | 🟡 中 | `isSending=true` 不擋 `openSession()`，串流結果可能落入錯的 session |
| LLM 不對稱 | 🟡 中 | `_call_openai_multi` 漏 gpt-5 `minimal` fallback；Anthropic 路徑無 cache_control |
| DB pool 容量 | 🟡 中 | 並發 ~2 個首輪 chat / Railway replica 就會 Supabase pool 飽和 |
| Snapshot 設計 | 🟢 低 | UTC 時間戳違反 Taipei 偏好；threshold 硬編碼四散；單位假設未驗證 |
| 前端品質 | 🟢 低 | `canSendAiChat=true` 寫死的死碼、feedback/regenerate 接 noop、`hasDataQuality` 無 JSX |
| Cache stability | ℹ️ 觀察 | 已知陷阱（canary 70%→0%）已用「snapshot 只進 system、deferred 只進 user message」防禦；refactor 時須盯 |

> **三大核心決策（修任何 bug 前須先對齊）**
> 1. **Patient ACL 模型**：要走「user 必須對該 patient 有讀取權限」（需查 unit / care team）還是「只要病患存在就允許 ICU 角色查」？目前完全沒檢查。
> 2. **Fallback 是否保留**：要刪掉 `sendChatMessage` 與相關 fallback 程式（接受「串流前失敗就拋錯」），還是後端補一支非串流 `POST /ai/chat`？
> 3. **斷線恢復語意**：client mid-stream 斷線後，user 提問是否要持久化？若要，要不要存「未完成」狀態讓重連可看到？

---

## 1. 端到端資料流（簡圖）

```
[使用者打字 + Enter]
  ↓ ai-chat.tsx:319 sendMessage（樂觀推 user + 空 assistant bubble）
[fetch POST /ai/chat/stream] credentials:include, X-Request-ID, 60s 初始 timeout
  ↓ Vercel proxy /ai/:path* → Railway（vercel.json:8-9, 無 X-Request-ID 閘門）
[ai_chat.py:363 chat_stream]
  ├─ get_current_user（cookie/JWT + Redis idle + blacklist）
  ├─ _get_or_create_session（sess_<16hex>，title 永遠 NULL）
  ├─ if first_turn（snapshot_metadata IS NULL）：
  │    └─ build_critical_snapshot()  [B15-A1, ~3-5s]
  │         ├─ 多 connection 並行：patient + lab + meds + vital
  │         ├─ 第二輪 gather：lab_24h_前 + duplicate_warnings
  │         └─ 寫 snapshot_metadata = {snapshot_taken_at, snapshot_key_values, clinical_snapshot, deferred_status:"pending"}
  │    └─ asyncio.create_task(_fill_deferred_snapshot_bg)  [背景跑 vent + reports + scores]
  ├─ else（後續輪）：
  │    └─ build_delta()  若 snapshot >30 min 且 6 個 key value 之一變動 ≥20%
  │         → user_message 前置 [資料更新 HH:MM] block
  ├─ _maybe_inject_deferred_into_user_message()  若背景已 ready → 注入 user message
  ├─ _load_messages(window=20)
  ├─ system_prompt = TASK_PROMPTS["icu_chat"] + "\n\n[病患臨床快照]\n" + clinical_snapshot
  └─ call_llm_stream("icu_chat", messages, ...)
       └─ _stream_openai（model=gpt-5.4-mini）
            ├─ icu_chat 強制 reasoning_effort="minimal"  [TTFT 2-5s → 次秒]
            └─ yield 每 token + 末尾 yield {"__done__":true,"usage":{...}}
  ↓
[SSE event: delta] → ReadableStream + TextDecoder, parse 於 \n\n 邊界
  ↓
[前端 onMessage → rawBuffer + RAF 合併 → extractStreamMainContent 切「【主回答】」]
  ↓
[LLM 結束 → 寫 ai_messages（user + assistant 同 commit），stored_user_message 用乾淨原文]
[emit event: done {"message":{...}, "sessionId":"..."}]
  ↓
[onComplete → 用完整 ChatMessage 取代 placeholder（citations / safetyWarnings / explanation 此時才出現）]
[若 first turn：採用 response.sessionId + setTitle(slice(0,50))]
```

---

## 2. 高優先修補（🔴）

### 2.1 加上 patient-level ACL — `backend/app/routers/ai_chat.py`

**現況**：`chat_stream`（`:363-504`）、`list_sessions`（`:528`）、`get_session`（`:583`）只檢查 `AISession.user_id == current_user.id`，**完全不驗 `patient_id` 是否屬於該使用者照護範圍**。任何登入者只要知道 MRN 就能 POST `/ai/chat/stream` 拿到該病人完整快照（藥、檢驗、生命徵象、影像 impression）。

**修補**：
1. 在 `chat_stream` 取得 `patient_id` 後（`:381` 附近）插入授權檢查 helper：
   ```python
   if body.patient_id:
       await _assert_patient_access(db, current_user, body.patient_id)
   ```
2. 新增 `_assert_patient_access(db, user, patient_id)` helper：
   - 第一版：查 `patients.unit_id` vs `users.unit_id` 是否相符（若沒有 unit 對應表，先用「病人存在 + 使用者 role ∈ {doctor, nurse, pharmacist}」過濾）
   - 失敗拋 `HTTPException(403, "無此病患存取權限")`
3. 同樣 helper 套用到 `list_sessions` 的 `patientId` filter 與 `get_session` 回傳前。
4. **驗證**：新增 `backend/tests/test_api/test_ai_chat_acl.py`，測 user A 無法用 user B 病人的 patient_id 開 chat。

**估時**：1.5h（含測試）。**Owner**：後端組。

---

### 2.2 處理 fallback 404 — `src/lib/api/ai.ts:225` & `backend/app/routers/ai_chat.py`

**現況**：`streamChatMessage`（`ai.ts:368-383`）在 stream 開始前失敗會 fallback 到 `sendChatMessage`，後者打 `POST /ai/chat`。但 `ai_chat.py` **只有 `/ai/chat/stream`，沒有 `/ai/chat`** —— 任何 fallback 觸發都會收 404，再進入 `onError` 顯示通用錯誤。

**選項 A（推薦）**：刪 fallback。
- 移除 `sendChatMessage`（`ai.ts:225-235`）與 `streamChatMessage` 內的 fallback 分支（`:368-383`）。
- pre-stream 失敗直接拋給 `onError`，UI 顯示具體錯誤（HTTP status / 網路錯誤）。
- 同時刪掉 `ChatResponse` 中只給 fallback 用的 dead path（檢查 type 引用）。

**選項 B**：後端補 `POST /ai/chat`。
- 包一支同樣的邏輯但用 `await` 累積完整 reply 後一次回傳（無 SSE）。
- 適合給後台批次 / 自動化測試使用。
- **缺點**：兩套程式碼路徑 → 容易漂移。

**驗證**：故意把 Railway 後端關掉，前端按 send，確認 UI 出現具體錯誤訊息（而非靜默 404）。

**估時**：選項 A 30min；選項 B 2h。**Owner**：前端 + 後端各一半。

---

### 2.3 串流斷線時保留 user 提問 — `backend/app/routers/ai_chat.py:312-335`

**現況**：persistence block 在 SSE generator 內、`event: done` 之前。流程是：
1. LLM 跑完才 `db.add(user_msg)` + `db.add(assistant_msg)` + `commit`
2. 若 client 在 LLM 跑到一半就關 tab / 斷線，generator 被 GC，**user 提問與部分 assistant 內容都不寫入 DB**

**影響**：
- 使用者重新整理後完全看不到剛剛問了什麼
- session 標題第一次設定是在 `onComplete`（前端），DB 也不會留 title
- 監控上看起來「使用者沒問問題」但其實有

**修補方案**（漸進）：
1. **Step 1（最小改動）**：把 user message 的 insert 移到 `chat_stream` 函式體內、generator 啟動前（`:474` 之後、`:485` 之前），並 `await db.commit()`。assistant message 仍維持在 generator 結尾。
2. **Step 2（完整）**：assistant message 用 `streaming` flag 預先 insert，generator 邊串邊 update `content` + `token_count`，最後標 `streaming=False`。需要：
   - `AIMessage` 加 `streaming` boolean column（migration）
   - `_load_messages` 預設過濾 `streaming=False`
   - `get_session` 傳給前端時也過濾或用旗標標示

**短期建議**：先做 Step 1，Step 2 留待之後決定是否要「重連看到部分回覆」UX。

**驗證**：
```bash
curl -N -X POST $BASE/ai/chat/stream -H "Content-Type: application/json" \
  --cookie "session=..." -d '{"message":"hi","patientId":"..."}' &
sleep 0.5 && kill %1
# 重新 GET /ai/sessions/{id} 確認 user message 有持久化
```

**估時**：Step 1 1h；Step 2 4h。**Owner**：後端組。

---

## 3. 中優先修補（🟡）

### 3.1 加 stop 按鈕 + idle timeout — `src/pages/ai-chat.tsx` & `src/lib/api/ai.ts`

**現況**：
- `streamChatMessage`（`ai.ts:269-270`）的 60s `setTimeout` 只蓋初始 fetch，body 開始後 `clearTimeout` —— **串流期間沒有 idle timeout**
- `ai-chat.tsx` 完全沒 `AbortController`、沒 stop 鈕，串流中只能等

**修補**：
1. `streamChatMessage` `options` 加 `signal?: AbortSignal`，與內部 `controller.signal` 用 `combineSignals` 合併（參考 `streamPolishClinicalText:687-690` 的 90s 全程 timeout 寫法）
2. 增加 idle timeout：每收到一個 chunk 重設一個 30s timer，逾時 → controller.abort + 拋 `串流逾時`
3. `ai-chat.tsx`：`sendMessage` 內 `const abortRef = useRef<AbortController>()`，傳 `signal` 給 `streamChatMessage`。Send 鈕在 `isSending=true` 時換成 Stop 鈕，onClick `abortRef.current?.abort()`
4. abort 時的 placeholder 改成「（已中止，剩餘內容未顯示）」，不寫入 DB

**估時**：2h。**Owner**：前端組。

---

### 3.2 擋住 streaming 中切換 session — `src/pages/ai-chat.tsx`

**現況**：`openSession`（`:283-291`）沒檢查 `isSending`，使用者在串流中切到其他 session，新 session 的 `chatMessages` 載入後，舊串流的 RAF flush 仍在跑，會把 LLM 回覆寫到**錯的 session bubble**。後續 `setSelectedSessionId(response.sessionId)` 也可能覆蓋掉切換後的選擇。

**修補**：
1. `openSession` 開頭：`if (isSending) { toast('正在生成回覆，請稍候或按停止'); return; }`
2. 同樣保護 `startNewSession`（`:293`）、刪除 session 的 `confirmDelete`（`:300`）
3. 與 3.1 一起做：若使用者按 Stop 後再切換，正常通過

**估時**：30min。**Owner**：前端組。

---

### 3.3 修 `_call_openai_multi` 的 gpt-5 fallback — `backend/app/llm.py:780-783`

**現況**：`llm.py:619-625` 的 streaming 路徑與 `:715-723` 的 `_call_openai` 都有三段式判斷：
```python
if reasoning_effort and task != "icu_chat" and not disable_reasoning:
    params["reasoning_effort"] = reasoning_effort
elif settings.LLM_MODEL.startswith("gpt-5"):
    params["reasoning_effort"] = "minimal"  # 否則 server 預設 medium 燒光 token
else:
    params["temperature"] = settings.LLM_TEMPERATURE
```
但 `_call_openai_multi`（`:780-783`）只有兩段：reasoning 或 temperature，**漏了 gpt-5 `minimal` fallback**。當 `LLM_REASONING_EFFORT=""`（或 disable_reasoning=True）且 model 是 gpt-5.x，會送 `temperature=0.3`，OpenAI 拒絕 → 觸發 server 預設 medium → 整個 token budget 燒在 reasoning 上 → 回空字串。

**修補**：把 `_call_openai_multi` 的判斷改成與 `_call_openai` 一致的三段式。建議直接抽出 helper：
```python
def _build_openai_param_block(*, task: str, disable_reasoning: bool) -> dict:
    """單一來源的 reasoning/temperature 決策。"""
    ...
```
讓 `_stream_openai`、`_call_openai`、`_call_openai_multi` 全部呼叫。

**驗證**：新增 unit test `test_call_openai_multi_gpt5_minimal_fallback`，mock `settings.LLM_MODEL="gpt-5.4-mini"`、`LLM_REASONING_EFFORT=""`，斷言送出的 params 含 `reasoning_effort="minimal"`、不含 `temperature`。

**估時**：1h（含 helper 抽取與 3 條測試）。**Owner**：後端組。

---

### 3.4 Anthropic 路徑加 prompt cache — `backend/app/llm.py`

**現況**：所有 Anthropic 呼叫（`_call_anthropic*`、`_stream_anthropic` `:668-674, 850-852, 884-887`）都只送 `system=system_prompt, messages=messages`，**完全沒設 `cache_control`**。整套 OpenAI cache 優化（snapshot 只進 system、deferred 只進 user message）對 Anthropic 失效；切 provider 後每輪都全文重送，成本與 TTFT 暴增。

**修補**：
1. `_stream_anthropic`、`_call_anthropic*` 改用 system blocks 寫法：
   ```python
   system=[
       {"type": "text", "text": task_prompt_only,
        "cache_control": {"type": "ephemeral"}},
       {"type": "text", "text": f"[病患臨床快照]\n{snapshot}",
        "cache_control": {"type": "ephemeral"}},
   ]
   ```
2. 但這要求 `ai_chat.py:_build_system_prompt`（`:116-118`）回傳結構化 list 而非單字串 —— 為避免動 OpenAI 路徑，建議在 `llm.py` 內判斷 provider 後再切分（拿 `[病患臨床快照]\n` 當 splitter）
3. 確認 `model` 支援 prompt caching（claude-3.5-sonnet 以上）

**估時**：2h。**Owner**：後端組。**前置**：先在 staging 跑一次 Anthropic 確認預設模型可用。

---

### 3.5 緩解 Supabase pool 飽和 — `backend/app/services/patient_context_builder.py:760-764`

**現況**：`build_critical_snapshot`（`:765-776`）為了真並行，每次首輪 chat 開最多 6 條 Supabase connection（patient/lab/meds/vital + 第二輪 lab24h/duplicate）。Supabase pool 5+overflow 5 → **安全並發只剩 ~2 個首輪 chat / Railway replica**。實測在 demo 多人同開時容易 `QueuePool limit exceeded`。

**修補（短期）**：
1. 把第二輪 gather（lab24h + duplicate）改回串行 / 用同一條 connection，省 2 條
2. patient + vital 合成一條 query（同一張表系列）省 1 條
3. 目標：每首輪 chat 上限 3 connection

**修補（中期）**：
- 改用 `pgbouncer` transaction mode（已是 6543 pooler，但 critical snapshot 透過直連 5432？）—— 確認 `DATABASE_URL` 走 pooler
- 升 Supabase Pro plan 拿到 IPv4 direct + 大 pool

**驗證**：寫 `scripts/loadtest_critical_snapshot.py`，10 個 user 同時觸發首輪 chat，確認無 `QueuePool` 例外。

**估時**：2h（短期）。**Owner**：後端組。

---

### 3.6 防 `_fill_deferred_snapshot_bg` race — `backend/app/routers/ai_chat.py:163-202`

**現況**：背景 task 在另一條 session read-modify-write `snapshot_metadata`。若同一個 session 短時間內：
- 主路徑寫第一次 metadata
- 背景填補 deferred 寫第二次
- 使用者立刻發第二輪、`build_delta` 又改一次

→ 三條並發 last-write-wins，可能丟掉 deferred 內容。

**修補**：
1. `_fill_deferred_snapshot_bg` 內用 `SELECT ... FOR UPDATE` 鎖該 session row 後再 update
2. 或改用 PostgreSQL JSONB 的 partial update：
   ```sql
   UPDATE ai_sessions
      SET snapshot_metadata = snapshot_metadata
          || jsonb_build_object('clinical_snapshot_deferred', :text,
                                'deferred_status', :status,
                                'deferred_filled_at', :ts)
    WHERE id = :sid
   ```
   讓 PostgreSQL 處理 merge（MVCC 保證不丟）
3. 加結構化 log：`[CHAT][DEFERRED] session={sid} write_attempt=N base_status={old} new_status={new}` 便於追蹤

**估時**：1.5h。**Owner**：後端組。

---

## 4. 低優先修補（🟢）

### 4.1 Snapshot 時間戳改 Taipei — `backend/app/services/patient_context_builder.py`

**現況**：`datetime.now(timezone.utc)` 散落在 `:240, 677, 795, 898, 941`，輸出快照頭「時間戳記：YYYY-MM-DD HH:MM」是 UTC，違反 user memory 的 Taipei 時區偏好。ICU-day 計算（`:251`）也用 UTC `now.date()`，跨日近午夜可能差一天。

**修補**：
- 抽 helper `_now_taipei() -> datetime` 集中改
- 輸出標 `(台北時間)` 標籤避免歧義
- ICU-day 計算前先轉 Taipei

**估時**：30min。**Owner**：後端組。

---

### 4.2 集中 threshold config — `backend/app/services/patient_context_builder.py`

**現況**：K 3.5/5.0、Na 135/145、AST/ALT 40、Hb 8、PLT 100、pH 7.35/7.45、SpO₂ 92、MAP 65、Temp 36.0/37.5、RR 20、CVP 12 … 全寫在 `_fmt_lab_section` / `_fmt_vital_section` / `_fmt_vent_section` 內，難以調整、難以測。

**修補**：抽出 `backend/app/services/clinical_thresholds.py`：
```python
LAB_THRESHOLDS = {
    "K":  {"low": 3.5, "high": 5.0, "unit": "mmol/L"},
    "Na": {"low": 135, "high": 145, "unit": "mmol/L"},
    ...
}
```
以及 `_mark(value, threshold_key)` helper。

**估時**：2h（含搬遷與測試）。**Owner**：後端組。

---

### 4.3 補 `m.dose` 字串解析 — `backend/app/services/patient_context_builder.py:224-234`

**現況**：`_vasopressor_ne_dose` 直接 `float(m.dose)`，`m.dose` 是 `String`，"0.08" OK 但 "0.08 mcg/kg/min" 直接炸 `ValueError`。實際 HIS 資料若帶單位會讓 NE 完全不出現在 delta。

**修補**：用 regex 抽數字：
```python
import re
m_match = re.match(r"^\s*([0-9]*\.?[0-9]+)", m.dose or "")
return float(m_match.group(1)) if m_match else None
```

**估時**：15min（加一條 test）。**Owner**：後端組。

---

### 4.4 清前端死碼 — `src/pages/ai-chat.tsx`

**現況**：
- `canSendAiChat = true` 寫死（`:201-203`），4 處 `!canSendAiChat` JSX 與 `aiChatGateReason` toast 都是 dead path
- thumbs up/down + regenerate 按鈕接 `noop`（`:436, 669, 670`），UI 顯示但無功能
- `expandedDataQuality` / `onToggleDataQuality` / `hasDataQuality` 宣告但 `chat-message-thread.tsx` 找不到對應 JSX

**修補**：
1. 刪 `canSendAiChat` 與相關 4 處 JSX 與 toast
2. **決策**：feedback 與 regenerate 是否要實作？
   - 要做 → 接 `updateMessageFeedback`（`ai.ts:899` 已有 API）+ 寫 regenerate 流程
   - 不做 → 從 `chat-message-thread.tsx` 移除按鈕，刪相關 props
3. 刪 dataQuality 相關 dead code

**估時**：1h。**Owner**：前端組。

---

### 4.5 Auto-scroll 與 floating pill 衝突 — `src/components/patient/chat-message-thread.tsx`

**現況**：`ai-chat.tsx:241-243` 在 `chatMessages` 變動就 `scrollIntoView({behavior:'smooth'})`，串流期間每幀都跑一次，使用者捲上去看舊訊息會被一直拉回底部，floating「跳到最新」pill 出現後又立刻被 auto-scroll 收回。

**修補**：
- 用 `IntersectionObserver` 偵測 `endRef` 是否在 viewport
- 只在「使用者本來就在底部」時 auto-scroll
- 否則只更新「跳到最新」pill 顯示

**估時**：1h。**Owner**：前端組。

---

### 4.6 自動產生 session title — `backend/app/routers/ai_chat.py`

**現況**：`title` 永遠 NULL，UI 顯示固定 `"新對話"`（`_session_to_dict:512`）。前端 first turn 用 `userMessage.slice(0, 50)` 自己 PATCH 一次，但若使用者在 PATCH 前刷新就只剩「新對話」。

**修補**：
- 後端 `chat_stream` first turn 直接寫 `session.title = body.message[:50]`，省一次 PATCH
- 前端移除 `updateChatSessionTitle` 呼叫
- 進階：用便宜 LLM 從第一輪對話產生 3-5 字標題（背景 task）

**估時**：30min（基本版）。**Owner**：後端組。

---

## 5. 觀察項目（ℹ️）

### 5.1 OpenAI prompt cache stability 防護

CLAUDE.md 與 `ai_chat.py:128-145, 435-443` 都記錄了：舊 `_merged_snapshot` 把 deferred 注入 system_prompt，canary 測出 `cache_hit_ratio_p50` 從 70% → 0%。**現在的設計依賴**：
- system_prompt = `TASK_PROMPTS["icu_chat"]` + `[病患臨床快照]\n` + critical_snapshot（byte-stable per session）
- deferred / delta 一律進 ephemeral user_message
- DB 存 `original_message`，不存 augmented 版本

**風險**：未來任何 refactor 把 snapshot 注入移到 `llm.py` 或共用 helper，都可能悄悄破 cache —— **只有 canary 抓得到**。

**建議**：
- `[CHAT][CACHE]` log 加上自動告警（hit_ratio < 50% 連續 N 次發訊息）
- 在 `llm.py:_stream_openai` 入口加 assertion：`assert "[病患臨床快照]" in system_prompt or system_prompt is base prompt`，refactor 立刻炸測試

---

### 5.2 SSE heartbeat / keep-alive

LLM 卡住或長 reasoning 期間，Vercel / Railway proxy 可能在無資料超時時切連線。目前 `chat_stream` `:500-503` 已設 `Cache-Control: no-cache, X-Accel-Buffering: no`，但**沒送 SSE comment heartbeat**。

**建議**：generator 內每 15s yield `: ping\n\n`（SSE 註解，前端 `parseSseFrame` 會自動忽略）。等到實際出現 timeout 災情再做。

---

### 5.3 無 tokenizer / 無 prompt 截斷

`llm.py` 完全不用 tiktoken，歷史只靠 20 row cap（`_CONTEXT_WINDOW * 2`）。若 snapshot + 歷史 + 使用者輸入超過 model context window，OpenAI 直接拒絕 → 整輪失敗。實務上 ICU snapshot ~2-4k tokens，gpt-5.4-mini 上限充裕，但若 snapshot 之後再加深（如加病程記錄全文）可能踩線。

**建議**：等到實際遇到 `context_length_exceeded` 再加 tiktoken-based truncation。

---

## 6. 修補時程建議

| 階段 | 任務 | 預估時間 | Owner |
|------|------|---------|-------|
| **本週（必修）** | 2.1 Patient ACL | 1.5h | 後端 |
|  | 2.2 移除 fallback 404 | 30min | 前端 |
|  | 2.3 Step 1 持久化 user message | 1h | 後端 |
| **下週（中）** | 3.1 Stop 鈕 + idle timeout | 2h | 前端 |
|  | 3.2 擋 session 切換 | 30min | 前端 |
|  | 3.3 LLM helper 抽取 | 1h | 後端 |
|  | 3.4 Anthropic prompt cache | 2h | 後端 |
|  | 3.5 Pool 緩解 | 2h | 後端 |
|  | 3.6 Deferred race | 1.5h | 後端 |
| **下下週（低）** | 4.1 Taipei 時區 | 30min | 後端 |
|  | 4.2 Threshold config | 2h | 後端 |
|  | 4.3 Dose regex | 15min | 後端 |
|  | 4.4 前端死碼 | 1h | 前端 |
|  | 4.5 Auto-scroll | 1h | 前端 |
|  | 4.6 自動 title | 30min | 後端 |

**總計**：必修 ~3h、中優先 ~9h、低優先 ~5h ≈ 17h（不含測試與部署驗證）。

---

## 7. 驗證流程（按 CLAUDE.md）

每個 commit 後依 CLAUDE.md `部署與驗證流程` 執行：

1. **本機**：`pytest backend/tests/test_api/test_ai_chat*.py -v`，前端 `npm run typecheck && npm run lint`
2. **後端推 Railway**：`git push personal main`，等 60-90s 後 `curl https://chaticu-production-8060.up.railway.app/health`
3. **前端推 Vercel**：`git push railway main`，確認 bundle hash 變動 + `VITE_API_URL` 不洩漏
4. **DB 驗**：透過 Playwright 登入 + `fetch('/auth/me')` + 對該位 patient 開 chat、看 `[CHAT][TIMING]` log
5. **Cache 驗**：連發 3 輪同 patient 對話，看 Railway log 的 `[CHAT][CACHE] hit_ratio` 應 ≥ 50%

---

## 8. 相關文件

- 本次審查的快照延遲設計：`docs/b15-snapshot-latency-plan-2026-04-30.md`
- 同日團隊聊天室審查：`docs/team-chat-audit-fixes-2026-05-03.md`
- AI 整合計畫（歷史）：`docs/ai-integration-plan.md`
- 重複用藥模組（snapshot 內 duplicate_warnings 來源）：見 `feedback_duplicate_medication_workflow` memory

---

**審查作業**：6 個 Opus 4.7 agents 平行調查（前端 UI / API & SSE / 後端路由 / LLM & Prompt / 病患快照 / 持久層），所有 file:line 引用已逐一驗證存在。
