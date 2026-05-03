# F4 LLM Tool Loop — 決策文件

> 日期：2026-05-03
> 對應追蹤項目：[`ai-chat-patient-context-followup-tasks-2026-05-03.md`](ai-chat-patient-context-followup-tasks-2026-05-03.md) §F4
> 主計畫：[`ai-chat-patient-context-enhancement-plan-2026-05-03.md`](ai-chat-patient-context-enhancement-plan-2026-05-03.md) §3.1
> 研究方法：3 個並行 Opus 4.7 agent — codebase audit、OpenAI 業界做法（含 web）、實作計畫。

---

## TL;DR — 結論

**現在不要做 F4。等 V1 prod 真人驗證 + 2 週使用 data 出來再決定。**

3 個獨立 agent 各自分析後**一致**得出此結論。理由：

1. **目前 4 條 prefetch 已覆蓋約 80% 場景** — 沒有實際漏接資料的證據之前，升級是 speculative。
2. **OpenAI prompt cache 是高風險破口** — tool definitions 屬於 cached prefix，搞錯就破 cache。團隊先前 canary 已踩過 70% → 0% 的痛（B15-A1.1）。
3. **Tool loop 在「臨床問題收斂、可列舉」的場景效益不明** — 業界經驗：tool loop 真正贏在「使用者可問任何東西、無法窮舉觸發條件」的開放式 agent，不是 CDS 這種有界場景。
4. **成本/延遲倒退** — 多輪 tool loop = 多次 LLM RTT + 訊息歷史指數成長；prefetch 一輪解決。
5. **預估工時 13.5h（高風險）**，比原 doc 寫的 6-10h 多。

**取代方案 — 應該先做的事**：
- V1 prod 5-case 測試（30-60 min）
- 加上 prefetch miss-rate metric（structured log + 2 週觀察）
- 真的有 user 抱怨「我問了它沒查到」再啟動 F4

---

## 1. 為什麼研究這個

主計畫 §3 當初列了兩條路：
- §3.1 正式 LLM tool loop（OpenAI function calling）
- §3.2 後端關鍵字 prefetch（過渡方案）

我們選了 §3.2 並上線了 4 條 prefetch（Phase 4-7，commit chain `e95634ac9..c2ef77505`）。Followup F4 留了「之後升級成 tool loop」的選項，但沒寫「何時、怎麼判斷該做」。

這份文件把那個決定具體化。

---

## 2. 目前架構盤點（Agent 1 結果摘要）

### 2.1 SSE + LLM call 流程

`POST /ai/chat/stream` → `chat_stream()` → `_event_stream()` 一次性呼叫 `call_llm_stream()`。**單輪、不能重入**。

關鍵不變式（B15-A1.1）：
- `system_prompt = TASK_PROMPTS["icu_chat"] + clinical_snapshot`
- snapshot bytes 寫進 `session.snapshot_metadata` 後**整個 session 不再變動**
- prefetch / deferred 內容**只塞 user_message**，永不進 system_prompt
- 違反 → OpenAI prompt cache hit_ratio_p50 從 70% 掉到 0%（已實測）

### 2.2 已存在、可直接變成 tool 的服務

| Tool 候選 | 函式 | 已有 ACL | 已有 Audit | 難度 |
|----------|------|---------|-----------|------|
| `get_recent_cultures` | `get_recent_cultures(db, patient_id, days, limit)` | implicit (patient_id) | ❌ | 低 |
| `get_recent_medication_changes` | `get_recent_medication_changes(db, patient_id, hours, limit)` | implicit | ❌ | 低 |
| `search_pharmacy_advice_history` | `search_pharmacy_advice_history(db, user, message, ...)` | ✅ admin/pharmacist gate | ✅ 已寫 | 中（要保持 F3 metadata） |
| `get_recent_diagnostic_reports` | `get_recent_diagnostic_reports(db, patient_id, days, limit)` | implicit | ❌ | 低 |
| `get_recent_labs`（新） | 待實作 | — | — | 中 |

### 2.3 改 tool loop 還缺什麼

- `call_llm_stream` 沒有 `tools=` 參數
- `_stream_openai` 只處理 `delta.content`，沒處理 `delta.tool_calls`
- `_event_stream` 是單輪 generator，沒有 multi-turn 迴圈
- `ai_messages` 表沒存 tool 訊息（純 user/assistant）

---

## 3. OpenAI 業界做法（Agent 2 + web research 摘要）

### 3.1 API 形狀（2026 現況）

```python
client.chat.completions.create(
  tools=[{"type": "function",
          "function": {"name": "...", "description": "...",
                       "parameters": {...JSON Schema...},
                       "strict": True}}],
  tool_choice="auto",  # or "none" / "required" / specific
  parallel_tool_calls=True,
  prompt_cache_key="conversation_xyz",  # NEW — pin to cache shard
)
```

Streaming：tool call 走 `delta.tool_calls[i].function.arguments` 遞增累積，不是 `delta.content`。

### 3.2 Prompt cache 互動 — **這是 ChatICU 最敏感的部分**

| 規則 | 說明 |
|------|------|
| Tools 屬於 cached prefix | OpenAI 把 `[output_schema → tools → system → messages]` 當單一前綴 hash |
| 加 `tools=[]` 進原本沒 tool 的 request 會破 cache | 第一次 tool-calling 必付 cache miss |
| **Tools array 必須 byte-identical** | 同 tools、同順序、同 schema、同 description string；改 description 即破 cache |
| **「有時帶 tools 有時不帶」會破 cache** | 解法：永遠帶完整 toolkit，用 `tool_choice="none"` 或 `tool_choice="allowed_tools"` 變化 |
| `prompt_cache_key` 可固定 cache shard | 每對話 key 一份，目標 ≤15 RPM/key（OpenAI Caching 201 cookbook 一個案例 60% → 87%） |

### 3.3 Production loop pattern

| 議題 | 業界共識 |
|------|---------|
| max iterations | CDS 場景 3-5；開放 agent 8-10。一定要硬上限，不要無限迴圈 |
| 達上限行為 | 強制 `tool_choice="none"` 跑最後一次拿到文字答案；不可 error |
| Tool error 格式 | 結構化 JSON `{"error": "code", "retriable": false, "hint": "..."}` |
| No-data 回應 | `{"status": "no_data", "reason": "...", "queried": {...}}` — 解釋為何沒資料才能停止 LLM 再查 |
| 防 tool spam | (1) 低 max iterations (2) per-(tool, args) dedup (3) system prompt 約束 (4) `strict: true` schema |
| Streaming UX | 看到 `delta.tool_calls` 就 emit "查詢培養中..." 思考 marker；不要把 args JSON 字串流給 user |

### 3.4 真實踩過的雷

- **成本爆炸**：每輪重送整個訊息歷史 + 累積的 tool outputs，呈 quadratic 成長。Tool outputs 在 prefix 尾端**永遠不 cache**。回應務必摘要。
- **Hallucinated tool calls**：toolset 多 / description 模糊時 LLM 編造 tool。`strict: true` + flat schema + 短 toolset 可緩解。
- **Hung loops**：gpt-5/5.1 有 repetition bug；務必加 wall-clock timeout。
- **延遲堆疊**：每輪 = 一次完整 TTFT + tool RTT。3 輪 loop 在 4s TTFT 模型 = 12s 起跳，vs prefetch 4s。

### 3.5 業界 verdict（針對 ChatICU 場景）

> **Don't upgrade now. Wait.**
>
> 1. Prefetch 已覆蓋 4 條，CDS 場景是 *bounded*，不是開放問答。Tool loop 在開放場景才贏。
> 2. Cache-hit 是團隊已經費力守住的 KPI，引入 tools 要同時搞對 3 件新事情（`allowed_tools` + byte-stable tools + `prompt_cache_key`）才不倒退。
> 3. 對 *bounded* CDS scope，prefetch 在延遲、成本、cache 三方面都贏。

詳見 sources（Agent 2 引用）：OpenAI function-calling guide、prompt caching guide、prompt caching 201 cookbook、Answer.AI tool calling 文章、Maxim 的 agent loop troubleshooting、OpenAI community 的 tool spam 討論。

---

## 4. 如果未來真的要做 — 完整實作計畫（Agent 3）

> 這節是「**未來真要做時**的設計」，不是現在就動手。

### 4.1 架構決策

- **Hybrid**：保留 prefetch 當 fast-path，**加上** tool loop 當 fallback。不要全替換。
  - Prefetch 解決明顯 80%（"culture"/"停藥" 等清楚命中）— 0 LLM RTT
  - Tool loop 解決 prefetch miss（"他現在發燒，要不要換抗生素"）
  - 風險隔離：tool loop 出問題，prefetch 還在
  - 1 個月穩定後再考慮刪 keyword

- **Multi-turn loop，max 3 iterations**。Single-shot 太死板（「看 culture 再看用藥變更」這種需要 2 tool calls）。

- **Tools 在 `_event_stream` 內截擊**。同一 generator、同一 SSE 協定、同一 heartbeat。Loop 包住現有的 streaming。

### 4.2 檔案改動

| 檔案 | 動作 | 內容 |
|------|------|------|
| `backend/app/ai_tools/registry.py` | 新增 | 5 個 tool JSON schema + `TOOLS_FINGERPRINT` for byte-stability assertion |
| `backend/app/ai_tools/handlers.py` | 新增 | `dispatch_tool_call(name, args, *, db, user, patient_id, ip)` — ACL 在這層強制；patient_id 比對 session 綁定值（防 LLM 編造參數查別人病歷） |
| `backend/app/llm.py` | 改 | `call_llm_stream` 加 `tools=` 參數；`_stream_openai` yield 改成 `(kind, payload)` tuple — kind ∈ `text/tool_call/done` |
| `backend/app/routers/ai_chat.py` | 改 | `_event_stream` 加 `for iteration in range(MAX_TOOL_ITERATIONS):` 迴圈 |
| `backend/app/config.py` | 改 | `AI_CHAT_TOOL_LOOP_ENABLED: bool = False` feature flag |
| `backend/tests/test_api/test_ai_chat_tools.py` | 新增 | mock OpenAI 跑 scripted tool_call → text 序列；包含 cap_hit / disconnect / cache_byte_stable_assertion |

### 4.3 Prompt cache 安全設計

**這是最容易出包的環節**，務必：

| 規則 | 怎麼做 |
|------|-------|
| Tools array byte-stable | `TOOLS` 是 module-level constant，不是 per-request build。CI test 確認 `TOOLS_FINGERPRINT` 不變 |
| 永遠帶 tools | 不要看「有沒有 patient_id」決定要不要附 tools — 兩種 cache namespace 會撞。沒 patient_id 的 tool handler 自己 reject 即可 |
| system_prompt 不變 | tools 是 separate `tools=` 參數，不串進 system string |
| 一次性 cache reset 可接受 | 上 tool loop 那次部署，TASK_PROMPTS["icu_chat"] 加段「你可以呼叫工具」說明，所有 session 會 cache miss 一輪。文件化 |
| 監控 | 現有 `[CHAT][CACHE][LOW_HIT]` 警告擴充為 turn-2+ hit_ratio < 50% 觸發 |

### 4.4 Loop 控制

- `MAX_TOOL_ITERATIONS = 3`
- 達上限 → 強制 `tool_choice="none"` 拿最後文字答案；log `[CHAT][TOOL_LOOP][CAP_HIT]`；**不 error**
- Heartbeat：每 iteration 獨立包 `_with_heartbeat`；dispatch 階段每 5s 也發一次（DB query 可能慢）
- Client disconnect：每 iteration 前 + dispatch try/finally 都檢查 `is_disconnected()`
- Audit：每次 tool call 寫 audit log（action="ai_chat_tool_call"）

### 4.5 風險與 rollback

- Feature flag `AI_CHAT_TOOL_LOOP_ENABLED`，default `false`，分支在 `_event_stream` 開頭
- Canary：staging 先開 48h，看 cache hit_ratio_p50 ≥ 60%、per-turn token 不超過 baseline 2x、tool_loop iteration p95 = 1
- Rollback：flag 改 false，零 schema migration

### 4.6 實際工時估計

| 項目 | 工時 | 風險 |
|------|------|------|
| `registry.py`（5 schema） | 1.5h | 低 |
| `handlers.py`（dispatch + ACL re-check） | 2h | 中（ACL 必須跟 prefetch 對齊） |
| `llm.py` tool 參數 + chunk shape change | 2.5h | 中（碰 streaming） |
| `_event_stream` multi-iter loop | 3h | **高**（核心 SSE + cache 風險） |
| Feature flag + config | 0.5h | 低 |
| Tests | 3h | 中 |
| Canary monitoring + rollback drill | 1h | 低 |
| **總計** | **13.5h** | overall **中-高** |

主 followup doc 寫的「6-10h」太樂觀（假設 canary 一次過）。實際 1.5-2 整天 budget。

---

## 5. 何時該升級？— 觸發條件清單

開始實作前必須**至少**有以下其中一個訊號：

| 訊號 | 判斷標準 | 取得方式 |
|------|---------|---------|
| **A. V1 prod 5-case 結果** | 至少 2 case ≤3/5 分，原因是 LLM 說「沒看到 X 資料」但 DB 確實有 — 表示 prefetch keyword 沒命中 | 30-60 min 人工跑（V1 還沒做） |
| **B. Prefetch miss-rate 過 15%** | aggregate `[CHAT][PREFETCH][MISS_LIKELY]` count / `[CHAT][PREFETCH] fired=False` count 在 2 週滾動視窗 | ✅ **2026-05-03 上線**（M1，commit pending）— `backend/app/routers/ai_chat.py` 每輪寫 `[CHAT][PREFETCH]` 結構化 log；reply hedge + 無 prefetch + 有 patient → `[CHAT][PREFETCH][MISS_LIKELY]` warn |
| **C. 複合問題需求** | 藥師明確要求「我想一句話問 culture + 用藥變更」— 目前 1 prefetch/turn 限制擋住 | user feedback / Slack |
| **D. 月增 ≥ 2 條新 prefetch 類別** | 寫不過來、keyword list 膨脹失控 | 看自己 commit 頻率 |
| **E. p50 prompt size > 8-12k tokens** | 因為「以防萬一全塞」造成 — tool loop on-demand fetch 此時才開始划算 | OpenAI usage dashboard |

**任何一條觸發 → 啟動 §4 計畫。**

**全部沒觸發 → 不做。Prefetch 已經夠好。**

---

## 6. 立即建議行動（按 user-value-first）

| 優先 | 動作 | 工時 | 為何 / 狀態 |
|-----|------|------|------|
| 🔴 1 | **V1 prod 5-case 真人測試** | 30-60 min | ☐ 待人工 — 沒這個 data 整個 F4 決策都是猜的 |
| 🔴 2 | **V2 權限 4-case 真人測試** | 20-30 min | ☐ 待人工 — 個資洩露 hard fail 必先排 |
| 🟡 3 | **加 prefetch miss-rate metric** | 1-1.5h | ✅ **2026-05-03 已實作 M1**（`_reply_looks_hedged` + `[CHAT][PREFETCH]` / `[MISS_LIKELY]` 結構化 log） |
| 🟢 4 | F4（本文件 §4） | 13.5h | 等訊號 A/B/C/D/E 任一觸發 |

**訊號 B 觀察 SQL（2 週後可跑）**
```bash
# Railway logs → 抓 [CHAT][PREFETCH] 行統計
# miss-rate = MISS_LIKELY count / (PREFETCH lines where fired=False & patient!=-)
grep '\[CHAT\]\[PREFETCH\]' railway.log | wc -l            # all turns
grep '\[CHAT\]\[PREFETCH\] .*fired=False' railway.log | grep -v 'patient=-' | wc -l   # patient turns w/o prefetch
grep '\[CHAT\]\[PREFETCH\]\[MISS_LIKELY\]' railway.log | wc -l   # F4-trigger candidates
```
觸發門檻：`MISS_LIKELY` / `fired=False && patient!=-` ≥ 15% 連續 2 週。

---

## 7. 為什麼這份決策值得記錄

- **避免「為了升級而升級」**：tool loop 是行業熱話題，但對 bounded CDS 場景**未必是進步**。沒有實際 KPI 推力之前，停在 prefetch 是正確的。
- **保住 prompt cache** 是已付成本的防守 — 不該為了 hype 重新踩坑。
- **3 個獨立 agent 一致結論** 是強訊號（codebase / web / plan 三個視角都得出同樣建議）。
- **未來真要做時**，§4 是現成的計畫；不用每次重新研究。

---

## 8. 變更記錄

- **2026-05-03**：建立本文件。3 個 Opus 4.7 agent 並行研究結論：F4 暫不做，等 V1 + miss-rate metric 訊號。§4 留完整實作計畫供未來啟動。
- **2026-05-03**：**M1 上線** — 結構化 metric log 已實作並部署。Touch points:
  - `backend/app/services/ai_question_prefetch.py`：`build_question_prefetch_with_metadata` 回傳的 `metadata` 加 `prefetchCategories: List[str]`，後端不需重 scan keyword 即可寫 log
  - `backend/app/routers/ai_chat.py`：每輪 chat_stream 寫 `[CHAT][PREFETCH] session=… patient=… msg_chars=… categories=… advice_refs=… fired=…`；`_event_stream` 結束時若 reply hedged + 有 patient + 無 prefetch → `[CHAT][PREFETCH][MISS_LIKELY] warn`
  - `_reply_looks_hedged()` helper（中英 12 個 hedging pattern，case-insensitive 英文，substring 中文）；獨立單元測試 `test_chat_prefetch_metrics.py` 18/18 綠
  - PII：log 裡完全沒有 message/reply 文字，只有長度 + categories + 布林值
  - 訊號 B 從「☐ 需 1h 程式」變「✅ collecting，2 週後可決策」
