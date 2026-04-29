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

> **現在最划算**：把 RAG 死的代碼刪掉（讓代碼變乾淨），然後做病人詳情頁大整理（讓使用者體驗變快）。剩下的都是維運品質提升，不急。

| 階段 | 內容 | 工 | 何時 |
|---|---|---|---|
| ✅ Phase 0 | 13 個 commits 已上線（DB、cache、HIS sync、bundle、http pool） | 完成 | — |
| ✅ Phase 1 | RAG 整層移除（**已完成 2026-04-29**，6 commits、~6800 行 prod + 1500 行 test 刪除） | 1.5 天 | 完成 |
| 🟡 Phase 2 | 清雜物（active cleanup 已完成；P2.1 + P2.5 deferred to **2026-05-13+** 等觀察期） | 半天 active；剩餘 deferred | active 已完成 2026-04-29 |
| 🔥 Phase 3 | 病人詳情頁大整理（API fan-out + 拆檔 + memo） | 3-4 天 | **下一步**（先 preflight） |
| 🛠️ Phase 4 | startup_migrations 拆解 + 修 prod warning | 1-2 天 | Phase 3 完後 |
| 🚧 Phase 5 | Vercel `/api/*` namespace 收斂 | 2-3 天 | Phase 4 完後 |
| **合計** | **約 8-11 天工** | | **Phase 1 從現在算起 3-4 週內完成** |

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

### Phase 1 結尾還沒做的事

| 項目 | 負責 | 備註 |
|---|---|---|
| Railway dashboard 清掉殘留 RAG env vars | 你（手動） | 不影響 runtime（已加 `extra="ignore"`），純清潔 |
| 觀察 prod log 1-2 天確認無 ImportError | 你 | Railway redeploy 已驗證 /health 200 |
| 當 Railway env 清乾淨後，把 `app/config.py:124` 的 `"extra": "ignore"` 改回嚴格 | 任何時候 | 讓未來 typo 能立即發現 |

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

## 🟡 Phase 2 — 操作層清理（active 已完成 2026-04-29；觀察類 deferred）

### 已完成（active cleanup）

| # | Commit | 內容 |
|---|---|---|
| P2.2 | `f381c6a3e` | `src/components/ui/chart.tsx` dead code 整刪（-353 行） |
| P2.3 | `8b8f56fa7` | `.gitignore` 加 `/*.png` `/*.yml` `.env.local` `.playwright-cli/` 等 root-only patterns（+14 行）；51 個 .png/.yml 從 `git status` 雜訊消失 |
| P2.4 | `710e3fc91` | `backend/scripts/sync_his_snapshots_serial.py` 提交版本庫（+165 行）；之前 untracked，CLAUDE.md 引用但不在 repo |

### Deferred（等觀察期到才動）

| # | 項目 | 觸發條件 | 預估執行時間 |
|---|---|---|---|
| P2.1 | `/v2/patients` deletion（router + tests + Vercel rewrite + `src/lib/api/layer2-mode.ts`；保留 `services/layer2_store.py` 給 `scores.py` 用） | V2_ACCESS log 累積 1-2 週 0 命中 | **2026-05-13+** |
| P2.5 | V2AccessLog middleware retire | P2.1 完成後 | 2026-05-13+ |

**為什麼 defer**：V2_ACCESS log 從 `cdb4a6ab0`（2026-04-29 上午）才開始記錄，現在觀察窗 < 24h，不足以判斷 prod 真的零流量。提早刪會失去驗證依據——若有外部 cron / 監控 / 殘留腳本還在打 `/v2/patients`，會在 P2.1 後才發現。

**到觀察日期後做的事**：
```bash
railway logs --since 14d | grep -c V2_ACCESS
railway logs --since 14d | grep V2_ACCESS | grep -oE 'route=[^ ]+' | sort | uniq -c
```
- 若 0 hit / 全是健檢 UA → 執行 P2.1 + P2.5
- 若有未知 user_hash → 用 hash 對照 user 表找 caller，先聯絡再決定

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

## 🏗️ Phase 3 — 前端架構（中期）

3-4 天工。最有感的前端優化——進病人頁從 3-5 秒 → 1 秒以內。

### 目前的問題

- 進入單一病人頁要打 4-7 個 API（病人資料、用藥、訊息、呼吸器、撤管、聊天記錄...），每通電話 700ms，總共要等 3-5 秒
- `patient-detail.tsx` 一個檔 2072 行，42 個狀態變數，零個 React.memo
- 隨便打字一個輸入框，整個 2000 行樹都會重新渲染

### 任務拆解

| # | 項目 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| **3.1** | Patient detail initial bundle endpoint | 中 | 1-2 天 | 進入單一病人頁從 4-7 個 API → 1 個 aggregate；首屏少 3-5 秒 |
| **3.2** | `patient-detail.tsx` 拆檔 + memo + Context | 中 | 1-2 天 | 2072 行、42 useState、0 React.memo；目前任一 state 動就重渲整個 tree |
| **3.3** | `dashboard-stats-cache.ts` 整檔刪、改 TanStack | 低 | 半天 | 雙軌 cache 完全收斂；**agent 註**：51 行檔本身可刪，但要先清 2 個 caller（`src/lib/patient-data-sync.ts:2`、`src/pages/dashboard.tsx:20`） |
| **3.4** | Patient detail tab 化 lazy | 中 | 半天 | 減少 patient-detail bundle（目前 213 KB raw） |

**註**：3.1 + 3.2 強烈建議綁在一起做。先 3.1 開 aggregate endpoint，3.2 順便重構消費端。

### 3.1 設計提示（防超大包）

aggregate endpoint 採 **initial bundle** 策略：只包**首屏必要**資料（patient meta + 預設 tab 的關鍵摘要）。其他 tab 仍 lazy fetch，但用 TanStack `useQueries` 共用 cache 避免同份資料被多個 effect 重抓。**不**做成「一次回所有資料」。

### 3.2 設計提示

- 用 React Profiler 量測後再決定哪個 tab 拆優先
- 不只憑 useState 數量或行數判斷
- 拆檔方向：聊天 / 用藥 / 檢驗 / 訊息 / 呼吸器 各自獨立子元件 + 各自 useReducer
- Cross-tab 共享資料用 Context

---

## 🛠️ Phase 4 — 啟動雜訊清理

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

## 🚧 Phase 5 — 結構性收斂（長期）

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

## 執行順序（Gantt 簡化）

```
Phase 1 RAG 刪除 (5 commits)         [現在] ─┐
Phase 2.3 根目錄清理                   [P1 中可平行] ─┐
                                                     ↓
Phase 2.1 /v2/patients 刪除（等觀察期 1-2 週）         ↓
Phase 2.2 / 2.4 / 2.5 雜項             [跟 P3 一起順手做]
                                                     ↓
Phase 3.1 + 3.2 + 3.4 Patient detail 大整理（建議綁一起做）
                                                     ↓
Phase 3.3 dashboard-stats-cache 收斂
                                                     ↓
Phase 4.1 + 4.2 startup migrations 拆解（修兩個 prod warning）
                                                     ↓
Phase 5.1 Vercel /api/* namespace（最長期）
                                                     ↓
Phase 5.2 router 整合（看實際需求）
```

---

## 完整 backlog 看板

```
✅ 已上線（19 commits）
   Phase 0:
     #1 DB pooler / #2 cache / #3 HIS sync 6× / #4 v2 log /
     #5 charts / #7A #7B http pool
   Phase 1 RAG 整層移除:
     D1a 6a8537545 / D1b fb88ef759 / D1c d42ac156c
     D2a e7bbb0bf9 / D3+D4 129cf67d0 / D5 7c58c32f0

🟡 Phase 2 active cleanup 已完成
   ✅ P2.2 (f381c6a3e)  ui/chart.tsx dead code
   ✅ P2.3 (8b8f56fa7)  .gitignore root artifacts
   ✅ P2.4 (710e3fc91)  sync_his_snapshots_serial.py tracked

🔥 下一步
   Phase 3 preflight: 量 patient-detail API fan-out / 拆檔邊界

📅 排隊（已盤點，等動）
   Phase 2.1  /v2/patients deletion         → 等 V2_ACCESS 觀察 (2026-05-13+)
   Phase 2.5  V2AccessLog middleware retire → 等 P2.1

   Phase 3.1  Patient detail initial bundle endpoint  (#8)
   Phase 3.2  patient-detail.tsx 拆 + memo + Context  (#9)
   Phase 3.3  dashboard-stats-cache 收斂 → TanStack   (#11)
   Phase 3.4  Patient detail tab lazy

   Phase 4.1  startup_migrations 拆解（修 2 個 prod warning）  (#10)
   Phase 4.2  Procfile/deploy 健康檢查嚴格化

   Phase 5.1  Vercel /api/* namespace  (#12)
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
