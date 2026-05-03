# AI 對話助手修改進度

> 對應 `docs/ai-chat-audit-fixes-2026-05-03.md`。每完成一個 T，更新此檔。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄　🚧 部分完成

**最後更新**：2026-05-03（W1 三任務完成、prod deploy + smoke verify 通過）

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
| W2-T1 | Stop 鈕 + idle timeout（30s）：`streamChatMessage` 接 external `signal`、每 chunk 重設 timer | `src/lib/api/ai.ts:264-384`、`src/pages/ai-chat.tsx`（Send 鈕區） | ① 手動：串流中按 Stop 立刻中止、placeholder 標記「已中止」 ② 模擬 LLM 卡住（mock）→ 30s 後自動拋逾時 | ☐ |
| W2-T2 | 擋 streaming 中切換 / 新建 / 刪除 session | `src/pages/ai-chat.tsx:283-317` | 手動：串流中點其他 session → toast「請先停止」+ 不切換 | ☐ |
| W2-T3 | LLM helper 抽取：`_build_openai_param_block` 統一 reasoning/temperature 決策，補 `_call_openai_multi` 的 gpt-5 fallback | `backend/app/llm.py:584-626,705-723,762-819`（含新 helper） | 新 unit test：`test_call_openai_multi_gpt5_minimal_fallback` 斷言 params 含 `reasoning_effort="minimal"` 不含 `temperature` | ☐ |
| W2-T4 | Anthropic 加 prompt cache：system 改為 cached blocks | `backend/app/llm.py:668-674,850-852,884-887`、`backend/app/routers/ai_chat.py:116-118`（拆 splitter） | staging 切 `LLM_PROVIDER=anthropic`，連發 3 輪 → log 看到 cache_read_input_tokens > 0 | ☐ |

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
| W3-T1 | Pool 緩解：第二輪 gather 改串行 / 同 connection、patient+vital 合併 query | `backend/app/services/patient_context_builder.py:723-820`、`scripts/loadtest_critical_snapshot.py`（新） | loadtest：10 並發首輪無 `QueuePool limit exceeded` | ☐ |
| W3-T2 | Deferred race 防護：JSONB partial update 或 `SELECT ... FOR UPDATE` | `backend/app/routers/ai_chat.py:163-202` | 寫 unit test 模擬主路徑 + 背景 task 並發寫，最終 metadata 不丟 deferred 內容 | ☐ |
| W3-T3 | Snapshot 時間戳改 Taipei（含 ICU-day） | `backend/app/services/patient_context_builder.py:240,251,677,795,898,941` | 新 unit test：snapshot 字串含「(台北時間)」標記 | ☐ |
| W3-T4 | 集中 threshold config | 新檔 `backend/app/services/clinical_thresholds.py`、`patient_context_builder.py` 各 `_fmt_*_section` | 既有 snapshot test 全綠（行為不變，只是搬家） | ☐ |
| W3-T5 | `m.dose` regex 解析（NE delta 不再因單位字串炸） | `backend/app/services/patient_context_builder.py:224-234` | 新 case：`dose="0.08 mcg/kg/min"` 解析回 0.08 | ☐ |
| W3-T6 | 清前端死碼：`canSendAiChat`、feedback/regenerate noop、`hasDataQuality` 相關 props | `src/pages/ai-chat.tsx:201-203,436,669-670`、`src/components/patient/chat-message-thread.tsx`（dataQuality 相關） | tsc + npm build 全綠；視覺：按鈕區簡化 | ☐ |
| W3-T7 | Auto-scroll 改 IntersectionObserver gating | `src/pages/ai-chat.tsx:241-250`、`src/components/patient/chat-message-thread.tsx:365-375` | 手動：捲到上方看舊訊息時，下方串流不會強制拉回 | ☐ |
| W3-T8 | 後端寫 session title（first turn `body.message[:50]`），前端不再 PATCH | `backend/app/routers/ai_chat.py:_get_or_create_session` 或 `chat_stream`、`src/pages/ai-chat.tsx:410-416` | 手動：first turn 後立刻刷新瀏覽器，sidebar session title 已是訊息前 50 字 | ☐ |

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
