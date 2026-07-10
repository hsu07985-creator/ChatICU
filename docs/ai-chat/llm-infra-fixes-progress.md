# LLM 基建修補進度

> 對應 `docs/ai-chat/llm-infra-audit-fixes-2026-07-10.md`。每完成一個 T，更新此檔。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄　🚧 部分完成

**最後更新**：2026-07-10（**全部 6 個 T 完成**，真 LLM 探測二輪驗收通過；
已 push `personal main` 部署 Railway，`/health` healthy。同日追加：B09 交互作用
prefetch、B14 content/explanation 拆分，亦已部署——見
`docs/coordination/backend-tasks.md` 對應 DONE 條目）

---

## 任務面板

| Task | 嚴重度 | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|--------|------|---------|------|------|
| T2 | 🟡 | citation audit `_KNOWN_SECTIONS` 補全（建議自 formatters section 常數導出） | `backend/app/services/citation_audit.py:45`、`tests/test_services/test_citation_audit.py` | ① 新測試「引用【患者基本】/【用藥安全摘要】→ 無 suspect」先 RED 後 GREEN ② 跑 `probe_ai_chat_llm_grounding.py`，log 無 `fabrication_suspected` 誤報 | ✅ |
| T3 | 🟡 | hedging 偵測去敏（先 brainstorm 設計：首段限定／精確數值豁免） | `backend/app/services/ai_chat/observability.py` | ① 單元測試：完整作答+「缺少 MAR」註記 → 不觸發 ② 6 題探測 Q1/Q6 無 `MISS_LIKELY` | ✅ |
| T4 | 🟡 | `icu_chat` prompt 加資料時效規則（先 brainstorm N 天門檻與措辭） | `backend/app/llm/prompts.py:286` | 真 LLM 重測 Q1：最新檢驗 >N 天時首句出現資料日期警示 | ✅ |
| T1 | 🔴 | e2e LLM 套件改打現存端點（SSE 斷言）、清除假綠、刪無替代端點的測試 | `backend/tests/test_e2e_llm.py` | `RUN_REAL_LLM_E2E=1 pytest tests/test_e2e_llm.py` 全綠，且每條曾確認 RED 理由正確 | ✅ |
| T6 | 🟢 | 刪死 import `generate_clinical_summary`（評估連同 service 檔+測試一起刪） | `backend/app/routers/clinical.py:52`、`backend/app/services/llm_services/clinical_summary.py` | pytest 全套綠 | ✅ |
| T5 | 🟢 | llm-2（非用藥 section 值驗證）、llm-4（無單位劑量 fallback） | `backend/app/services/citation_audit.py`、`backend/app/services/patient_context_builder/formatters.py` | 各一條紅綠單元測試 | ✅ |

> 順序依使用者價值：T2 → T3 → T4 → T1 → T6 → T5（詳見 audit 文件 §3）。

---

## 驗收武器（宣告完成前必跑）

```bash
cd backend

# 1. 零成本：dump LLM 實際看到的 context
python3 scripts/probe_ai_chat_context.py

# 2. 端點級煙霧測試（重複用藥+交互作用，結尾應 PASS）
python3 -m scripts.smoke_test_safety_endpoints

# 3. 真 LLM 6 題接地探測（吃 token；觀察 CITATION suspects / MISS_LIKELY）
python3 -m scripts.probe_ai_chat_llm_grounding

# 4. 真 LLM e2e 套件
RUN_REAL_LLM_E2E=1 python3 -m pytest tests/test_e2e_llm.py -q

# 5. 相關單元/API 測試
python3 -m pytest tests/test_services/test_citation_audit.py \
  tests/test_services/test_duplicate_detector.py tests/test_api/test_pharmacy_duplicate_check.py \
  tests/test_api/test_pharmacy_interactions_bridge.py tests/test_api/test_clinical.py -q
```

## 完成紀錄

- **T1**（2026-07-10）：summary/chat 5 條改打 `/summary/stream`、`/ai/chat/stream`
  （SSE frame 解析斷言：delta 重組 = done payload、error frame 即 fail）；
  explanation/guideline/decision 3 條無替代端點刪除；假綠
  `summary_patient_not_found` 改斷言 404 detail 含病人 ID（區分 route-404）；
  發現並固定新行為：`/ai/chat/stream` 對不存在 patientId 回 **404**（W1-T1 ACL
  `assert_patient_chat_access`），非舊 `/ai/chat` 的無 context 降級。
  RED 基準＝審查時 7 failed；真 LLM 重跑 **10 passed / 56s**。
- **T3**（2026-07-10，設計拍板＝候選 C「同段關鍵詞比對」，**實測後疊加候選 B 引用豁免**）：
  MISS_LIKELY 改用 `_reply_hedges_on_question_subject(reply, question)`——從原始問題
  抽主體詞（ASCII 藥名/縮寫 + 去停用詞後 ≥2 字中文詞串），找回覆中**第一個含主體詞
  的段落**（依 prompt 強制格式即主回答段），該段 hedge **且無（依【…】）引用**才記
  miss；抽不到主體詞時保守 fallback 掃首段。`_reply_looks_hedged` 全文掃描保留給
  `[REPLY][HEDGED]` info log（新增 `subject_hedged` 欄位）。`body.message`（未注入
  context 的原始問題）經 `_event_stream(original_message=…)` 穿入。
  **設計修正緣由**：第一輪真 LLM 探測發現 T4 新規則會把資料缺口註記推進主回答段
  （「缺口與問題相關須在主回答點出」），純 C 的段落比對在 Q1/Q6 仍誤觸；而誤報段
  都有精確引用、DAY20 真 miss 沒有——引用即接地證據。第二輪探測 6/6 turn
  MISS_LIKELY=0、DAY20 單元真陽性仍觸發。
- **T4**（2026-07-10，門檻拍板 N=3 天）：`icu_chat` prompt 新增「資料時效規則」——
  最新時戳距資料時間 >3 天時主回答第一句標明資料日期且禁用「目前/現在」口吻；
  ≤3 天不加註（prod HIS sync 當日資料不觸發）；【資料狀態】缺口與問題相關時須在
  主回答點出。驗收＝真 LLM 重測 Q1 首句出現資料日期，待跑。
- **T2**（2026-07-10）：白名單單一事實來源移至 `patient_context_builder/formatters.py` 的
  `SNAPSHOT_SECTION_TITLES`（14 個 base 名稱，含 safety.py 的用藥安全摘要與 4 個 prefetch 標題）；
  `citation_audit._section_is_known()` 支援參數化標題（`【微生物培養 最近14天】`、`【最近72小時用藥變更】`）。
  防 drift：`test_whitelist_covers_every_emitted_section_title` 掃描三個 emitter 原始碼，
  新增 section 未進白名單會直接紅。RED→GREEN 完成；真 LLM 探測二輪共 12 turn
  suspects=none（含引用患者基本/用藥安全摘要/資料狀態/腎功能給藥摘要/微生物培養 最近14天）。
- **T5**（2026-07-10）：llm-2 做**安全子集**——關鍵檢驗/生命徵象引用必須含數值
  （`no_value_in_citation`），完整「值 vs snapshot」比對維持延後（嚴格比對中文檢驗
  全名需要 lab 別名詞彙表，硬上會重演 T2 誤報污染；模組 docstring 保留原 revisit
  條件）。llm-4：`m.unit` 空時劑量渲染 `500(單位未記錄)`，防 LLM 腦補單位。
  各紅綠單元測試在 `test_citation_audit.py` / `test_snapshot_formatters.py`（新檔）。
- **T6**（2026-07-10）：`llm_services` 整包（僅 clinical_summary.py + __init__）無任何
  使用端，連同死 import 與孤兒測試一起刪。

## 基準紀錄（2026-07-10 審查時）

- 真 LLM 接地 6/6 過；單輪 6–14 s；cache 暖機後 72–86%
- 重複用藥/交互作用測試 202 passed / 3 skipped；smoke PASS
- e2e LLM：7 failed / 6 passed（T1 修前的 RED 基準）
- 誤報實錄：`fabrication_suspected` ×2（患者基本、用藥安全摘要）；`MISS_LIKELY` ×2（Q1、Q6）

## 修後驗收紀錄（2026-07-10 全部完成時）

- 真 LLM 6 題探測（第二輪）：CITATION suspects **0**、MISS_LIKELY **0**（hedge 全部
  正確降級為 `[REPLY][HEDGED]` info，`subject_hedged=False`）
- T4 生效實錄：Q1 首句「依 **2026-04-26 22:30** 的最新檢驗值（非即時資料）…」、
  Q6 首句「依 **2026-04-27 23:12** 的目前用藥資料（非即時資料）…」
- e2e LLM：`RUN_REAL_LLM_E2E=1` **10 passed** / 56s
- 全套 pytest：**824 passed / 31 skipped**；`probe_ai_chat_context.py` 正常、
  `smoke_test_safety_endpoints` PASS
- 新固定行為：`/ai/chat/stream` 對不存在 patientId 回 404（W1-T1 ACL）
