# ChatICU AI Tooling 策略 — 2026-05-05

> 本文件決定 AI 臨床夥伴（patient chat）後續 12 個月在「OpenAI built-in tools」這個面向的方向。
> 對應問題：要不要開 web_search / function tools / file_search / MCP？什麼時候開？
> 撰寫時專案狀態：`gpt-5.5-2026-04-23` 已 pin，`reasoning_effort="none"` fallback bug 已修。

---

## TL;DR

| 選項 | 結論 | 真正的下一步 |
|------|------|--------------|
| 短期：**function tools** | ⚠️ 方向對，但**先不要動** | 讀並維持 `docs/ai-chat/ai-chat-tool-loop-decision-2026-05-03.md` 的觸發條件，等 `[CHAT][PREFETCH][MISS_LIKELY]` 訊號累積 |
| 中期：**file_search** | ✅ 比 4/29 刪掉的 RAG 輕量很多，可做 | **PHI / 授權政策先審**，再用 public guideline 跑 PoC |
| 長期：**MCP server** | ❌ 現在做 premature | 等第二個 LLM 消費者出現再評估 |
| **真正的下個動作** | **抽 service layer** — `services/data_services/` 已建好但空殼，三條路都被它擋 |

---

## 背景

今天因為一個 model bump 副作用（`reasoning_effort="minimal"` 被 gpt-5.5 拒絕）回頭看 AI 臨床夥伴，使用者注意到 chat 不能上網查文獻，因而問起「OpenAI 還有哪些 tool 可以用」。

當下列出的三個方向（function tools / file_search / MCP）召集三個 agent 平行評估後，發現**三條路的決策不是各自獨立的**：

- 最大共同瓶頸是 **service layer 還沒抽出來**（`backend/app/services/data_services/` 資料夾建好但是空的，SQL 直接散在 router）。
- 短期 function tools 已經有人評估過並寫了決策文件，結論是「**等訊號**」，不是「不做」。
- 中期 file_search 不是新鮮事 — 6 天前才拆掉了一整套 RAG。

這份文件把這些非顯而易見的限制條件寫下來，避免後續每次想起 AI tool 都要重新研究一輪。

---

## 三個選項的對照（agent-grounded）

### 1. function tools — ⚠️ 方向對但先不動

| 維度 | 現狀 |
|------|------|
| Service 形狀 | `services/ai_question_prefetch.py` 與 `services/patient_context_builder.py` 私有 getter 大致 tool-shaped（純 `(session, patient_id, …) → list[ORM]`） |
| ACL pattern | `services/patient_acl.py:assert_patient_chat_access` 已是 DB+User-only（無 FastAPI Depends），可重用於 tool dispatcher |
| Streaming code | ❌ `_stream_openai`（`backend/app/llm.py:624`）是 single-shot — 沒有 `delta.tool_calls` accumulator、沒有 multi-iteration outer loop、`tools=` 參數沒傳 |
| Prompt cache 風險 | ⚠️ B15-A1.1 過往事故：cache hit 70% → 0%。tool schema 加進 cached prefix 必須**byte-stable** |
| 既有決策 | **`docs/ai-chat/ai-chat-tool-loop-decision-2026-05-03.md` §5**：等 V1 prod 5-case 測試完 + ≥15% prefetch miss rate 累積 2 週，或出現複合問題需求才動 |
| 預估工時 | ~13.5h（含 streaming 改 loop、cache 守門、5 個 tool wrapper） |

**何時開閘**：
- 條件 A：`[CHAT][PREFETCH][MISS_LIKELY]` 訊號累積到 ≥15% over 14 days
- 條件 B：用戶回報「複合問題」（一句話要 N 個 service call）次數 > 5
- 條件 C：service layer 抽完之後（會把工時從 13.5h 降到 ~6h，重新評估值不值）

**前 3-5 個要 wrap 的 tool（agent 建議）**：
1. `get_recent_cultures` ← `ai_question_prefetch.get_recent_cultures` + `format_culture_context`
2. `get_recent_medication_changes` ← 同上 module
3. `get_recent_diagnostic_reports` ← 同上 module
4. `get_lab_trend` ← `routers/lab_data.compute_latest_lab_payload`
5. `get_drug_duplicates` ← `services/duplicate_cache` + `DuplicateDetector.analyze`

不在清單：`get_allergies`（已在 critical snapshot 內，redundant）、`get_drug_interactions`（DDI 問題在 log 中很少見，低槓桿）。

---

### 2. file_search — 🔁 重做但簡單版

| 維度 | 現狀 |
|------|------|
| 過去歷史 | 2026-04-29 完成 Phase 1 RAG 移除（commits `6a8537545` → `7c58c32f0`，~6800 prod LoC + 1500 test LoC 刪除）。原因是**維運複雜度**，不是內容不足 |
| 移除前架構 | 自管 embedding cache (Redis) + Cohere reranker + BM25 hybrid + contextual retrieval + agentic RAG loops + evidence_gate + 兩個外部 source URL + NHI 微服務 + FUNC_API |
| file_search 比過去輕 | OpenAI 自管 vector store + 自動 cite，省掉 Cohere/Redis/BM25/reranker 全部維運 |
| 語料 | ✅ 已有（`local/rag 文本/` 35MB 共 46 檔；`local/0_chatICU reference/文本/` 52 PDFs）— PADIS、NHI 給付規定、UpToDate 摘要、sedation/delirium/analgesia |
| 前端 wiring | ✅ `src/lib/api/ai.ts:108` `Citation` schema 還在；`patient-chat-tab.tsx:461` references panel 還在；目前 backend 強制塞 `citations: []`（`routers/ai_chat.py:579`）— 拔掉那行就接得上 |
| API blocker | ⚠️ file_search 只在 Responses API，目前用 Chat Completions（`backend/app/llm.py:_stream_openai` line 652）。3 個 callsite 要改 |
| 政策 blocker | ❌ **PHI / data residency 政策未答**。院內 SOP / NHI 給付規定 / UpToDate 摘要要不要上傳 OpenAI vector store 涉及法務 / 院方授權 |
| 預估工時 | ~3-5 dev-days（含 `_stream_openai_responses` 並行新增、annotation → Citation 轉換、SSE 對接、feature flag） |

**何時開閘**：
1. **政策必須先過**：跟院方 / 法務確認哪些內容可以離開機構。建議分三層：
   - 🟢 公開且可重分發：PADIS 2018 + 2025、NHI 公開給付規定 → **PoC 從這裡開始**
   - 🟡 院內 SOP：需院方審
   - 🔴 UpToDate / Lexicomp 摘要：licensing 限制，多半不行
2. PoC 階段不上線 prod，僅在 dev / staging 內部驗證 citation 品質 vs LLM 直答
3. 通過後再評估正式整合工時

**第一批可上傳內容**（保守版，純公開）：`local/rag 文本/0_guideline/PADIS_*.pdf` + `local/rag 文本/4_others/完整給付規定*.pdf`，10-15 檔。

---

### 3. MCP server — ❌ Premature

| 維度 | 現狀（1-5 maturity） |
|------|---------------------|
| Service-layer cleanliness | **2** — `backend/app/services/data_services/` 是空資料夾（只有 `__pycache__`）；SQL 散在 router |
| LLM 消費者數 | **2** — 表面 4 個（ai_chat、clinical summary、polish、clinical_summary service），實質**同一隊用同一個 builder**。MCP 的「跨隊契約」價值不存在 |
| Schema 穩定度 | **2** — 過去 6 個月 27 個 migration（053→080），藥物 / 重複用藥 / team-chat 結構仍週週變動 |
| Auth 可重用性 | **2** — `assert_patient_chat_access` 是 request-scoped（FastAPI User + IP audit）；MCP 沒有 service-to-service token 模式，要全新 auth 故事 |

**MCP 的價值要等三件事到位**：
1. Service layer 抽出來（typed dict 不是 formatted string）
2. 第二個真實消費者出現（mobile app / 外部夥伴醫院 API / 第二個團隊）
3. Schema 變動率降下來

**真要做的時候建議**：
- 用 **FastMCP** 掛在現有 FastAPI app 上 `/mcp` route（不另開 process）
- 重用既有 auth middleware、audit log、SQLAlchemy session
- 不用 off-the-shelf FHIR / Postgres MCP — ICU-specific 的 renal dosing、allergy↔med 衝突、duplicate context 推論太特殊，套不進去

**預期 tool surface（~12 個）**：`patient.demographics` · `patient.vitals_latest` · `patient.lab_latest` · `patient.lab_trend(category, key, hours)` · `patient.medications_active` · `patient.ventilator_latest` · `patient.cultures_recent` · `patient.diagnostic_reports_recent` · `patient.scores_latest` · `patient.allergies` · `drug.interactions(rxcuis[])` · `drug.duplicates(meds[])`

---

## 真正的瓶頸：Service Layer

三個 agent 的評估隱含同一個結論：**目前所有 LLM 路徑都依賴 `patient_context_builder.py` 回的中文 formatted string，沒有可以重用的 typed-data layer**。

這檔事擋住三條路：

| 路徑 | 受 service layer 擋的方式 |
|------|---------------------------|
| function tools | 每個 tool wrapper 要自己寫 SQL → 重複 13.5h；service layer 抽完後降到 ~6h |
| file_search | 影響較小（語料路徑獨立），但 RAG 結果要回給 LLM 時也要從 service 取病人 metadata |
| MCP | 直接擋死，MCP 本質就是把 service 暴露成 protocol |

**Phase A（本月內可做、無 LLM 風險、三條路都受惠）**：
1. 把 `routers/lab_data.py` / `medications.py` / `vital_signs.py` / `cultures` 等 router 內的 SQL 抽到 `services/data_services/{lab,medication,vital,culture}_service.py`
2. 每個 service function 回 typed dict（Pydantic model），不回 formatted string
3. `patient_context_builder.py` 改成 compose 這些 service，formatted string 邏輯保留在 builder 內（不污染 service）
4. 加 unit test（service layer 是 pure function，好測）

**這件事獨立於 LLM 也有價值**：測試覆蓋、reuse、router 變薄、MCP-ready。是「無論決定要不要做 AI tool 都該做」的事。

---

## 12 個月排序

```
Phase A — 本月（必做，前提）
├─ Service layer 抽取（data_services/*）
├─ patient_context_builder 改 compose
└─ 監看 [CHAT][PREFETCH][MISS_LIKELY] 訊號累積

Phase B — 下個月（政策依賴）
├─ PHI / 授權政策跟院方確認
└─ 政策過 → file_search PoC（公開內容、dev only、不上 prod）

Phase C — 下季（訊號依賴）
├─ 若 prefetch miss rate ≥15% / 14d → 啟動 function tools（~6h MVP）
└─ 若 file_search PoC 品質好 → 排正式整合（~3-5 dev-days）

Phase D — 半年後重評
└─ 第二個 LLM 消費者出現？ → MCP 評估；否則繼續 function tools 路線
```

---

## 觸發 / 暫停條件 cheat sheet

**function tools — 開閘條件**（任一）：
- `[CHAT][PREFETCH][MISS_LIKELY]` ≥ 15% over 14 days
- 用戶複合問題（一句話 N 個 service call）次數 > 5
- Service layer Phase A 完成（重評工時與 ROI）

**file_search — 開閘條件**（全部）：
- 院方 / 法務 PHI 政策已書面確認
- 至少有一批「可重分發」內容（公開 guideline）通過篩選
- 對 Responses API migration 工時有明確 owner

**MCP — 開閘條件**（任一即可考慮，全部都到才動工）：
- 第二個獨立 LLM 消費者出現（mobile / 外部 API / 第二團隊）
- Service layer 抽完且穩定 ≥ 1 季（migration 頻率 < 2/月）
- 跨機構 / 跨團隊 API 對外契約需求

**任一個的暫停條件**：
- prompt cache hit ratio 跌到 < 50%（B15-A1.1 incident 線）
- AI 臨床夥伴 P95 latency > 8s
- LLM 月支出超過預算 > 30%

---

## 與既有文件關係

| 文件 | 關係 |
|------|------|
| `docs/ai-chat/ai-chat-tool-loop-decision-2026-05-03.md` | **本文件不取代它**。那份是 function tools 的詳細決策；本文件把它放進整體 12 個月排序，並補上 file_search / MCP 的對照 |
| `docs/codebase-health/optimization-roadmap-2026-04-29.md` | Phase 1 RAG 移除的完整理由 — 評估 file_search 前必讀 |
| `docs/ai-chat/ai-context-architecture-plan.md` | AI context 整體架構（如果存在）— 與 Phase A 抽 service layer 對照 |
| `CLAUDE.md` | 部署流程、commit 規範；本文件提到的工時不含 deploy / verify 流程 |

---

## 第一個 actionable

不論你最後選哪條路，**這週可以做的事**：

1. **讀 `docs/ai-chat/ai-chat-tool-loop-decision-2026-05-03.md`**，確認你是否認同那份的「等」決策。如果不認同 → 重新討論觸發條件並更新該文件；如果認同 → 跳第 2 步。
2. **開 Phase A ticket**：建一個 `docs/coordination/backend-tasks.md` 條目，把 `services/data_services/*_service.py` 抽取列入下個 sprint。第一個目標 service：`lab_service.py`（最小、最常用、最容易測）。
3. **跟院方 / 法務啟動 PHI 政策對話**：問「上傳哪類文件到 OpenAI vector store 可被接受」。這件事是 file_search 的最長前置作業，越早問越好。

不需要本週做的事：
- 不要動 `_stream_openai`（function tools 路徑還沒到啟動條件）
- 不要 migrate 到 Responses API（file_search 政策還沒過）
- 不要寫 MCP server（service layer 還沒抽，premature）

---

*Last updated: 2026-05-05 by 三個 agent 平行評估後 synthesis（function tools / file_search / MCP fit-assessment）。*
