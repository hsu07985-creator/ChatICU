# Func 專案（獨立可執行）

此資料夾已整理成可獨立執行的 RAG + Clinical Engine 專案。

## 目錄結構

- `evidence_rag/`
  - RAG 核心程式與 API（ingest / query / clinical endpoints）
- `evidence_rag/clinical/`
  - 劑量與交互作用 deterministic engine
  - `/clinical/query` 使用 LLM intent classifier（`intent=auto` 時，strict no-fallback）
  - `JsonRuleRepository` / `ApiRuleRepository`
- `clinical_rules/`
  - 規則資料與 golden 測試案例
- `raganything/`
  - 文件解析相關程式（供 ingestion 使用）
- `scripts/run_clinical_golden.py`
  - 規則引擎驗收（60 cases）
- `run.sh`
  - 一鍵流程：ingest -> eval(可關閉) -> 啟 API
- `Makefile`
  - 常用指令入口

## 快速開始

1. 準備環境
```bash
cd func
cp env.example .env
```

2. 啟動 API（不跑 eval）
```bash
make quick
```

3. 只跑規則驗收
```bash
make clinical-golden
```

4. 跑 AO-07 Golden Regression Gate（含品質閥值）
```bash
cd ..
scripts/golden/run_clinical_golden.sh
```

## 常用指令

- `make ingest`：增量向量化
- `make ingest-force`：強制重建向量
- `make eval`：RAG 評估
- `make api`：只啟動 API
- `make run`：ingest + eval + API
- `make quick`：ingest + API（`RUN_EVAL=0`）
- `make intent-test`：LLM 意圖分類器單元測試（mock）
- `scripts/golden/run_clinical_golden.sh`：Golden set 回歸（可用 `GOLDEN_MIN_PASS_RATE` 等 env 設定閥值）

## 規則來源切換

- 預設 `json`：
  - `EVIDENCE_RAG_CLINICAL_RULE_SOURCE=json`
- 切 `api`：
  - `EVIDENCE_RAG_CLINICAL_RULE_SOURCE=api`
  - `EVIDENCE_RAG_CLINICAL_RULE_API_URL=...`
