1) Summary
- 已將整合 Gate 固化到 CI：contract tests、backend integration、frontend typecheck/build、e2e smoke、靜態規則。
- 新增 PR 可阻擋的 static guard（except-pass / 危險 CORS / 可疑 secret pattern）。

2) Findings
CI 固化內容（`.github/workflows/ci.yml`）
- Contract tests：`Run contract tests`（`ci.yml:48`）。
- Backend integration tests：`Run backend integration tests`（`ci.yml:56`）。
- Frontend：既有 typecheck + build（`ci.yml:167-175`）。
- E2E smoke：既有 `e2e-critical-journey` job（`ci.yml:291`）。
- Static rules：新增 `static-integration-guards`（`ci.yml:186-214`）。
  - 禁 `except ...: pass`（`ci.yml:192-199`）
  - 禁危險 CORS `0.0.0.0`（`ci.yml:200-206`）
  - 禁 tracked files 可疑 secret pattern（`ci.yml:208-214`）

3) Patch
- 更新 `.github/workflows/ci.yml`

4) Verification
- `npm run build`
  - 證據：PASS（Vite build 完成）。
- `npm run test:e2e -- --list`
  - 證據：列出 5 條 smoke/critical 測試。
- 本地模擬 static rules：
  - except-pass：`PASS_except_pass`
  - CORS 0.0.0.0：`PASS_cors_origin`
  - secret pattern：`PASS_secret_pattern`

5) Gate
- PROMPT-08 COMPLETE
