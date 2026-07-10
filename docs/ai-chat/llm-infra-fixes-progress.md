# LLM 基建修補進度

> 對應 `docs/ai-chat/llm-infra-audit-fixes-2026-07-10.md`。每完成一個 T，更新此檔。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄　🚧 部分完成

**最後更新**：2026-07-10（T2 完成；T3/T4 brainstorm 中）

---

## 任務面板

| Task | 嚴重度 | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|--------|------|---------|------|------|
| T2 | 🟡 | citation audit `_KNOWN_SECTIONS` 補全（建議自 formatters section 常數導出） | `backend/app/services/citation_audit.py:45`、`tests/test_services/test_citation_audit.py` | ① 新測試「引用【患者基本】/【用藥安全摘要】→ 無 suspect」先 RED 後 GREEN ② 跑 `probe_ai_chat_llm_grounding.py`，log 無 `fabrication_suspected` 誤報 | ✅ |
| T3 | 🟡 | hedging 偵測去敏（先 brainstorm 設計：首段限定／精確數值豁免） | `backend/app/services/ai_chat/observability.py` | ① 單元測試：完整作答+「缺少 MAR」註記 → 不觸發 ② 6 題探測 Q1/Q6 無 `MISS_LIKELY` | ☐ |
| T4 | 🟡 | `icu_chat` prompt 加資料時效規則（先 brainstorm N 天門檻與措辭） | `backend/app/llm/prompts.py:286` | 真 LLM 重測 Q1：最新檢驗 >N 天時首句出現資料日期警示 | ☐ |
| T1 | 🔴 | e2e LLM 套件改打現存端點（SSE 斷言）、清除假綠、刪無替代端點的測試 | `backend/tests/test_e2e_llm.py` | `RUN_REAL_LLM_E2E=1 pytest tests/test_e2e_llm.py` 全綠，且每條曾確認 RED 理由正確 | ☐ |
| T6 | 🟢 | 刪死 import `generate_clinical_summary`（評估連同 service 檔+測試一起刪） | `backend/app/routers/clinical.py:52`、`backend/app/services/llm_services/clinical_summary.py` | pytest 全套綠 | ☐ |
| T5 | 🟢 | llm-2（非用藥 section 值驗證）、llm-4（無單位劑量 fallback） | `backend/app/services/citation_audit.py`、`backend/app/services/patient_context_builder/formatters.py` | 各一條紅綠單元測試 | ☐ |

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

- **T2**（2026-07-10）：白名單單一事實來源移至 `patient_context_builder/formatters.py` 的
  `SNAPSHOT_SECTION_TITLES`（14 個 base 名稱，含 safety.py 的用藥安全摘要與 4 個 prefetch 標題）；
  `citation_audit._section_is_known()` 支援參數化標題（`【微生物培養 最近14天】`、`【最近72小時用藥變更】`）。
  防 drift：`test_whitelist_covers_every_emitted_section_title` 掃描三個 emitter 原始碼，
  新增 section 未進白名單會直接紅。RED→GREEN 完成；真 LLM 探測待全部修完後一次跑。

## 基準紀錄（2026-07-10 審查時）

- 真 LLM 接地 6/6 過；單輪 6–14 s；cache 暖機後 72–86%
- 重複用藥/交互作用測試 202 passed / 3 skipped；smoke PASS
- e2e LLM：7 failed / 6 passed（T1 修前的 RED 基準）
- 誤報實錄：`fabrication_suspected` ×2（患者基本、用藥安全摘要）；`MISS_LIKELY` ×2（Q1、Q6）
