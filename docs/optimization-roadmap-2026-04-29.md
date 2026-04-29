# ChatICU 優化路線圖

- **建立日期**：2026-04-29
- **驗證**：2026-04-29 由 4 個 agent 平行查驗（Phase 1 RAG 刪除候選 / Phase 0 commits / Phase 2-5 細節 / RAG 邊界與隱藏依賴），詳見最後 §「驗證紀錄」
- **目的**：彙整接下來所有優化工作的順序、範圍與決策依據
- **範圍**：從 RAG 整層移除（Phase 1）到結構性收斂（Phase 5），含觀察類項目
- **配套文件**：
  - 歷史審計與已完成項目細節：[`docs/system-audit-2026-04-28.md`](system-audit-2026-04-28.md)
  - 本檔是**前瞻 roadmap**，audit doc 是**歷史紀錄**
- **使用方式**：每完成一個 Phase 在這份回來打勾、把對應細節 push 到 audit doc

---

## 摘要（白話文）

> **2026-04-29 收尾**：RAG 整層刪除、Phase 2 操作層清理、病人詳情頁大整理、startup_migrations 退役全部上線。短期時間 gate 已清空，剩下是長期高風險項或觀察類工作。

| 階段 | 內容 | 狀態 |
|---|---|---|
| ✅ Phase 0 | 13 個 commits 已上線（DB、cache、HIS sync、bundle、http pool） | 完成 |
| ✅ Phase 1 | RAG 整層移除（6 commits、~6800 行 prod + 1500 行 test 刪除）+ 收尾（Railway env 清乾淨、`extra="ignore"` 已恢復嚴格） | 完成 |
| ✅ Phase 2 | 操作層清理完成（active cleanup + `/v2/patients` retire） | 完成 |
| ✅ Phase 3 | 病人詳情頁大整理（3.1 bootstrap、3.2 chat tab 抽出、3.4 lazy tabs、3.3 dashboard cache 收斂）— 全 prod 上線 | 完成 |
| ✅ Phase 4 | 4.1 startup_migrations 拆解（2a 074 alembic / 3a runner / 4 retire bag / 5 Procfile fail-fast）— 全 prod 上線 | 完成 |
| 🔮 Phase 5 | Vercel `/api/*` namespace 收斂 — long-term / high-risk，不主動開 | 暫停（看實際需求） |

### 下一個 code gate

| 日期 | 動作 |
|---|---|
| — | 無短期時間 gate；下一批只剩 Phase 5/6 研究或需求觸發項 |

---

## ✅ Phase 0 — 已上線（2026-04-28 ~ 04-29）

13 個 commits，分 5 個階段完成。

| # | 內容 | Commit | 收益 |
|---|---|---|---|
| 1 | DB asyncpg pooler-safe `connect_args` + pool 30→10 | `e2f97b2fd` | 消除 `DuplicatePreparedStatementError` 風險、避免壓爆 Supabase pooler |
| 2 | 雙軌 cache 同步（手刻 + TanStack） | `e2f97b2fd` | mutation 後不再需要 `Cmd+Shift+R` |
| 3 | HIS sync invariant 測試 + ON CONFLICT + multi-row batch | `46d39ff38` `3ad388bde` `9ee1e7780` `4724fa117` | **4-5 min/patient → 19.87 sec/patient（6×）** |
| 4 + hotfix | `/v2/patients` PHI-safe access logger | `52fd9cb9a` `cdb4a6ab0` | 觀察 1-2 週後可確認刪除 |
| 5 | 移除 charts 首屏 modulepreload | `9f14a92aa` | **省 ~113 KB gz / 首屏** |
| 7A | drug_rag + pad client 改用 shared httpx pool | `69eae4ab6` | 連線池共用、shutdown drain |
| 7B | source_registry health check 共用 pool | `d728b5543` | 同上 |

詳細審計與每個 commit 的 review 過程見 [`system-audit-2026-04-28.md`](system-audit-2026-04-28.md)。

---

## ✅ Phase 1 — RAG 整層移除（已完成 2026-04-29）

### 完成摘要

| 階段 | Commit | 內容 |
|---|---|---|
| D1a | `6a8537545` | `/admin/vectors` 整層（page + admin.ts/sidebar/App.tsx）— 455 行 |
| D1b | `fb88ef759` | AI readiness gating 移除（`use-ai-readiness` / `use-patient-ai-status` / pharmacist-advice-widget + ai-chat / patient-detail / medical-records / patient-summary-tab gate 簡化） |
| D1c | `d42ac156c` | ClinicalQueryPanel + clinical-query 整層（5 個 component/hook + ai.ts 5 個 type/函式） |
| D2a | `e7bbb0bf9` | RAG routers (`rag.py`、`ai_readiness.py`) + clinical.py 8 個 RAG endpoint + admin/vectors backend handlers + main.py register/RAG warmup（clinical.py 1671→721 行；test_clinical.py 556→148 行；4 test 檔整刪）|
| D2b | （內含於 D2a） | `/interactions` endpoint 內部本就無 RAG fallback，剝離工作隱性完成 |
| D3+D4 | `129cf67d0` | 17 個 service 檔（leaf 8 + middle 9）+ 11 個 service test 檔；llm.py 移除 4 dead 函式 + 2 dead TASK_PROMPTS key；main.py / conftest.py / pharmacy_routes/interactions.py 細修 |
| D5 | `7c58c32f0` | config.py 32 RAG 欄位 + `.env.example` 13 行 + `evidence_gate.py` 整檔（106 行）+ llm.py rerank/citation 函式（183 行）；加 Pydantic `extra="ignore"` 讓 Railway 殘留 env 不擋 startup |

**累積數字**：6 個 commits、~6800 行 prod code 刪除、~1500 行 test code 刪除。全程 pytest 零失敗、prod `/health` 200 不中斷。

### Phase 1 結尾（已完成 2026-04-29）

| 項目 | 狀態 | 證據 |
|---|---|---|
| Railway dashboard 清掉殘留 RAG env vars | ✅ | 殘留清單目標數 = 0 |
| 觀察 prod log 1-2 天確認無 ImportError | ✅ | 多次 redeploy `/health` 200，未見 ImportError |
| 把 `app/config.py` 的 `extra="ignore"` 改回嚴格預設 | ✅ | `grep extra= app/config.py` 0 hits（恢復 Pydantic v2 預設嚴格行為） |

---

## 📜 Phase 1 原始計劃（保留歷史紀錄）

下面是執行前的 plan，與實際完成內容做對照。

### Phase 1 計劃 — RAG 整層移除（執行前）

### 為什麼要做

- 三個外部 RAG 微服務（Source A `127.0.0.1:8003`、Source B `127.0.0.1:8004`、PAD API）**Railway 上根本沒部署**
- `RAG_AUTO_INDEX_ON_STARTUP=false` → 內建 RAG 索引也不載入
- 所有 RAG endpoint（`/api/v1/clinical/*`、`/api/v1/rag/*`、`/api/v1/ai/readiness`、`/pharmacy/drug-interactions`）目前**永遠 graceful 失敗**
- 留著 ~6000 行 dead code 只造成維護負擔與認知混淆

### 真實 RAG 使用狀態（已確認）

| 元件 | Prod 狀態 |
|---|---|
| `rag_service`（in-process pgvector） | `RAG_AUTO_INDEX_ON_STARTUP=false`，索引不載入 |
| `evidence_client`（Source A） | URL 預設 `127.0.0.1:8003`，永遠 ConnectError |
| `drug_rag_client`（Source B） | URL 預設 `127.0.0.1:8004`，永遠 ConnectError |
| `pad_client` | 完全 dead code（0 個 router caller） |
| `guideline_rag_client` | 完全 dead code（0 個 router caller） |
| `agentic_rag` | 完全 dead code in routers |
| AI chat（`/ai/chat`） | 純 LLM + `build_clinical_snapshot`，**不接 RAG** |

### 刪除候選

#### 後端 services（19 個檔）

| 檔案 | 角色 | 刪除原因 |
|---|---|---|
| `services/evidence_client.py` | Source A 客戶端 | 永遠失敗 |
| `services/drug_rag_client.py` | Source B 客戶端 | 永遠失敗 |
| `services/pad_client.py` | PAD 客戶端 | dead code |
| `services/guideline_rag_client.py` | in-process pickle/BM25 | 0 callers |
| `services/orchestrator.py` | 多源編排 | 中介層，全 RAG |
| `services/source_registry.py` | source health 註冊 | 中介層 |
| `services/evidence_fuser.py` | 跨源融合 | 中介層 |
| `services/intent_classifier.py` | RAG 意圖路由 | 中介層 |
| `services/citation_builder.py` | RAG citation 組裝 | 中介層 |
| `services/embedding_cache.py` | Redis embedding 快取 | 中介層 |
| `services/graph_context_enricher.py` | 給 RAG 補圖譜上下文 | 中介層 |
| `services/safety_gate.py` | RAG pre-answer gate | 0 active callers |
| `services/chat_router.py` | LLM 路由「該查哪些 DB」 | 連帶 |
| `services/_http.py` | shared httpx | 只被 RAG 客戶端用，連帶刪 |
| `services/llm_services/rag_service.py` | pgvector + BM25 | 只被 deleted routers 用 |
| `services/llm_services/agentic_rag.py` | agentic 多輪檢索 | 0 active callers |
| `services/llm_services/clinical_summary.py` | LLM 寫摘要 | 只被 clinical.py 用 |
| `services/llm_services/patient_explanation.py` | LLM 寫病人說明 | 只被 clinical.py 用 |
| `services/safety_guardrail.py` | LLM post-answer 防護 | 只被 clinical.py 用 |

#### 後端 routers

| 檔案 | 處置 |
|---|---|
| `routers/clinical.py`（1500+ 行） | 整檔刪 |
| `routers/rag.py` | 整檔刪 |
| `routers/ai_readiness.py` | 整檔刪 |
| `routers/pharmacy_routes/interactions.py` | 部分刪：移除 drug_rag_client，**保留 drug_graph_bridge**（local DrugData 圖譜，非 RAG） |
| `routers/admin.py` | 檢查並移除 `/admin/vectors` 相關段落 |
| `app/main.py` | 移除 router 註冊 + lifespan RAG warmup + **`main.py:194-195` 的 `close_shared_client` hook**（agent 確認此行隨 `_http.py` 一起刪） |
| `app/config.py` | 移除 **32 個欄位**（agent 實測）：`RAG_×17`、`EMBEDDING_CACHE_×2`、`RERANKER×1`、`COHERE×2`、`SOURCE_×3`、`FUNC_API_×4`、`ORCHESTRATOR×1`、`NHI_SERVICE×1` + `RAG_DOCS_PATH` + `RAG_INDEX_DIR` |
| `app/llm.py` | **修兩處**：(a) 移除 `line 1181` 的 `from app.services.embedding_cache import ...`（embedding_cache 被刪後此 lazy-import 會壞）；(b) 移除 `line 472` `TASK_PROMPTS` 的 `"agentic_rag_router"` 死 key |
| `config/source_priorities.json` | 刪 |
| `.env.example` | 約 13 個 RAG 註解/變數要清 |

#### 前端

| 檔案 | 處置 |
|---|---|
| `src/lib/api/ai.ts` | 刪 RAG 相關函式（getReadiness、clinicalSummary 等含 stream 變體） |
| `src/lib/api/pharmacy.ts` | 部分刪（drug-interactions 相關） |
| `src/lib/api/admin.ts` | 刪 `/admin/vectors` 相關 |
| `src/lib/api/medications.ts` | **agent 漏網**：含 RAG 相關 API 呼叫，需 grep 並清理 |
| `src/hooks/use-ai-readiness.ts` | **agent 漏網**：整檔刪（基於 `/api/v1/ai/readiness`） |
| `src/components/app-sidebar.tsx` | **agent 漏網**：移除 `/admin/vectors` 與 `/pharmacy/interactions` 連結 |
| `src/components/patient/citation-display.tsx` | **agent 漏網**：整檔刪（RAG citation 顯示） |
| `src/components/patient/multi-source-loader.tsx` | **agent 漏網**：整檔刪（多源 RAG loading 狀態） |
| `src/components/patient/clinical-query-panel.tsx` | **agent 漏網**：整檔刪（接 /api/v1/clinical） |
| `src/components/patient/drug-comparison-panel.tsx` | **agent 漏網**：整檔刪（RAG drug comparison） |
| `src/components/patient/drug-interaction-badges.tsx` | **agent 漏網**：可能整檔刪或改用 graph DDI（需驗證） |
| `src/components/patient/medication-duplicate-badges.tsx` | **agent 漏網**：含 evidence 字串，需驗證是否 RAG 還是純文案 |
| `src/pages/admin/vectors.tsx` | 整檔刪 |
| `src/pages/pharmacy/interactions.tsx` | 視 (a) 決策 |
| `src/pages/ai-chat.tsx` | 用到上述被刪 component，**留檔但要清 import** |
| `src/pages/patient-detail.tsx` | 用到上述被刪 component（multi-source-loader / citation-display 等），**留檔但要清 import** |
| `src/pages/patient-detail-utils.ts` | 同上 |
| `src/App.tsx` | 移除被刪頁面 route |

#### 後端 tests（~12 個檔）

`tests/test_services/test_orchestrator.py`、`test_drug_rag_client.py`、`test_evidence_client.py`、`test_evidence_fuser.py`、`test_source_registry.py`、`test_http_shared_client.py`、`tests/test_api/test_clinical*.py`、`test_rag.py`、`test_ai_readiness.py`、`test_pharmacy_interactions_bridge.py`、`test_contract.py`（部分）

**agent 漏網**：`tests/conftest.py:221-226` 有 `rag_service` fixture state reset，Phase 1 commit 一定要一起清，否則 import 會失敗。

### 保留（不是 RAG）

| 檔案 | 為何留 |
|---|---|
| `routers/ai_chat.py`（`/ai/*`） | 純 LLM 對話，不接 RAG |
| `services/patient_context_builder.py` | 給 ai_chat 組臨床快照（從 DB 抓 patient/labs/meds） |
| `services/drug_graph_bridge.py` + `utils/ddi_check.py` | local DrugData 圖譜 DDI（非 RAG） |
| `services/duplicate_cache.py` `duplicate_detector.py` | 重複用藥偵測（非 RAG） |
| `services/layer2_store.py` | layer2 結構化資料 |
| `app/llm.py` | LLM 統一入口 |

### 待你 sign-off 的 3 個邊界決策

1. **`/pharmacy/interactions`**：留 graph DDI、刪 RAG 部分？建議 ✅
2. **`/admin/vectors`** 整個刪？建議 ✅
3. **`/ai-chat` 保留**？（純 LLM 不算 RAG）建議 ✅

### 5 階段分次 commit

| 階段 | 範圍 | 預估行數 | 風險 |
|---|---|---|---|
| **D1** 前端 | `admin/vectors`、`/lib/api/ai.ts` 的 RAG 函式、`/lib/api/admin.ts`、`App.tsx` route | -500~1000 行 | 低 |
| **D2** 後端 routers | `clinical.py` / `rag.py` / `ai_readiness.py` + main.py register | -2000~2500 行 | 低 |
| **D3** 後端 services（leaf） | evidence_client / drug_rag_client / pad_client / guideline_rag_client / agentic_rag / rag_service / clinical_summary / patient_explanation / safety_guardrail / chat_router | -1500~2000 行 | 中 |
| **D4** 後端 services（中介） | orchestrator / source_registry / evidence_fuser / intent_classifier / citation_builder / embedding_cache / graph_context_enricher / safety_gate / _http | -1500 行 | 中 |
| **D5** 設定 + tests | config.py **32 個欄位**、刪對應 tests、`tests/conftest.py:221-226` rag_service fixture、`.env.example` 13 個變數、source_priorities.json、Railway env 清單 | -500 行 | 低 |

每 stage 完成後跑 pytest + tsc 才 push。任何一階段出錯可以單獨 revert。

預估**總刪除：6000+ 行 production code + 1000+ 行 test code**。

---

## ✅ Phase 2 — 操作層清理（已完成 2026-04-29）

### 已完成

| # | Commit | 內容 |
|---|---|---|
| P2.2 | `f381c6a3e` | `src/components/ui/chart.tsx` dead code 整刪（-353 行） |
| P2.3 | `8b8f56fa7` | `.gitignore` 加 `/*.png` `/*.yml` `.env.local` `.playwright-cli/` 等 root-only patterns（+14 行）；51 個 .png/.yml 從 `git status` 雜訊消失 |
| P2.4 | `710e3fc91` | `backend/scripts/sync_his_snapshots_serial.py` 提交版本庫（+165 行）；之前 untracked，CLAUDE.md 引用但不在 repo |
| P2.1 + P2.5 | 本次收尾 | 24h `V2_ACCESS` = 0 後提前刪 `/v2/patients` router / tests / Vercel rewrite / `layer2-mode.ts` / generated API types，並 retire `V2AccessLogMiddleware` |

### P2.1 / P2.5 收尾依據

原本規劃等 2026-05-13+ 才判讀 `V2_ACCESS`，但 2026-04-29 當日使用者決定接受提前刪除風險。收尾前先查 prod log：

```bash
railway logs --since 24h --deployment --lines 2000 --filter "V2_ACCESS" | wc -l
```

結果：`0` hit。刪除時仍保留 `backend/app/services/layer2_store.py`，因為 `backend/app/routers/scores.py` 仍用它解析 layer2 JSON patient id。

---

## 📜 Phase 2 原始計劃（保留歷史紀錄）

Phase 1 已完成（2026-04-29）。低風險、可一個下午做完。

| # | 項目 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| **2.1** | `/v2/patients` deletion（觀察期 1-2 週後） | 低 | 30 min | 刪 ~826 行 router + tests + Vercel rewrite |
| **2.2** | `ui/chart.tsx` dead code 刪除（zero consumer） | 0 | 5 min | 清潔（已 tree-shake，無 prod 收益） |
| **2.3** | Repo 根目錄清理 | 0 | 30 min | **51 個** `.png` / `.yml` artifacts（agent 實測）、`_archive_candidates/` 19MB → 加 `.gitignore` |
| **2.4** | `backend/scripts/sync_his_snapshots_serial.py` 提交 | 0 | 5 min | 目前 untracked，下次重灌就消失 |
| **2.5** | 移除 V2AccessLog middleware（觀察結束後） | 低 | 15 min | 確認無流量後可移除 |

### 2.1 細節：`/v2/patients` 刪除步驟

1. 確認 V2AccessLog 觀察 1-2 週累積數據：

   ```bash
   # 統計
   railway logs --since 14d | grep -c V2_ACCESS

   # 每個 route 的呼叫量
   railway logs --since 14d | grep V2_ACCESS | grep -oE 'route=[^ ]+' | sort | uniq -c
   ```

2. 若 0 hit 或全部來自健檢 UA → 確認可刪
3. 刪 `backend/app/routers/patients_v2.py`、`backend/tests/test_api/test_patients_v2.py`
4. 移除 `vercel.json` 的 `/v2/:path*` rewrite
5. 刪 `src/lib/api/layer2-mode.ts`
6. 重新生成 `src/lib/api/types.generated.ts`
7. **保留** `services/layer2_store.py`（被 `scores.py:37` 內部用）

---

## ✅ Phase 3 — 病人詳情頁大整理（已完成 2026-04-29）

| 項目 | Commit | 收益 |
|---|---|---|
| **3.1** Patient bootstrap aggregate endpoint + frontend consumer | `e55e1761b` (backend) + `39a52fd6a` (frontend) | 9-RTT serial chain → 1 RTT bootstrap；首屏延遲 −0.5~1s p95（前端 telemetry 內） |
| **3.1b** Bootstrap fallback safety net 移除 | `9611e78e7` | 首屏只保留 `/patients/{id}/bootstrap`；移除 5-call fallback，bootstrap 5xx 時 fail-loud |
| **3.2** chat tab 抽出 → `patient-chat-tab.tsx`（presentational props-only） | `0747f09e9` | `patient-detail.tsx` 2072 → ~1620 行（淨 -453）；bootstrap/fallback/loading byte-identical（HARD CONSTRAINT 守住） |
| **3.4** 5 個 tab `React.lazy` + Suspense | `bb5c033bc` | `patient-detail` 入口 chunk **59.66 → 17.76 KB gzip（−70%）**；5 個 lazy chunk 5–16 KB 按需載入；chat tab 維持靜態 |
| **3.3** `dashboard-stats-cache.ts` 整檔刪 → 統一 TanStack | `0f843d924` | 雙軌 cache 完全收斂（51 行刪 + 2 caller 清理）；mutation invalidation 維持單一 path |

**Prod 驗證**：4 個 commit 部署後 `/health` 200、Vercel asset hash 每次都翻新、Playwright smoke 通過（chat default、tab round-trip、lazy chunks 按需 fetch、second-click cached、`/dashboard` stats render）、console error 0。

**Note**：3.1 fallback safety net 已在 `9611e78e7` 移除；prod smoke 驗證首屏病人 API 僅剩 `/bootstrap`。

---

## 📜 Phase 3 原始計劃（保留歷史紀錄）

3-4 天工。最有感的前端優化——進病人頁從 3-5 秒 → 1 秒以內。

### 當時的問題

- 進入單一病人頁要打 4-7 個 API（病人資料、用藥、訊息、呼吸器、撤管、聊天記錄...），每通電話 700ms，總共要等 3-5 秒
- `patient-detail.tsx` 一個檔 2072 行，42 個狀態變數，零個 React.memo
- 隨便打字一個輸入框，整個 2000 行樹都會重新渲染

### 原任務拆解

| # | 項目 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| **3.1** | Patient detail initial bundle endpoint | 中 | 1-2 天 | 進入單一病人頁從 4-7 個 API → 1 個 aggregate；首屏少 3-5 秒 |
| **3.2** | `patient-detail.tsx` 拆檔 + memo + Context | 中 | 1-2 天 | 2072 行、42 useState、0 React.memo；目前任一 state 動就重渲整個 tree |
| **3.3** | `dashboard-stats-cache.ts` 整檔刪、改 TanStack | 低 | 半天 | 雙軌 cache 完全收斂；**agent 註**：51 行檔本身可刪，但要先清 2 個 caller（`src/lib/patient-data-sync.ts:2`、`src/pages/dashboard.tsx:20`） |
| **3.4** | Patient detail tab 化 lazy | 中 | 半天 | 減少 patient-detail bundle（目前 213 KB raw） |

**實際執行偏離**：3.2 改成純 JSX 抽出（state/handlers 留父層 presentational props-only），未加 Context/memo——HARD CONSTRAINT 是「不改 bootstrap/fallback/loading 行為」，加 Context 風險太大不值得。memo 可由 React Profiler 顯示需要時再追加。

---

## ✅ Phase 4 — 啟動雜訊清理（已完成 2026-04-29）

| Step | Commit | 內容 |
|---|---|---|
| **4.1 Step 2a** | `a871fcf3b` | alembic `074_consolidate_startup_schema.py`（+215 行）— 補 7 個 schema gap：`ai_messages.feedback`、`sync_status` 表、`vital_signs.{etco2,cvp,icp,cpp}`、3 個 perf index、2 個 FK constraint、drug_interactions JSONB type 轉換、DROP `_startup_flags` |
| **4.1 Step 3a** | `480d23856` | `backend/scripts/run_seed_repair.py`（+1086 行）— 10 個 seed/repair helper + `--dry-run/--only/--skip/--list` CLI；修兩個 prod warning（outpatient demo `_date(...)` + diagnostic_reports patient EXISTS guard） |
| **4.1 Step 4** | `d1693c063` | 整檔刪 `backend/app/startup_migrations.py`（-1418 行）+ 拔 `app/main.py` 的 `_run_startup_warmups` lifespan hook（-26 行）|
| **4.1 Step 5** | `8a6e39f71` | `backend/Procfile`：`alembic upgrade head \|\| echo "WARN..." ; uvicorn` → `alembic upgrade head && uvicorn`（fail-fast，alembic 失敗讓 Railway 部署直接 fail） |

**Prod 驗證**：每個 step push 後 `/health` 200、deploy log 確認預期 marker（074 跑成功 / `Startup warmups scheduled` 消失 / `outpatient seed failed` 消失 / `diagnostic_reports failed` 消失 / `WARN: migration failed` 永久不會出現）。Boot 時間從 startup_migrations 跑滿 ~90s 縮到 uvicorn ~1ms startup。

---

## 📜 Phase 4 原始計劃（保留歷史紀錄）

1-2 天工。清掉部署 log 的兩個 warning。

### 目前的問題

每次部署 Railway log 出現兩個 warning：
- outpatient seed 日期型別錯
- diagnostic_reports FK violation 找不到 `pat_001`

**為什麼會出現**：app 啟動時 `lifespan` 跑了一段「補資料/補 schema」的 fallback 邏輯（`startup_migrations.run_all`），遇到問題就 log warning 繼續開機。同時 Procfile 已經跑過 `alembic upgrade head` —— 雙重 migration 路徑。

### 任務拆解

| # | 項目 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| **4.1** | startup_migrations 拆解 | 低 | 1-2 天 | schema → Alembic、seed/repair → explicit job、移除 `\|\| echo WARN` 容錯 |
| **4.2** | Procfile / 部署腳本健康檢查 | 低 | 半天 | alembic 失敗時部署直接 fail，不要半開機 |

### 4.1 拆解步驟

1. 盤點 `startup_migrations.py` 內容：哪些是 schema、哪些是 seed/repair
2. **schema 部分全搬進 Alembic**：寫對應的 alembic revision
3. **seed/repair 改成明確 job**：`backend/scripts/run_seed_repair.py`，部署時 Procfile 顯式呼叫
4. 移除 `lifespan` 內的 `_run_startup_warmups` 對 migration 的呼叫
5. 移除 Procfile / 部署腳本中 `alembic upgrade head` 後的 `|| echo WARN` 容錯
6. 修掉那 2 個 prod warning（順手做）

---

## 🔮 Phase 5 — 結構性收斂（long-term / high-risk，不主動開）

**狀態**：暫停，看實際需求才動。Phase 3 + Phase 4 完成後 prod 已穩定，此項屬於遠期清潔，沒有 user-facing 收益且 blast radius 大（同時改前後端 + Vercel rewrite + 1-2 個月 compatibility 期）。

2-3 天工。高風險，不急。

### 目前的問題

`/patients` 同時是「前端頁面」和「後端 API」。Vercel 用一個 header (`x-request-id`) 區分，不帶 header 去 curl 會拿到網頁不是資料，監控很容易誤判。

### 任務拆解

| # | 項目 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| **5.1** | Vercel `/api/*` namespace 收斂 | 高 | 2-3 天 | 移除 `x-request-id` header gate；後端 router prefix 全部加 `/api`；前端 callsite 全改；保留舊路徑 compatibility rewrite 一段時間 |
| **5.2** | 後端 router 整合 | 中 | 1-2 天 | 30 個 router 是否有可合併者；patients.py vs scores.py 的 layer2_store 依賴整理 |

### 5.1 收斂策略

- 後端：所有 router prefix 加 `/api`
- 前端：`apiClient` baseURL 改 `/api`
- `vercel.json`：刪掉所有 header gate，只留 `/api/:path*` rewrite
- **保留舊路徑 compatibility rewrite 1-2 個月**，不一次切斷

---

## 🔮 Phase 6 — 觀察類（看到 issue 才動）

不主動推進，只在指標出問題時啟動。

| 項目 | 觸發條件 | 備註 |
|---|---|---|
| Sentry / 錯誤追蹤 | 看到 prod 出現難排錯的 exception | 目前靠 Railway log，scaling 到團隊用 Sentry 較好 |
| Supabase RLS / index 覆蓋審計 | 新增多寫入路徑時 | 目前 patient/medication/lab 已有 PK + FK |
| 測試覆蓋率報告 | CI 設定後 | pytest-cov 加進 CI |
| LLM cost / latency 監控 | AI chat 流量大時 | 目前是 build_clinical_snapshot per-turn |
| HIS sync 排程化（Railway cron / launchd） | sync 自動化需求出現 | 目前手動 |

---

## 已不再相關的原項目

| 原 audit doc 項 | 狀態 | 處置 |
|---|---|---|
| **#6** RAG retrieval 改 pgvector ANN | ❌ 移除 | RAG 整層刪除（Phase 1） |
| **#7C** evidence_client 改 async | ❌ 移除 | evidence_client 整檔刪除（Phase 1） |

---

## 執行順序（已執行完畢）

```
Phase 0 (13 commits)                                  ✅ 2026-04-28~29
  └→ Phase 1 RAG 整層移除 (6 commits)                ✅ 2026-04-29
       └→ Phase 1 收尾（Railway env + extra=strict） ✅ 2026-04-29
  └→ Phase 2 active cleanup (P2.2/2.3/2.4)            ✅ 2026-04-29
       └→ Phase 2.1 /v2/patients deletion             ✅ 2026-04-29
       └→ Phase 2.5 V2AccessLog retire                ✅ 2026-04-29
  └→ Phase 3 病人詳情頁 (3.1/3.2/3.4/3.3, 4 commits)  ✅ 2026-04-29
       └→ Phase 3.1 fallback 拔除                      📅 ~2026-05-06
  └→ Phase 4.1 startup migrations 拆解 (4 commits)    ✅ 2026-04-29
  └→ Phase 5 namespace 收斂                           🔮 看需求才動
```

---

## 完整 backlog 看板

```
✅ 已上線（27 commits）

   Phase 0 (7):
     #1 DB pooler / #2 cache / #3 HIS sync 6× / #4 v2 log /
     #5 charts / #7A #7B http pool

   Phase 1 RAG 整層移除 (6):
     D1a 6a8537545 / D1b fb88ef759 / D1c d42ac156c
     D2a e7bbb0bf9 / D3+D4 129cf67d0 / D5 7c58c32f0
     + Phase 1 closeout: Railway env 清空、config.py extra=strict 已恢復

   Phase 2 操作層清理 (5):
     P2.2 f381c6a3e / P2.3 8b8f56fa7 / P2.4 710e3fc91
     P2.1 + P2.5 本次收尾（/v2/patients + V2AccessLog retire）

   Phase 3 病人詳情頁 (5):
     3.1 e55e1761b (backend) + 39a52fd6a (frontend)
     3.1b 9611e78e7 / 3.2 0747f09e9 / 3.4 bb5c033bc / 3.3 0f843d924

   Phase 4.1 startup migrations 拆解 (4):
     2a a871fcf3b / 3a 480d23856 / 4 d1693c063 / 5 8a6e39f71

📅 觀察期 / 時間 gate
   無短期項目；Phase 3.1 fallback、Phase 2.1、Phase 2.5 已在 2026-04-29 提前收完

🔮 長期 / 看需求（不主動推）
   Phase 5.1  Vercel /api/* namespace 收斂（high-risk）
   Phase 5.2  Router 整合（看實際需求）

🔮 觀察中（沒問題不主動做）
   Sentry / RLS audit / coverage report /
   LLM cost / HIS sync 排程
```

---

## 進度更新規則

- 每完成一個 Phase，回來打勾並把 commit hash 寫上
- 每個 commit 的細節（diff 摘要、測試結果、prod 觀察）push 到 `system-audit-2026-04-28.md`
- 本檔保持「前瞻 roadmap」狀態，不寫每個 commit 的細節
- 出現新項目時加進對應 Phase；不再做的項目刪除並標記 reason

---

## 附錄：每個 Phase 的「我建議」摘要

| Phase | 我建議 | 為什麼 |
|---|---|---|
| 1 | 三邊界決策建議 (a)(b)(c) 全 ✅；走 5 階段分次 commit | dead path 全刪，最大化清晰度 |
| 2 | 找一個下午做完 | 都是低風險小事，累積在一起做最有效率 |
| 3 | 3.1 + 3.2 + 3.4 綁一起做 | aggregate endpoint 開出來時順便重構消費端，避免兩次大改 |
| 4 | 在 Phase 3 完成後立即做 | 修 2 個 prod warning 是低工高收益 |
| 5 | 看實際需求再動 | 高風險，舊路徑相容期至少 1-2 個月 |
| 6 | 不主動 | 等指標說話 |

---

## 附錄：驗證紀錄（2026-04-29）

4 個 agent 平行驗證本 roadmap 的正確性。整體可信度 **95-99%**，5 個漏網已併入上文修正。

### Agent A — Phase 1 RAG 刪除候選

驗證 19 個刪除候選 + 保留清單。**結論：95% 正確**

- 17/19 完全乾淨可直接刪
- 2 個有漏記連動（已併入 D4）：
  - `embedding_cache.py` ← `app/llm.py:1181` lazy-import
  - `_http.py` ← `app/main.py:194-195` close_shared_client lifespan hook
- 保留清單（ai_chat.py / patient_context_builder.py / drug_graph_bridge.py / ddi_check.py / llm.py）全部驗證為非 RAG

### Agent B — Phase 0 commits + Phase 3 數字

逐一驗 13 個 commit hash 與 5 個量化數字。**結論：100% 正確**

- 13 個 commit hash 全部存在於 main，commit 訊息與 roadmap 描述對齊
- patient-detail.tsx 2072 行 ✅
- 42 個 useState ✅
- 0 個 React.memo ✅
- 0 個 Context ✅
- 213 KB raw chunk ✅
- 首屏 7 個並發 API（Promise.all 行 534-540 + 會話列表）✅
- dashboard-stats-cache.ts 51 行 + 2 個 caller（已加註）

### Agent C — Phase 2/4/5 細節

驗證 12 個結構性宣告。**結論：99% 正確**

- patients_v2.py 826 行 ✅
- vercel.json `x-request-id` 出現 8 次（4 path × 2 rules）✅
- startup_migrations.py 真的有 outpatient seed (line 1135) + diagnostic_reports seed (line 1203) 邏輯，~25 個 `pat_001` 命中 ✅
- ui/chart.tsx 真零 caller ✅
- `_archive_candidates/` 19 MB ✅
- **錯誤**：根目錄 artifacts 實際 51 個（不是 22+）— 已修正

### Agent D — RAG 邊界與隱藏依賴

找漏網。**結論：漏網度 2/5（輕微，可補）**

5 個漏網全部已併入上文修正：
1. `app/llm.py:1181` `embedding_cache` import → D4
2. `app/main.py:194-195` close_shared_client → D4
3. `tests/conftest.py:221-226` rag_service fixture → D5
4. 前端 9 個漏列檔（app-sidebar / citation-display / multi-source-loader / clinical-query-panel / drug-comparison-panel / drug-interaction-badges / medication-duplicate-badges / lib/api/medications.ts / hooks/use-ai-readiness.ts）→ D1
5. config.py 實際 32 欄位（不是「約 30」）+ `.env.example` 13 變數 → D5

`guideline_rag_client` 與 `agentic_rag` 確認**真零 active caller**。
