# P08 CI Gate 固化結果

## 1) Summary
已完成 P8：將 CI Gate 固化為 PR 必跑流程，補齊 datamock JSON 驗證與 API payload non-null assertion 防線，並保留 contract/integration/frontend/e2e smoke 關卡。

## 2) Findings
- High: CI 缺少 datamock JSON 結構驗證，若資料源格式漂移，會在執行期才失敗。
  - Evidence: `.github/workflows/ci.yml:48-55` 新增 `Validate datamock schema (JSON mode)`。
- Medium: 靜態規則尚未明確阻擋高風險 API payload non-null assertion（`response.data.data!`）。
  - Evidence: `.github/workflows/ci.yml:225-231` 新增阻擋規則。
- Existing Gate retained:
  - Contract: `.github/workflows/ci.yml:56-63`
  - Backend integration: `.github/workflows/ci.yml:64-70`
  - Frontend typecheck/build: `.github/workflows/ci.yml:183-192`
  - E2E smoke (`@critical`): `.github/workflows/ci.yml:339-344`
  - Static guards except-pass/CORS/secret: `.github/workflows/ci.yml:200-223`

## 3) Patch
- Modified: `.github/workflows/ci.yml`
  - 新增 `Validate datamock schema (JSON mode)` step
  - 新增 `Block risky API payload non-null assertions` step
- Modified: `docs/json-offline-remediation-task-tracker.md`
  - P8 狀態改為完成，並加入驗收紀錄

## 4) Verification
- `cd backend && ./.venv312/bin/python -m seeds.validate_datamock` → PASS
  - Output: `Datamock validation passed: {'users': 4, 'patients': 4, 'medications': 11, 'labData': 4, 'patientMessages': 10, 'teamChatMessages': 5, 'drugInteractions': 4, 'ivCompatibility': 4}`
- `cd backend && ./.venv312/bin/pytest tests/test_api/test_contract.py -q` → PASS (`21 passed`)
- `cd backend && ./.venv312/bin/pytest tests/test_api -q` → PASS (`79 passed`)
- `npm run typecheck` → PASS
- `npm run build` → PASS
- `npm run test:e2e -- --list` → PASS（列出 6 條 E2E，含 `@critical`）
- Static guard simulation（workflow 同版命令）
  - except-pass guard → PASS
  - CORS 0.0.0.0 guard → PASS
  - secret pattern guard → PASS
  - non-null assertion guard (`response.data.data!`) → PASS

## 5) Gate
PROMPT-08 COMPLETE
