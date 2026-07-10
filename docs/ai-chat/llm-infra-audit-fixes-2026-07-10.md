# LLM 基建審查與修補計畫（2026-07-10）

> 本文記錄 2026-07-10 對 ChatICU **LLM 問答基建**的實測審查：以真 LLM（gpt-5.5，8 次真實呼叫）
> 驗證所有 LLM 問答端點的患者資料接地，並端到端實測重複用藥 / 交互作用功能。
> **模型行為本身 6/6 全過**（數值精確、拒絕幻覺、糾正假前提、誠實回報缺口）；
> 問題全部出在**周邊基建**：測試套件、稽核白名單、觀測訊號、prompt 規則。
>
> **進度追蹤**：→ `docs/ai-chat/llm-infra-fixes-progress.md`（每完成一個 T 即更新）。
>
> **審查方法**（可重跑）：
> - `backend/scripts/probe_ai_chat_context.py` — dump LLM 每輪實際看到的 context（零成本）
> - `backend/scripts/probe_ai_chat_llm_grounding.py` — 6 題真 LLM 接地探測（吃 token，含幻覺誘餌/假前提/資料缺口題）
> - `backend/scripts/smoke_test_safety_endpoints.py` — 重複用藥+交互作用端點級煙霧測試（含陰性對照與 word-boundary 回歸）
> - `RUN_REAL_LLM_E2E=1 python3 -m pytest tests/test_e2e_llm.py`（→ 發現 #1）
>
> **嚴重度標記**：🔴 高（必修）｜🟡 中（應修）｜🟢 低（可修）。

---

## 0. LLM 問答端點與接地現況（審查結論：全部有接）

| 端點 | 接地機制 | 判定 |
|------|---------|------|
| `POST /ai/chat/stream` | 快照進 system prompt（病人主檔+50 筆 lab+active 用藥+VS+呼吸器+報告+評分+培養+重複用藥警示）；後續輪 lab delta + 用藥啟停 delta；問題觸發預取（cultures / med-changes / reports / advice，no_data 明示）；矛盾偵測；引用稽核 | ✅ |
| `POST /api/v1/clinical/summary/stream` | `_get_patient_dict()` 即時查 DB，schema envelope 防 prompt injection | ✅ |
| `POST /api/v1/clinical/polish`（+ `/stream`） | 同上 patient dict 進 `input_data["patient"]`；藥師 S/O 段刻意剝除 labs/meds | ✅ |
| `POST /api/v1/clinical/interactions` | **不經 LLM**，純 `drug_interactions` 表查詢 | ✅（無幻覺面） |

真 LLM 6 題實測（吳佳旺 pat_a86cb503）：腎功能數值精確（Cr 6.52/BUN 143.9/eGFR 7.97）、
抗生素三項正確且排除外用藥、vancomycin 誘餌拒答、「已插管」假前提被糾正、
CT 報告缺口誠實回報、重複用藥 4 條警示完整轉述。單輪 6–14 秒，prompt cache 暖機後 72–86%。

---

## 1. 發現清單

### T1 🔴 e2e LLM 測試套件 bit-rot（7/13 fail，且含假綠）

- **檔案**：`backend/tests/test_e2e_llm.py`
- **現象**：`RUN_REAL_LLM_E2E=1` 實跑 → 7 failed / 6 passed，全部 fail 在打 LLM **之前**（404）。
- **根因**：套件打的 5 個端點已被移除——`/api/v1/clinical/summary`（僅剩 stream 版）、
  `/clinical/explanation`、`/clinical/guideline`、`/clinical/decision`、`/ai/chat`（僅剩 `/chat/stream`）。
- **假綠**：`test_e2e_summary_patient_not_found` 期望 404 而「通過」，但 404 的理由是**端點不存在**而非病人不存在。
- **影響**：真 LLM 自動化覆蓋實際只剩 polish 三個變體；因套件 opt-in，CI 永遠不會發現 drift。
- **修法**：改打現存端點（SSE 版需改為串流讀取斷言）；每條測試先 RED 並確認失敗理由正確再 GREEN
  （superpowers `test-driven-development`）。刪掉對應已移除端點且無替代的測試。

### T2 🟡 Citation audit 白名單過窄 → 正確引用被記成「疑似造假」進 audit_logs

- **檔案**：`backend/app/services/citation_audit.py:45`（`_KNOWN_SECTIONS`）
- **現象**：實測當場誤報 2 次——Q4 引用【患者基本】、Q6 引用【用藥安全摘要】都被寫入
  `ai_chat_citation_fabrication_suspected`（status=detected）審計事件。
- **根因**：快照實際有 ~10 個 section（患者基本、用藥安全摘要、腎功能/給藥摘要、呼吸器、
  臨床評分、資料狀態…），`_KNOWN_SECTIONS` 只列 4 個（用藥/關鍵檢驗/生命徵象/影像/報告）。
- **影響**：審計日誌被誤報污染，稀釋真造假警報的可信度。
- **修法**：白名單自 `patient_context_builder/formatters.py` 的 section 標題常數導出（治本），
  或至少補全 10 個。先寫失敗測試：「引用【患者基本】→ 不得標 suspect」。

### T3 🟡 Hedging／`MISS_LIKELY` 偵測過敏，污染 F4 tool-loop 決策數據

- **檔案**：`backend/app/services/ai_chat/observability.py`（`_HEDGING_PATTERNS` / `log_hedging_signal`）
- **現象**：Q1、Q6 完整精確作答，只因負責任註明「目前資料缺少 MAR／尿量」命中「缺少」等關鍵詞，
  被記 `[CHAT][PREFETCH][MISS_LIKELY]`。
- **影響**：此訊號是 `ai-chat-tool-loop-decision-2026-05-03.md` §5 決定「要不要建 LLM tool loop」的
  依據（signal B），照現行敏感度統計會嚴重高估 miss 率。
- **修法**：**設計問題，先 brainstorm 再動手**——候選方向：只掃首段（主回答）、引用了精確數值即豁免、
  hedge 詞須與問題主體同段才計。修完以 6 題探測驗收：Q1/Q6 不得再觸發 MISS_LIKELY。

### T4 🟡 資料時效不會主動示警（74 天舊資料以「目前」口吻回答）

- **檔案**：`backend/app/llm/prompts.py:286`（`TASK_PROMPTS["icu_chat"]`）
- **現象**：檢驗停在 2026-04-26 的病人被問「現在的腎功能」，回覆以「目前」開頭；
  時戳僅出現在括註引用內（部分緩解），【資料狀態】的缺口未被要求優先呈現。
- **影響**：臨床讀者最容易忽略的坑——把數月前的數值當今日判讀。
- **修法**：**設計問題，先 brainstorm**——prompt 加 staleness 規則（如「引用之最新檢驗距今 >N 天時，
  主回答第一句須註明資料日期」）；N 與措辭需對齊臨床使用情境（prod 有 HIS sync 時多為當日資料）。
  修完以 Q1 重測：首句須出現資料日期警示。

### T5 🟢 已知未修二條（review doc 標記 open，本次確認仍在）

- **llm-2**：citation audit 只嚴格驗證【用藥】（`_STRICT_SECTIONS`），關鍵檢驗/生命徵象/影像的
  引用只計數不驗值（`citation_audit.py:54,140-142`）。
- **llm-4**：`m.unit` 為空時劑量渲染成無單位數字（`formatters.py` `_fmt_med_section`）。
- 出處：`docs/codebase-health/codebase-systematic-review-2026-06-03.md`。

### T6 🟢 死碼：`generate_clinical_summary` import 無人呼叫

- **檔案**：`backend/app/routers/clinical.py:52`、`backend/app/services/llm_services/clinical_summary.py`
- **現象**：非串流 `/summary` 端點移除後遺留；整個 `llm_services/clinical_summary.py` 已無使用端。
- **修法**：刪 import + 評估刪整個 service 檔（含 `tests/test_services/test_clinical_summary.py` 的歸屬確認）。

---

## 2. 非問題觀察（記錄即可，勿修）

- 同 session 第二輪 prompt cache 命中 0%：連續快發時 OpenAI cache 寫入尚未生效，第三輪起 72–86%，真實使用節奏不會發生。
- `httpx ASGITransport` 緩衝整個 SSE 回應 → 探測腳本的 first_token≈total 是量測侷限，非產品 bug（串流延遲看 `[CHAT][TIMING]`）。
- `local/data/drug_interactions/.../drug_graph_rag.py` 本機缺檔 → `/pharmacy/drug-interactions` 正常 fallback 到 DB（by design，`local/` 為機器本地資料）。

---

## 3. 建議修補順序（使用者價值優先）

T2（每日污染真實 audit log）→ T3（正在誤導 F4 決策統計）→ T4（臨床誤讀風險）→
T1（測試安全網，修 T2–T4 前先有 RED 基準更好，可與 T2 並行）→ T6 → T5。

搭配 superpowers 方法論：T3/T4 先 `brainstorming`（設計對齊）；全部走 `test-driven-development`
（先 RED 且確認失敗理由）；宣告完成前 `verification-before-completion`
（重跑 §審查方法四支武器，附輸出證據）。
