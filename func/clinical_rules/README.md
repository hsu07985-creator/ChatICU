# Clinical Rules 編修指南（JSON Mock 版）

本目錄是目前 `dose` 與 `interaction` 的規則來源。  
設計目標是：你未來只要改 JSON，不用改 API 契約。

## 檔案角色

- `release_manifest.json`
  - 指定目前啟用的 rule set 路徑與版本。
- `dose_rules/dose_rules.v1.mock.json`
  - 劑量規則。
- `interactions/interaction_rules.v1.mock.json`
  - 交互作用規則。

## 規則來源切換（JSON / API）

- `EVIDENCE_RAG_CLINICAL_RULE_SOURCE=json`
  - 使用本目錄 `release_manifest.json` 與本地 JSON 檔（預設）。
- `EVIDENCE_RAG_CLINICAL_RULE_SOURCE=api`
  - 從 `EVIDENCE_RAG_CLINICAL_RULE_API_URL` 讀取遠端 JSON 規則。

### API payload 支援格式

格式 A（單一 bundle）：

```json
{
  "active_release": "clinical_rules_release_2026_03_01",
  "signature": "optional-signature",
  "dose": { "...": "dose payload" },
  "interaction": { "...": "interaction payload" }
}
```

格式 B（manifest + 遠端路徑）：

```json
{
  "active_release": "clinical_rules_release_2026_03_01",
  "rule_sets": {
    "dose": { "url": "https://example.com/dose_rules.v2.json", "version": "2.0.0" },
    "interaction": { "url": "https://example.com/interaction_rules.v2.json", "version": "2.0.0" }
  }
}
```

> `url` 也可用 `path`；若為相對路徑，會以 `EVIDENCE_RAG_CLINICAL_RULE_API_URL` 為 base URL 解析。

## 你日後怎麼改（建議流程）

1. 複製舊檔，建立新版：
   - `dose_rules.v1.1.mock.json`
   - `interaction_rules.v1.1.mock.json`
2. 修改新版規則內容（不要直接覆蓋舊版）。
3. 更新 `release_manifest.json` 的 `path` 與 `version`。
4. 呼叫 API：
   - `POST /rules/reload`
   - `GET /rules/manifest` 確認版本與 rule count。

## 最少必填欄位（dose）

每條 rule 建議至少有：
- `rule_id`
- `drug.generic_name`
- `inputs_required`
- `formula.type`（目前支援 `weight_based_rate`）
- `formula.dose_range.min/max/unit`
- `formula.output_unit`
- `citations[]`

## 最少必填欄位（interaction）

每條 rule 建議至少有：
- `rule_id`
- `drug_pair.a`
- `drug_pair.b`
- `drug_pair.unordered`
- `severity`
- `recommended_action`
- `citations[]`

## 版本與相容性

- API 欄位先維持相容，後續只新增不刪除。
- 規則新增欄位可行，但舊欄位請保留，避免解析失敗。
- `rule_id` 請保持穩定且唯一，方便追蹤與回放。

## 快速檢查命令

```bash
.venv312/bin/python -m py_compile evidence_rag/*.py evidence_rag/clinical/*.py
```

## Golden 驗收（dose + interaction）

```bash
.venv312/bin/python scripts/run_clinical_golden.py
```

或使用 Makefile：

```bash
make clinical-golden
```

## API 快速檢查

- `GET /rules/manifest`
  - 看目前版本與 rule id。
- `POST /rules/reload`
  - 重新載入你改過的 JSON。
- `POST /dose/calculate`
  - 檢查計算輸出是否符合預期。
- `POST /interactions/check`
  - 檢查交互作用分類是否符合預期。

## 衝突規則行為

- 若同一個藥物 pair 命中多條規則且 `severity` 不一致，
  `POST /interactions/check` 會回傳 `conflicts` 陣列，並自動降低 `confidence`。
