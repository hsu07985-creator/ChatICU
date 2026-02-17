#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

REPORT_DIR="${ROOT_DIR}/reports/operations"
TS="$(date -u +"%Y%m%dT%H%M%SZ")"
LOG_DIR="${REPORT_DIR}/key-rotation-acceptance-${TS}.logs"
REPORT_PATH="${REPORT_DIR}/key-rotation-acceptance-${TS}.md"

mkdir -p "${LOG_DIR}"

sanitize_tail() {
  sed -E \
    -e 's/sk-[A-Za-z0-9_-]{10,}/sk-***REDACTED***/g' \
    -e 's/(AKIA[0-9A-Z]{16})/***REDACTED***/g' \
    -e 's/(ASIA[0-9A-Z]{16})/***REDACTED***/g' \
    -e 's/(xox[baprs]-[0-9A-Za-z-]{10,})/***REDACTED***/g' \
    -e 's/(AIza[0-9A-Za-z_-]{20,})/***REDACTED***/g'
}

CHECK_ROWS=""
ANY_FAIL=0

run_check() {
  local id="$1"
  local description="$2"
  local command="$3"

  local log_file="${LOG_DIR}/${id}.log"
  local status="PASS"

  set +e
  bash -lc "${command}" >"${log_file}" 2>&1
  local code=$?
  set -e

  if [[ ${code} -ne 0 ]]; then
    status="FAIL"
    ANY_FAIL=1
  fi

  local summary
  summary="$(tail -n 8 "${log_file}" | sanitize_tail | tr '\n' ' ' | sed 's/|/\\|/g' | sed 's/  */ /g' | sed 's/^ *//; s/ *$//')"
  if [[ -z "${summary}" ]]; then
    summary="(no output)"
  fi

  CHECK_ROWS+=$'\n'"| ${description} | \`${command}\` | ${status} | ${summary} | \`${log_file}\` |"
}

echo "[INTG][OPS] Generating key-rotation acceptance report at ${REPORT_PATH}"

run_check \
  "secret_scan" \
  "Tracked-files secret pattern scan" \
  "cd '${ROOT_DIR}' && if rg -n -I --no-messages '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z\\-_]{35}|sk-[A-Za-z0-9]{20,})' \$(git ls-files); then echo '[INTG][OPS] secret pattern detected'; exit 1; else echo '[INTG][OPS] no secret pattern in tracked files'; fi"

run_check \
  "datamock_validate" \
  "Datamock schema validation" \
  "cd '${ROOT_DIR}/backend' && ./.venv312/bin/python -m seeds.validate_datamock"

run_check \
  "contract_tests" \
  "Backend contract tests" \
  "cd '${ROOT_DIR}/backend' && ./.venv312/bin/pytest tests/test_api/test_contract.py -q"

run_check \
  "backend_integration" \
  "Backend integration tests" \
  "cd '${ROOT_DIR}/backend' && ./.venv312/bin/pytest tests/test_api -q"

run_check \
  "frontend_typecheck" \
  "Frontend typecheck" \
  "cd '${ROOT_DIR}' && npm run typecheck"

run_check \
  "e2e_critical" \
  "E2E critical smoke" \
  "cd '${ROOT_DIR}' && npm run test:e2e -- --project=chromium --grep '@critical'"

AUTOMATION_STATUS="PASS"
if [[ ${ANY_FAIL} -ne 0 ]]; then
  AUTOMATION_STATUS="FAIL"
fi

cat >"${REPORT_PATH}" <<EOF
# Key Rotation Acceptance Report

- Generated at (UTC): ${TS}
- Automation status: ${AUTOMATION_STATUS}
- Workspace: \`${ROOT_DIR}\`

## 1) Manual Rotation Checklist (Owner Sign-off Required)

- [ ] OpenAI provider key rotated (new key ID masked): \`________\`
- [ ] Previous OpenAI key revoked (timestamp UTC): \`________\`
- [ ] \`JWT_SECRET\` rotated in runtime env (not committed): \`YES/NO\`
- [ ] DB/Redis credentials rotated if applicable: \`YES/NO/N/A\`
- [ ] Change ticket / incident ID linked: \`________\`
- [ ] Sign-off owner: \`________\`
- [ ] Sign-off date (UTC): \`________\`

## 2) Automated Verification

| Check | Command | Result | Key Output (tail) | Log |
|---|---|---|---|---|${CHECK_ROWS}

## 3) Gate

- If all manual checkboxes above are checked and automation status is PASS: **READY_TO_CLOSE**
- Otherwise: **NOT_READY**
EOF

echo "[INTG][OPS] Report generated: ${REPORT_PATH}"
echo "[INTG][OPS] Logs directory: ${LOG_DIR}"

