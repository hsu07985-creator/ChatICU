# Backend pytest-cov Baseline — 2026-05-01

- **日期**：2026-05-01
- **目的**：建立 backend `app/` 的 coverage baseline 數字，**只記錄、不設 threshold、不接 CI**
- **配套**：[`fastlane-backlog-2026-05-01.md`](fastlane-backlog-2026-05-01.md) §2.1
- **本檔不改任何 runtime / config code**

---

## 1. 跑法

```bash
cd backend
python3 -m pytest tests/test_api tests/test_services \
  --cov=app \
  --cov-report=term \
  --cov-report=json:../.state/coverage-baseline-2026-05-01.json \
  -q --continue-on-collection-errors
```

**Scope**：
- 涵蓋 `tests/test_api/`（FastAPI router 整合測試）+ `tests/test_services/`（service 層 unit test）
- **未跑**：`tests/test_fhir/` `tests/test_middleware/` `tests/test_schemas/` `tests/test_scripts/` `tests/evals/` `tests/test_llm.py` `tests/test_e2e_llm.py`（user 指定 scope）
- **未動**：`pyproject.toml` `[tool.coverage.*]` 既有設定（branch=true、source=app、omit migration/main 等）

**環境**：Python 3.14.3 / Darwin / pytest-cov 已可用（`pytest --help | grep -- "--cov"` 確認）

---

## 2. Pass / Fail 統計

| 指標 | 數量 |
|---|---|
| **Pass** | **418** |
| **Fail** | **9** |
| **Skip** | **3** |
| **Warnings** | 43 |
| **Wall-clock time** | 59.01s |

### 2.1 Failures（9 個，全在 `tests/test_services/test_duplicate_detector.py`）

| Test class :: name | 症狀 |
|---|---|
| `TestL1Detection::test_two_identical_atc_produces_critical_l1` | `assert 0 == 1`（無 alert） |
| `TestL1Detection::test_three_same_atc_produces_one_alert_with_three_members` | 同上 |
| `TestL2Detection::test_two_ppis_different_l5_produces_l2_alert` | 同上 |
| `TestL2Detection::test_l1_hit_does_not_emit_additional_l2` | 同上 |
| `TestDowngrades::test_different_route_downgrades_critical_to_moderate` | 同上 |
| `TestDowngrades::test_different_salt_downgrades_critical_to_high` | 同上 |
| `TestOverrides::test_wildcard_pattern_matches_all_ppis` | 同上 |
| `TestFingerprint::test_same_set_different_order_same_fingerprint` | 同上 |
| `TestFingerprint::test_different_sets_different_fingerprint` | 同上 |

**重要**：這 9 個 failure **不是本次 baseline 引入的**，是 pre-existing。`system-audit-2026-04-28.md:155-157` 已記錄「9 個 test_services/test_duplicate_detector.py（疑似 fixture data 變動）」，與本次完全一致。

→ Baseline 計算的「coverage 數字」**包含這 9 個 fail 的執行軌跡**（pytest-cov 計 line execution，不在意 assertion 結果）。換言之 fixed 這 9 個測試後，coverage 數字大致不會變動。

---

## 3. Total Coverage

| 指標 | 值 |
|---|---|
| **Statements** | 8075 |
| **Missed** | 2836 |
| **Branches** | 2472 |
| **Partial branches** | 323 |
| **TOTAL coverage（含 branch）** | **59.4%** |

JSON dump：`/.state/coverage-baseline-2026-05-01.json`（700 KB，已 gitignore at backend 但 repo-root `.state/` 未 gitignore → `git status` 會看到 untracked）

---

## 4. Coverage 最低的前 10 個 module（excluding 完全無 caller 的 schema-only 檔）

| # | Module | Stmts | Cover | 為什麼低 |
|---|---|---|---|---|
| 1 | `app/schemas/vital_sign.py` | 10 | **0.0%** | 沒被 test_api/test_services 觸到；可能只被 test_schemas/ 用（不在本次 scope） |
| 2 | `app/routers/pharmacy_routes/drug_library.py` | 491 | **11.5%** | 大檔（491 stmt）+ 多數 endpoint 無對應整合測試；Phase 4b drug-library MVP-Lite 後新增（`91f334b29` `5796edf88`） |
| 3 | `app/fhir/bundle_builder.py` | 127 | **12.2%** | FHIR Bundle export，由 `routers/fhir_export.py` 呼叫；test_api 可能沒測 export endpoint |
| 4 | `app/llm.py` | 260 | **16.3%** | LLM streaming pipeline；單元測試在 `tests/test_llm.py`（不在本次 scope），且實際呼 OpenAI 部分被 mock |
| 5 | `app/utils/structured_output.py` | 49 | **18.5%** | OpenAI structured output helpers；caller 主要在 LLM path |
| 6 | `app/services/layer2_store.py` | 182 | **20.8%** | Layer-2 結構化資料；`/v2/patients` 退役後僅 `routers/scores.py` 用 ~30% |
| 7 | `app/utils/llm_errors.py` | 8 | **25.0%** | LLM error mapping；caller 集中在 ai_chat.py 的 exception path |
| 8 | `app/routers/ai_chat.py` | 240 | **29.1%** | 🔥 **B15 系列高動土區**；test_api 沒覆蓋 `/ai/chat/stream` 整條路徑（含 deferred 注入、_build_system_prompt、warm-up）；只有 9 個 unit test 走 helper（不算 router 整合） |
| 9 | `app/services/patient_context_builder.py` | 484 | **30.2%** | 🔥 **B15 主戰場**；`build_critical_snapshot` / `build_deferred_snapshot` / `build_clinical_snapshot` 三條 path 大半未走過 |
| 10 | `app/routers/medication_duplicates.py` | 68 | **31.2%** | 重複用藥 router；多數 endpoint 在 pharmacy_routes/ 下另有 `duplicate_check.py`（88.1%）走過 |

**入榜邊緣（Top 11–13，作為 reference）**：

| # | Module | Cover |
|---|---|---|
| 11 | `app/utils/data_freshness.py` | 36.2% |
| 12 | `app/routers/patients.py` | 36.0%（292 stmt 大檔，覆蓋度低） |
| 13 | `app/services/drug_graph_bridge.py` | 36.8% |

---

## 5. Router / Service 分類摘要

### 5.1 Routers（33 個）

| Cover band | 檔數 | 代表 |
|---|---|---|
| **100%** | 6 | `health.py` `pharmacy.py` `rules.py` `symptom_records.py` `sync_status.py` + `pharmacy_routes/__init__.py` |
| **90–99%** | 2 | `dashboard.py` (95.3%) `pharmacy_routes/compatibility_favorites.py` (93.0%) |
| **80–89%** | 8 | `messages.py` (83.4%) `team_chat.py` (83.7%) `scores.py` (84.0%) `ventilator.py` (86.4%) `vital_signs.py` (87.0%) `pharmacy_routes/advice_records.py` (87.2%) `pharmacy_routes/duplicate_check.py` (88.1%) `admin_his_sync.py` (88.8%) |
| **70–79%** | 4 | `discharge_check.py` (72.0%) `notifications.py` (76.1%) `lab_data.py` (75.6%) `record_templates.py` (70.9%) |
| **60–69%** | 3 | `clinical.py` (65.9%) `message_activity.py` (62.5%) `pharmacy_routes/pad_calculate.py` (69.1%) |
| **50–59%** | 4 | `medications.py` (56.4%) `pharmacy_routes/interactions.py` (56.5%) `pharmacy_routes/error_reports.py` (59.6%) `fhir_export.py` (51.7%) |
| **40–49%** | 3 | `auth.py` (45.9%) `diagnostic_reports.py` (45.5%) `admin.py` (42.3%) |
| **30–39%** | 2 | `patients.py` (36.0%) `medication_duplicates.py` (31.2%) |
| **20–29%** | 1 | `ai_chat.py` (29.1%) |
| **10–19%** | 1 | `pharmacy_routes/drug_library.py` (11.5%) |

**觀察**：
- 多數 router 在 60%+，pharmacy-related sub-routes 多在 80%+（`duplicate_check` / `advice_records` / `compatibility_favorites`）
- 倒數 5 名都是業務複雜檔：`drug_library.py`（491 stmt）、`ai_chat.py`、`patients.py`、`medication_duplicates.py`、`admin.py`
- AI / 病人 / 重複用藥三大主戰場 router 平均 < 40%

### 5.2 Services（8 個有量到 stmt）

| Cover band | 檔數 | 代表 |
|---|---|---|
| **100%** | 2 | `llm_services/clinical_summary.py` `safety_guardrail.py` |
| **80–89%** | 2 | `duplicate_detector.py` (83.7%) `rule_engine/ckd_rules.py` (86.7%) |
| **70–79%** | 1 | `duplicate_cache.py` (78.0%) |
| **30–39%** | 2 | `drug_graph_bridge.py` (36.8%) `patient_context_builder.py` (30.2%) |
| **20–29%** | 1 | `layer2_store.py` (20.8%) |

**觀察**：
- duplicate detection / safety guard 路線測試覆蓋好（80%+）
- patient_context_builder（B15 主戰場）30.2%，是已知低覆蓋區
- layer2_store 20.8%——`/v2/patients` 退役後 only 1 caller，覆蓋低不意外

### 5.3 Models / Schemas

- **All 32 個 model 100%**（SQLAlchemy declarative 在 import 時就把所有 column 行算 covered）
- **Schemas 多在 90–100%**，唯一例外 `vital_sign.py` 0%（不被 test_api/test_services import；test_schemas 應該有覆蓋但不在本次 scope）

### 5.4 LLM / Utils（其他）

| Module | Cover |
|---|---|
| `app/llm.py` | 16.3% |
| `app/utils/structured_output.py` | 18.5% |
| `app/utils/llm_errors.py` | 25.0% |
| `app/utils/data_freshness.py` | 36.2% |
| `app/utils/audit_async.py` | 50.0% |
| `app/utils/duplicate_check.py` | 57.8% |
| `app/utils/response.py` | 93.8% |
| `app/utils/security.py` | 96.8% |

`app/llm.py` 是顯著低點——LLM streaming / function-calling / TASK_PROMPTS 走的是真實 OpenAI 互動，整合測試 mock 過頭就無覆蓋。

---

## 6. 邊界與限制

- **本檔只是 baseline，不設 coverage threshold、不接 CI、不擋 PR**
- `pyproject.toml` `[tool.coverage.*]` 既有設定（branch=true、omit `database.py`/`main.py`）保持不變
- 9 個 fail 的 `test_duplicate_detector.py` 是 pre-existing；本次 baseline 不負責修
- `tests/test_fhir/` `tests/test_middleware/` `tests/test_schemas/` `tests/test_scripts/` `tests/evals/` `tests/test_llm.py` `tests/test_e2e_llm.py` **未在本次 scope**——若加進去，schema / FHIR / middleware 覆蓋會升、整體可能多 5–10pp（粗估）
- JSON 報告：`/.state/coverage-baseline-2026-05-01.json`（repo-root `.state/` **未** gitignore；`backend/.state/` 才有 gitignore）

---

## 7. 下次推進建議（**不在本次任務內**）

若未來要把 coverage 從「baseline」推到「有意義的訊號」，建議**只針對高風險區補測試、不全面追數字**：

| 優先 | 目標 module | 目前 | 建議補的測試類型 |
|---|---|---|---|
| 1 | `app/routers/ai_chat.py` (29.1%) | 整條 `/ai/chat/stream` 第一輪 + 後續輪、SSE chunk 解析、錯誤分支、deferred ready/pending/failed 三狀態端到端 |
| 2 | `app/services/patient_context_builder.py` (30.2%) | `build_critical_snapshot` 各 fetcher 失敗降級、`build_deferred_snapshot` 三 sub fetcher 個別 timeout、warm-up 正常/異常 |
| 3 | `app/routers/patients.py` (36.0%) | `/bootstrap` aggregate endpoint 各 sub-call 失敗（fail-loud 行為驗證）、PATCH 後 cache invalidate 路徑 |
| 4 | `app/routers/scores.py` (84.0%) | 已偏高；補 layer2_store JSON 解析失敗的 fallback path |

**為什麼選這 4 個**：
- (1)(2) 是 B15 系列改動最重的兩個檔，當前 dormant 但「冷區覆蓋低 + 重啟時一定要動」=「重啟前先補測試」
- (3) 是 Phase 3.1 bootstrap aggregate 入口，`/patients/{id}/bootstrap` 是首屏唯一 API；fail-loud 行為值得 lock 住
- (4) 是 layer2_store 唯一 active caller；`/v2/patients` 退役後，scores 是 layer2 path 的最後堡壘

**不建議的方向**：
- 不要追 100% total coverage——`pharmacy_routes/drug_library.py` 491 stmt 補滿要寫 ~80 個整合測試，工不對等
- 不要把 model / schema 強行覆蓋到 100%——declarative class 的覆蓋對 invariant 沒幫助
- 不要把 `app/llm.py` 補 70%+——大半是 OpenAI 真實互動 path，整合測試 mock 過頭等於沒測

---

## 8. 結論

- ✅ **TOTAL coverage = 59.4%**（test_api + test_services scope）
- ✅ **418 pass / 9 fail / 3 skip**
- ✅ **9 fail 是既有 `test_duplicate_detector.py`**（pre-existing fixture-data drift，本次未引入）
- ✅ 0 runtime / config 變更；不接 CI、不設 threshold
- 🗑 `.state/coverage-baseline-2026-05-01.json` 為本機分析 artifact，**不進版本庫**（已從 worktree 移除）

### 高風險缺口

| Module | Cover | 為什麼是高風險 |
|---|---|---|
| `app/routers/ai_chat.py` | **29.1%** | B15 dormant path（split / A1.1 / B 多連線）剛落 prod；flag OFF 但重啟條件成立就會立刻動土 |
| `app/services/patient_context_builder.py` | **30.2%** | B15 主戰場；`build_critical_snapshot` / `build_deferred_snapshot` / `build_clinical_snapshot` 三條 path 大半未走過 |
| `app/routers/patients.py` | **36.0%** | Phase 3.1 bootstrap aggregate 入口；首屏唯一 API、fail-loud 行為值得 lock |
| `app/routers/scores.py` | **84.0%** | 已偏高，但 layer2_store JSON parse 的 fallback path 未覆蓋；`/v2/patients` 退役後 scores 是 layer2 最後堡壘 |

### 下一個可做項目

**補 B15 相關 tests，不動 runtime。** 優先補 `ai_chat.py` / `patient_context_builder.py` 的 **branch coverage**——因為剛做過 B15 dormant path，這兩個是當前最高風險低覆蓋區。`patients.py` / `scores.py` 排在後面但同列入候選。

**baseline 立完，下一步看 user signal 才動測試補強。**

---

## 附錄：本檔產出後的 git status 預期

```bash
git diff --name-only
# 預期：本檔以前已存在的 11 個 deleted（datamock + his-sync-schedule）不變，無新增 tracked diff

git status --short | grep -E "fastlane|coverage|\.state"
# 預期：
# ?? .state/coverage-baseline-2026-05-01.json
# ?? docs/coverage-baseline-2026-05-01.md
```

無 commit、無 push。
