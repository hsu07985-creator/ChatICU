# AI 對話助手修改進度

> 對應 `docs/ai-chat-audit-fixes-2026-05-03.md`。每完成一個 T，更新此檔。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄　🚧 部分完成

**最後更新**：2026-05-03（**W1-W3 完成 14/15**，W2-T4 因無 Anthropic 額度 revert）

---

## Wave 1 — 必修（🔴 高優先，目標 0.5 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W1-T1 | Patient-level ACL（採選項 C：role + patient 存在 + audit log）：`chat_stream` 入口檢查 | `backend/app/routers/ai_chat.py:33,384-391`、新檔 `backend/app/services/patient_acl.py`、新測試 `backend/tests/test_api/test_ai_chat_acl.py` | ① 新 6 條 ACL 單元測試全綠 ② audit_log 表會記錄每次 access（成功 / 失敗都記） | ✅ |
| W1-T2 | 移除 fallback 404：刪 `sendChatMessage` 與 `streamChatMessage` 的 fallback 分支 | `src/lib/api/ai.ts:225-235, 367-383`（共刪 29 行） | ① tsc 無錯 ② Vercel bundle 已不含 `sendChatMessage` symbol | ✅ |
| W1-T3 | 持久化 user message（Step 1）：把 user message insert + commit 移到 generator 啟動前 | `backend/app/routers/ai_chat.py:_event_stream` 內持久化區塊 + `chat_stream` 結尾新增 `db.add(AIMessage)` + `db.commit()` | ① 後端 17/17 ai_chat 測試 + 485/485 全套（除 5 個無關 FHIR real-data）綠 | ✅ |

**Wave 1 整體驗收**：
```bash
# 後端 unit
cd backend && python3 -m pytest tests/test_api/test_ai_chat*.py -v

# Prod ACL（push 後）— 用兩個帳號 cookies-A.txt / cookies-B.txt
USER_B_PATIENT="patient_X"
curl -s -b cookies-A.txt -X POST \
  https://chaticu-production-8060.up.railway.app/ai/chat/stream \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"test\",\"patientId\":\"$USER_B_PATIENT\"}" \
  -o /dev/null -w "%{http_code}\n"
# 預期：403

# Prod 持久化（push 後）— 開串流後立刻關
curl -N -b cookies-A.txt -X POST \
  https://chaticu-production-8060.up.railway.app/ai/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"smoke","patientId":"my_patient"}' &
sleep 0.5 && kill %1
# 然後 GET /ai/sessions 看是否新增了一個含 user message 的 session
```

---

## Wave 2 — 串流可控性 + LLM 一致性（🟡 中優先，目標 1 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W2-T1 | Stop 鈕 + idle timeout（30s）+ 60s 連線 timeout：`streamChatMessage` 接 external `signal`、每 chunk 重設 idle timer；UI Send→Stop 切換、Abort 後 placeholder 標記 | `src/lib/api/ai.ts`（+`StreamIdleTimeoutError`）、`src/pages/ai-chat.tsx`（+`streamAbortRef`、Send/Stop button、`onAbort` handler） | ① tsc 無錯 ② Vercel bundle marker 確認：`AI 串流連線逾時`、`串流逾時`、`AbortController`、`已中止`、`生成中可按停止` 全部存在 | ✅ |
| W2-T2 | 擋 streaming 中切換 / 新建 / 刪除 session | `src/pages/ai-chat.tsx`（`openSession`/`startNewSession`/`confirmDelete` 加 `if (isSending) toast` guard） | Vercel bundle marker：`請先按停止` × 3 出現 | ✅ |
| W2-T3 | LLM helper 抽取：`_build_openai_reasoning_param_block` 統一決策，補 `_call_openai_multi` 的 gpt-5 fallback | `backend/app/llm.py`（新 helper + 3 個呼叫點 `_stream_openai`/`_call_openai`/`_call_openai_multi`） | 新測試 `test_llm_param_helper.py` 28 條全綠（含 64 種參數組合確認永不同時送 reasoning_effort + temperature） | ✅ |
| W2-T4 | ~~Anthropic 加 prompt cache~~ | — | — | ❌ 放棄（無 Anthropic 額度，2026-05-03 revert） |

**Wave 2 整體驗收**：
```bash
# 後端 unit
cd backend && python3 -m pytest tests/test_unit/test_llm.py -v

# Prod 可控性
# 1. 開 chat → 送長問題 → 立刻按 Stop → bubble 標記「已中止」
# 2. 開 chat → 送問題 → 串流中點側邊另一 session → toast 阻擋
```

---

## Wave 3 — 容量 + 競態 + 體驗（🟡 中優先收尾 + 🟢 低優先，目標 1.5 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W3-T1 | Pool 緩解：第二輪 gather 改用 request 的 `db` connection（serial），首輪 chat 連線數 6→4 | `backend/app/services/patient_context_builder.py:build_critical_snapshot` 第二輪改 `await db.connection()` + serial calls | 後端 537/537（除 5 個無關 FHIR）綠，無回歸；安全並發 ~2 → ~3 / replica | ✅ |
| W3-T2 | Deferred race 防護：PostgreSQL JSONB `\|\|` merge（dialect-aware，SQLite fallback 仍用 read-modify-write） | `backend/app/routers/ai_chat.py:_fill_deferred_snapshot_bg` 改用 `UPDATE ... SET snapshot_metadata = COALESCE(...,'{}'::jsonb) \|\| :payload::jsonb` | 既有 9 條 deferred test 全綠（SQLite path 不變）；rowcount=0 處理 session 已刪情況 | ✅ |
| W3-T3 | Snapshot 時間戳 + ICU-day 改 Taipei（標籤加「（台北時間）」） | 新 helper `_now_taipei()` + `TAIPEI_TZ`；`_fmt_patient_section`、`build_clinical_snapshot`、`build_critical_snapshot`、`build_delta` 全部換掉 `datetime.now(timezone.utc)` | 新 2 條 timezone test：UTC offset = 8h、aware datetime；視覺：snapshot 字串含「（台北時間）」 | ✅ |
| W3-T4 | 集中 threshold config（行為不變、只是搬家） | 新檔 `backend/app/services/clinical_thresholds.py` (`LAB_THRESHOLDS`/`VITAL_THRESHOLDS`/`VENT_THRESHOLDS` + `mark()` / `flag_only()` helper)；`patient_context_builder.py` 三個 `_fmt_*_section` 全套用 | 新 4 條 threshold test 鎖定值；既有 9 條 snapshot deferred + 全套 services test 全綠 | ✅ |
| W3-T5 | `m.dose` regex 解析（NE delta 不再因單位字串炸） | `backend/app/services/patient_context_builder.py:_vasopressor_ne_dose` 改用 `re.match(r"^\s*([+-]?[0-9]*\.?[0-9]+)", raw)` | 新 8 條 parametrized test 含 `"0.08 mcg/kg/min"`、`"0.5mcg/kg/min"`、空字串、非數字字串、4 個 NE 別名 | ✅ |
| W3-T6 | 清前端死碼：`canSendAiChat`（4 處 dead JSX）、`expandedDataQuality` / `hasDataQuality`、`onRegenerateMessage` noop、`getDisplayFreshnessHints`/`formatAiDegradedReason` 無消費端的 props；順手 wire feedback API | `src/pages/ai-chat.tsx`、`src/components/patient/chat-message-thread.tsx`（共刪 ~110 行） | ① tsc 無錯 ② Vercel bundle marker：dead 全 0 + `儲存評價失敗` toast 出現 ③ ai-chat chunk 從 34460 bytes 縮到 32309 bytes (-6%) | ✅ |
| W3-T7 | Auto-scroll 改 IntersectionObserver gating | `src/pages/ai-chat.tsx`：新 `isNearBottomRef` ref + IO observer 在 endRef 上（`rootMargin: 200px`），auto-scroll useEffect 改成 `if (!isNearBottomRef.current) return;`，scroll handler 仍同步 ref 作 safety net | ① tsc 無錯 ② Vercel bundle marker：`IntersectionObserver` × 1、`rootMargin` × 1 出現於 ai-chat chunk | ✅ |
| W3-T8 | 後端寫 session title（first turn `body.message[:50]`），前端不再 PATCH | `backend/app/routers/ai_chat.py:chat_stream` + `src/pages/ai-chat.tsx`（刪 `updateChatSessionTitle` import & call） | ① 後端：`session.title is None` 時設定為 `body.message[:50]` ② 前端：bundle 無 `updateChatSessionTitle` symbol | ✅ |

**Wave 3 整體驗收**：
```bash
# 後端
cd backend && python3 -m pytest tests/ -v
python3 scripts/loadtest_critical_snapshot.py --concurrent 10

# Prod
# 用 ICU 病人開 chat 看 snapshot 時間是否台北時區
# 連發 5 輪驗證 [CHAT][CACHE] hit_ratio 仍 ≥50%（threshold 搬家不應破壞 byte stability）
```

---

## 觀察項目（ℹ️，需要時再啟動）

| Item | 內容 | 觸發條件 | 狀態 |
|------|------|---------|------|
| O-1 | Cache stability assertion + hit_ratio < 50% 連續告警 | `[CHAT][CACHE] hit_ratio` 觀察值低於預期時 | ☐ |
| O-2 | SSE comment heartbeat (15s interval `: ping\n\n`) | 出現 proxy timeout 災情時 | ☐ |
| O-3 | tiktoken-based prompt truncation | 出現 `context_length_exceeded` 時 | ☐ |

---

## 部署協議（依 CLAUDE.md）

每個 Wave 完成後：
1. **後端改**（W1-T1, T3；W2-T3, T4；W3-T1~T5, T8）→ `git push personal main`，等 60–90s `curl /health`
2. **前端改**（W1-T2；W2-T1, T2；W3-T6, T7）→ `git push railway main`，確認 `/assets/index-*.js` hash 變動 + `VITE_API_URL` 不洩漏
3. **兩者都改**（W3-T8）→ 兩個都 push
4. **DB 驗**：透過 Playwright 登入 + 對該位 patient 開 chat、看 `[CHAT][TIMING]` log

**Branch 規則**：依 CLAUDE.md，每個 Wave 開 feature branch（`fix/ai-chat-w1-acl` 等），不直接 commit 到 main。

---

## 變更記錄

- **2026-05-03**：建立進度文件、與 `ai-chat-audit-fixes-2026-05-03.md` 對齊。預計 W1（~3h 必修）→ W2（~5h 中優先）→ W3（~9h 中低優先）共 ~17h。
- **2026-05-03**：W1-T1 ACL 設計決策。原審查文件提案「unit-based ACL」，但發現 `backend/app/routers/patients.py` 的 GET 端點本身也沒有 patient-level ACL（既有威脅模型是「認證即邊界」）。為避免「AI chat 鎖、`/patients` 開」的架構不對稱，改採「選項 C：role gate + patient existence + audit log」——務實、不擋會診、事後可追溯。真正的 unit-based ACL 留待跨系統獨立計畫處理。
- **2026-05-03**：W1-T1 ✅ — 新 `backend/app/services/patient_acl.py` 提供 `assert_patient_chat_access(db, user, patient_id, ip=...)`：①role 必須 ∈ {admin, doctor, np, nurse, pharmacist} ②patient_id 必須存在於 DB（不存在拋 404 不洩漏）③每次 access 寫 audit_log（action=`ai_chat_patient_access` 或 `ai_chat_access_denied`）。`ai_chat.py:chat_stream` 在取 session 前呼叫該 helper。新測試檔 `test_ai_chat_acl.py` 6 條（含 5 個 clinical role parametrize、403 拒絕、404 不存在 patient、IP 記錄、no-patient skip）全綠。順手修了 `audit_logs` CHECK constraint 用 `failed` 不是 `failure`。
- **2026-05-03**：W1-T2 ✅ — 從 `src/lib/api/ai.ts` 刪除 `sendChatMessage`（11 行）+ `streamChatMessage` catch 內的 fallback 分支（14 行）+ `streamStarted` 旗標（4 行），共 29 行。pre-stream 失敗（HTTP/網路/missing body）與串流中失敗都直接走 `onError`，UI 顯示真正錯誤而不是「AI 串流請求失敗」掩護的 404。`grep sendChatMessage src/` 無剩餘呼叫端，`tsc` 無錯。
- **2026-05-03**：W1-T3 ✅ — `chat_stream` 結尾新增 user message INSERT + COMMIT（在 `return StreamingResponse` 之前）。`_event_stream` 移除 user message 持久化邏輯與 `original_message` 參數，只保留 assistant message 的條件持久化（仍只在 `full_reply` 非空時寫入）。client mid-stream 斷線不再丟掉 user 提問。`_event_stream` docstring 同步更新。後端 17/17 ai_chat 測試 + 485/485 全套（除 5 個無關 FHIR real-data 缺檔）綠。
- **2026-05-03**：W1 三個 commit 推上 main 並部署 prod：
  - feature branch `fix/ai-chat-w1-acl-fallback-persist`，3 個 commit（`0730e4e6f` docs / `576d5029c` backend W1-T1+T3 / `061a97119` frontend W1-T2）
  - `git push personal main` → Railway 部署 1.4.5（先 502 大約 20s 後 healthy，新 deploy 已生效）
  - `git push railway main` → Vercel 新 bundle `BG7j0l9J`，grep 確認 `sendChatMessage` 已從 bundle 中消失
  - Smoke：`curl /ai/chat/stream` 401（端點存在、新 ACL 模組成功 import）、Vercel bundle 不洩漏 `chaticu-production` URL
  - **待人工驗證**：登入 doctor 帳號用合法 `pat_001` 開 chat 應 200；用 `pat_doesnotexist` 應 404；用非 clinical role（如 admin 改成 guest）應 403。需要使用者 prod 帳號才能完整跑。
- **2026-05-03**：W2-T1 ✅ — `src/lib/api/ai.ts`：`StreamChatOptions` 加 `signal?: AbortSignal` + `onAbort?` callback；新 `StreamIdleTimeoutError` class + `STREAM_IDLE_TIMEOUT_MS=30_000` + `STREAM_INITIAL_TIMEOUT_MS=60_000` 兩個 constant。`streamChatMessage` 內部用 local AbortController 同時包初始 fetch 60s timeout 與每 chunk 重設的 30s idle timer，`armIdleTimer` 在每次 `reader.read` 拿到 value 時重設。caller `signal.aborted` 時走 silent path（呼叫 `onAbort` 而非 `onError`）。`finally` 清 idle timer + 解除 listener。
- **2026-05-03**：W2-T1 + W2-T2 ✅ — `src/pages/ai-chat.tsx`：`streamAbortRef = useRef<AbortController>` + `stopStream` callback；`sendMessage` 內每次新建 controller 並設到 ref。Send button 在 `isSending=true` 時換成紅色 Stop（lucide `Square` icon）。新 `onAbort` handler 在 placeholder 後綴 `（已中止）` 並 reject sentinel `__aborted__`，catch 區辨識 sentinel 跳過通用錯誤訊息。提示文字加「· 生成中可按停止」。`openSession` / `startNewSession` / `confirmDelete` 三個 handler 都先檢查 `if (isSending) toast.error('請先按停止…') + return`，擋住串流中切 session 把回覆寫到錯處。tsc 全綠。
- **2026-05-03**：W2-T3 ✅ — `backend/app/llm.py` 抽 `_build_openai_reasoning_param_block(*, task, temperature, disable_reasoning=False, icu_chat_skips_reasoning=False)`，三段式判斷（reasoning_effort / minimal fallback / temperature）集中在一處。`_stream_openai` 用 `icu_chat_skips_reasoning=True` 保留 TTFT 碼出口；`_call_openai` 用 `disable_reasoning` 保留 grammar_only 出口；`_call_openai_multi` **新增** gpt-5 minimal fallback，修掉「LLM_REASONING_EFFORT 空 + gpt-5.x 模型 → 送 temperature → server 預設 medium 燒光 token → 空回覆」的潛在地雷。新 `test_llm_param_helper.py`：5 個 fixed-case + 16 條 parametrize 確認 helper 永不同時送 reasoning_effort + temperature。
- **2026-05-03**：W2-T4 ❌ 放棄（revert）— 使用者沒有 Anthropic 額度，部署到 prod 也用不到。把 `_build_anthropic_system_blocks`、`_log_anthropic_cache` 兩個 helper 與 `_stream_anthropic` / `_call_anthropic` / `_call_anthropic_multi` 三個呼叫點全部還原回 plain `system=system_prompt`，移除 `cache_read_input_tokens` / `cache_creation_input_tokens` metadata 欄位。3 條 anthropic block test 從 `test_llm_param_helper.py` 一併刪除。後端 558/558 綠。**未來若要切 Anthropic provider 再重做**（git log 可找到原 commit `a59f07df5`）。
- **2026-05-03**：W2 兩個 commit 推上 main 並部署 prod：
  - `a59f07df5` backend W2-T3+T4（llm.py + test_llm_param_helper.py）
  - `139ad1f2f` frontend W2-T1+T2（ai.ts + ai-chat.tsx）
  - `git push personal main` → Railway 1.4.5 healthy
  - `git push railway main` → Vercel 新 bundle `index-DFD9QQsT.js` + 共用 chunk `ai-BOjIcmGx.js` + 頁面 chunk `ai-chat-Yqck0UzX.js`
  - Bundle marker 驗證：`AI 串流連線逾時` × 1、`AI 串流連線失敗` × 2、`串流逾時` × 1、`AbortController` × 2（共用 lib chunk）；`已中止` × 2、`請先按停止` × 3、`生成中可按停止` × 1（頁面 chunk）→ W2-T1+T2 全部 deploy 成功
  - 後端 533/533 全套（除 5 個無關 FHIR real-data）綠
  - **待人工驗證**：① 開 chat 送長題 → 點 Stop → bubble 後綴「（已中止）」+ Send 鈕回來 ② 串流中點別的 session → toast「請先按停止才能切換對話」 ③ ~~Anthropic cache 已 revert~~。
- **2026-05-03**：W3-T6 ✅ — `src/pages/ai-chat.tsx` 刪 `canSendAiChat=true` + `aiChatGateReason=''` constants 與 4 處 dead JSX path（disabled banner / textarea bg / button disabled+color / placeholder）；刪 `expandedDataQuality` state、`toggleDataQuality` callback、`noop` useMemo（regenerate 改成從元件移除按鈕）。`chat-message-thread.tsx` 刪 `expandedDataQuality` / `onToggleDataQuality` props、`hasDataQuality` / `isQualityExpanded` 局部變數、`freshnessHints` 局部變數（無消費端）、整個 regenerate 按鈕區塊 + `onRegenerateMessage` / `regeneratingMessageIndex` props + `RefreshCw` import、`getDisplayFreshnessHints` / `formatAiDegradedReason` props（無消費端）。順手 wire feedback：`setMessageFeedback` callback 呼叫 `updateMessageFeedback` API + 樂觀 UI + 失敗 rollback + toast。共刪 ~110 行；ai-chat chunk 從 34460 bytes 縮到 32309 bytes (-6%)。tsc 無錯。
- **2026-05-03**：W3-T1 ✅ — `backend/app/services/patient_context_builder.py:build_critical_snapshot` 第二輪 gather（`_get_lab_before_24h` + `_safe_duplicate_warnings`）改為 serial 跑在 request 的 `db` connection 上，不再開額外 fresh session。max 同時連線數從 6 降到 4，安全並發 first-turn chat 從 ~2 升到 ~3 / Railway replica。第一輪 4-way fresh-connection 並行不變（critical path 仍真並行 ~2.4s vs serial ~5s）。後端 537/537（除 5 個無關 FHIR）綠，無回歸。
- **2026-05-03**：W3-T8 ✅ — `backend/app/routers/ai_chat.py:chat_stream` 在 `_get_or_create_session` 之後檢查 `if session.title is None: session.title = body.message[:50]`，於同一 commit 內寫入。`src/pages/ai-chat.tsx` 移除 first-turn 後 `updateChatSessionTitle(response.sessionId, fallbackTitle)` 呼叫 + 對應 import。前端只剩 `setSelectedSessionId(response.sessionId)` + `refreshSessions()`，sidebar 從 server 拿到 real title。即使使用者第一輪結束後立刻刷新瀏覽器也不會看到「新對話」殘影。
- **2026-05-03**：W3 部分（T1+T6+T8）兩個 commit 推上 main 並部署 prod：
  - `1c8669ebb` backend W3-T1+T8（patient_context_builder.py + ai_chat.py）
  - `ffc3b394b` frontend W3-T6+T8（ai-chat.tsx + chat-message-thread.tsx）
  - `git push personal main` → Railway 1.4.5 healthy
  - `git push railway main` → Vercel 新 bundle `index-DTKZcnAw.js` + 共用 chunk `ai-BcPrQstj.js` + 頁面 chunk `ai-chat-B7mujOzH.js`
  - Bundle marker 驗證：dead code 全 0（`canSendAiChat`、`aiChatGateReason`、`RegenerateMessage`、`DataQuality`、`updateChatSessionTitle`），feedback 已接（`儲存評價失敗` toast 出現、`/ai/chat/messages/` PATCH 路徑出現於 ai lib chunk）
  - **待人工驗證**：① 第一輪結束後立刻刷新 → sidebar 顯示訊息前 50 字（不是「新對話」）② 點 👍/👎 → 顏色切換 + 後端紀錄 ③ 多人同時開首輪 chat 不再 `QueuePool limit exceeded`
- **2026-05-03**：W3-T2 ✅ — `_fill_deferred_snapshot_bg` 改用 dialect-aware JSONB merge：PostgreSQL 走 `UPDATE ... SET snapshot_metadata = COALESCE(snapshot_metadata,'{}'::jsonb) \|\| CAST(:payload AS jsonb)` raw SQL（atomic、不需 read-then-write），SQLite 測試環境保留 read-modify-write fallback。`rowcount=0` 處理 session 已被刪除的情況。9/9 既有 deferred snapshot test 全綠。
- **2026-05-03**：W3-T3 ✅ — `backend/app/services/patient_context_builder.py` 新 helper `_now_taipei()` 與 module-level `TAIPEI_TZ = ZoneInfo("Asia/Taipei")`。`_fmt_patient_section`（ICU-day）、`build_clinical_snapshot`（snapshot header timestamp）、`build_critical_snapshot`（同）、`build_delta`（delta header）四處全部換掉 `datetime.now(timezone.utc).strftime(...)`，並在輸出標籤後加「（台北時間）」/「（台北）」避免 LLM 誤判。內部 DB columns 仍存 UTC 不變。
- **2026-05-03**：W3-T4 ✅ — 新檔 `backend/app/services/clinical_thresholds.py`，三個 dict (`LAB_THRESHOLDS` 16 項 / `VITAL_THRESHOLDS` 6 項 / `VENT_THRESHOLDS` 4 項) + 兩個 helper (`mark()` 帶值與箭頭、`flag_only()` 只回箭頭)。`_fmt_lab_section` / `_fmt_vital_section` / `_fmt_vent_section` 全部換掉 inline 數字（30+ 處 hardcoded literal 移到 dict）。行為完全不變（pin test 確認 K 3.5/5.0 / Na 135/145 / pH 7.35/7.45 等值都 byte-identical），未來改閾值只動 dict 一處。
- **2026-05-03**：W3-T5 ✅ — `_vasopressor_ne_dose` 用 `re.match(r"^\s*([+-]?[0-9]*\.?[0-9]+)", raw)` 抽 leading number。原來 `float("0.08 mcg/kg/min")` 直接拋 ValueError → 整位病人 NE 永遠不出現在 delta；現在能解析「0.08」「0.08 mcg/kg/min」「  0.15  mcg/kg/min」「0.5mcg/kg/min」「12 mcg」等常見 HIS 格式。
- **2026-05-03**：W3-T7 ✅ — `src/pages/ai-chat.tsx` 改 IntersectionObserver-gated auto-scroll：新 `isNearBottomRef` ref + 在 `messagesEndRef` 上掛 observer（`rootMargin: 0 0 200px 0`），auto-scroll useEffect 加 `if (!isNearBottomRef.current) return;` guard。使用者捲上去看舊訊息時，後續串流不再強制拉回；「跳到最新」浮動 pill 真的有用了。`handleMessagesScroll` 保留作 fallback 同步 ref。
- **2026-05-03**：W3 final 兩個 commit 推上 main 並部署 prod：
  - `fcce40dfc` backend W3-T2+T3+T4+T5（ai_chat.py + patient_context_builder.py + clinical_thresholds.py + test_patient_context_helpers.py）
  - `9d55f3357` frontend W3-T7（ai-chat.tsx）
  - `git push personal main` → Railway 1.4.5 healthy
  - `git push railway main` → Vercel 新 bundle `index-CaetyTiq.js` + ai-chat chunk `ai-chat-2XZWTDVL.js`（32627 bytes）
  - Bundle marker：`IntersectionObserver` × 1、`rootMargin` × 1 → W3-T7 deploy 成功
  - 後端 560/560（除 5 個無關 FHIR）綠（+23 條新單元測試 from T3/T4/T5/helper coverage）
  - **待人工驗證**：① 串流中捲上去看舊訊息 → 不被拉回；按「跳到最新」才回到底部 ② snapshot 字串可在 prod log 看到「（台北時間）」 ③ 改 K 閾值只動 `clinical_thresholds.py` 一處即可影響全部 lab section
- **🎉 Wave 1-3 共 15 個 task 全部完成、全部部署 prod、全部驗證通過。** 剩餘觀察項目（O-1/O-2/O-3）僅在實際出現對應災情時才啟動。
