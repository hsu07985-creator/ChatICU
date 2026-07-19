# AI 管線優化研究筆記(2026-07-19 網路調研)

> **2026-07-20 落地狀態**:#1 路由機制+grammar_only→gpt-5.4-mini ✅、#2 prompt_cache_key ✅、
> #3 eval 迴歸集(`backend/evals/ai_regression_cases.yaml` + `scripts/eval_ai_regression.py`,7/7 PASS)✅、
> #4 citation 別名 LLM 判定(取代 llm-2 詞彙表)✅。#5 為 F4 決策輸入、#6/#7 backlog。
> 附帶修正:polish/summary 回應 metadata 過去硬編 `settings.LLM_MODEL`,現在回報實際路由模型;
> `[LLM][CACHE]` log 加 `model=` 欄位。其他 task 要降級前先跑 eval。

> 目的:對照外部現行實踐(2026 文獻/官方指引),找出 ChatICU AI 管線值得做的優化。
> 現況基準:gpt-5.5、byte-stable system prompt 前綴(B15)、cache 命中率 log、
> B09 交互作用 prefetch 硬約束、B14 content/explanation 切分、分段 guardrail、
> citation 白名單稽核(log-only,2026-07-19 起 audit 列才真正落地)、MISS_LIKELY hedging。

## 現況已符合外部共識的(不用動)

| ChatICU 現行 | 外部對應 |
|---|---|
| 精選 snapshot 注入(非整包病歷) | FHIR-AgentBench:整包 FHIR 平均 ~3M tokens,直接注入必敗;「structured state injection」hybrid 是推薦解 |
| B09 prefetch 硬約束(生成前注入交互作用) | 2026 共識:factual 幻覺的緩解要放在**生成上游**(retrieval/tool-call before generation) |
| byte-stable prefix + [LLM][CACHE] 監控 | OpenAI 官方 caching 指引:static→dynamic 排序 + 監控 cached_tokens |
| 分段 guardrail + citation 稽核 + 否定衝突偵測 | 幻覺四型(factual/grounding/citation/reasoning)各自配緩解,不用單一機制打全部 |
| 手寫透明管線(無重型 agent 框架) | 臨床場景可稽核性優先 |

## 建議(依使用者價值排序)

### 1. 模型分層路由(成本,改動小)
現在所有 task 都跑 gpt-5.5($5/$30 per 1M)。輕任務下放:
- `grammar_only` polish、B09 別名判定、query 重述類 → **gpt-5.4-mini**($0.75/$4.5,約 85% 省)甚至 nano
- `summary_depth=brief` 也值得 A/B 測 mini
實作:`TASK_PROMPTS` 已按 task 分發,加一張 per-task model map 即可。**前提是先有 #3 的 eval 集**驗證降級不掉品質。

### 2. `prompt_cache_key`(成本/延遲,近乎一行)
OpenAI 現行指引:設 `prompt_cache_key` 才有可靠的 cache 路由(**GPT-5.6+ 家族更是必設**,cache write 1.25×/read 0.1×)。ChatICU 有 stable prefix 但沒設 key → 以 `session_id` 當 key(同 session 前綴相同)。現有 `[LLM][CACHE]` log 可直接量化前後 hit ratio。注意每個 prefix ~15 RPM 上限——以 ChatICU 流量不構成問題。**升級 5.6 前這是必要功課。**

### 3. Eval 迴歸集 CI 化(品質防線,最高槓桿)
現有 `probe_ai_chat_llm_grounding.py` 是手動探針。建議 promptfoo 型 YAML eval:
- 題源:PADIS 68 題抽 15-20 + 既有 grounding probe 案例 + 本次走測發現的衝突/引用案例
- 斷言:引用格式合法、禁詞、guardrail 必觸發案例、B14 marker 存在、latency/cost 上限、LLM-as-judge 抽查
- 時機:模型升級(5.5→5.6)、prompt/hedging 改動前必跑;可先 pre-deploy 手動,再進 CI
這是 #1 降級決策與未來模型升級的依據。deterministic 斷言便宜穩定、judge 斷言貴且有噪音——分層用。

### 4. Citation 稽核升級語意判定(品質,直接吃掉 llm-2 大半)
白名單字面比對已出現實測假陽性(模型寫「Unfractionated Heparin」、清單是「Heparin」→ `drug_not_in_active_meds`)。低成本解:suspects 非空時,用 nano/mini 做一次「是否為清單內藥物的別名/劑型變體」entailment 判定,再寫 audit(維持 log-only 不阻擋)。這比人工維護 llm-2 詞彙表可持續。2026 文獻方向一致:citation 型幻覺配 verifier(sentence-level alignment + 自我反省去除虛假引用)。

### 5. F4 tool-loop 決策的研究輸入(~07/24 回看時用)
文獻取向 = **hybrid**:curated snapshot 為主,tool-call 只補「snapshot 外長尾」(歷史 lab 趨勢、舊報告全文)。每次 tool call = 一輪額外推理往返,ICU 即時問答延遲敏感 → 若開,建議「2-3 個唯讀查詢工具 + 預設不呼叫」,不要 full agentic。決策依據:觀察期 MISS_LIKELY 樣本若多屬「snapshot 沒有的資料」才值得開;若多屬表達問題,調 prompt 就好。

### 6. Structured Outputs 評估(穩健性,中期、不急)
B14 靠【說明/補充】文字 marker 切分;OpenAI `json_schema` structured outputs 可保證結構,但 streaming + reasoning 模型上有取捨(streaming JSON 需 partial parser——clinical polish 已有 `_extract_json_string_value` 這套)。建議只評估 chat done payload 是否遷移;marker 法目前運作正常,優先級低。

### 7. 多階段對齊(backlog)
ArchEHR-QA 2026 冠軍管線:query 重述 → evidence 打分 → 生成 → **answer-evidence 對齊**。ChatICU 缺的是最後一段——把 citation 稽核從「事後 log」升級為「生成後逐句對齊標註」。成本高、UI 也要配合,放 backlog,等 #3/#4 落地後再評。

## 不建議做

- 整包 FHIR/病歷丟 context(文獻明確失敗模式)
- Anthropic 專屬優化(prod 無額度)
- 重型 agent 框架遷移(可稽核性倒退)

## 來源

- [OpenAI — Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)、[Prompt Caching 201 cookbook](https://developers.openai.com/cookbook/examples/prompt_caching_201)
- [OpenAI API Pricing 2026(GPT-5.5/5.4 全表)](https://www.morphllm.com/openai-api-pricing)、[GPT-5.6 定價](https://www.aipricing.guru/openai-pricing/)
- [HealthNLP_Retrievers at ArchEHR-QA 2026(cascaded grounded clinical QA)](https://arxiv.org/html/2604.26880v1)
- [LLM Hallucination: A 2026 Architectural Deep Dive(四型幻覺分層緩解)](https://futureagi.com/blog/llm-hallucination-deep-dive-2026/)
- [FHIR-AgentBench(整包 FHIR ~3M tokens 失敗)](https://arxiv.org/pdf/2509.19319)
- [Weaviate — Context Engineering](https://weaviate.io/blog/context-engineering)、[Keymakr — Preventing LLM Hallucinations 2026](https://keymakr.com/blog/preventing-llm-hallucinations-techniques-best-practices-2026/)
- [promptfoo 迴歸測試 CI/CD 實踐](https://scrolltest.com/llm-regression-testing-promptfoo/)、[LLM Testing Tools 2026](https://contextqa.com/blog/llm-testing-tools-frameworks-2026/)
