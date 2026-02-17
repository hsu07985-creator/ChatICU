#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FUNC_DIR="${REPO_ROOT}/func"

if [[ ! -d "${FUNC_DIR}" ]]; then
  echo "[AO-07] func directory not found: ${FUNC_DIR}" >&2
  exit 1
fi

if [[ -n "${FUNC_PYTHON_BIN:-}" ]]; then
  PYTHON_BIN="${FUNC_PYTHON_BIN}"
elif [[ -x "${FUNC_DIR}/.venv312/bin/python" ]]; then
  PYTHON_BIN="${FUNC_DIR}/.venv312/bin/python"
elif [[ -x "${FUNC_DIR}/.venv/bin/python" ]]; then
  PYTHON_BIN="${FUNC_DIR}/.venv/bin/python"
elif [[ -x "${REPO_ROOT}/backend/.venv312/bin/python" ]]; then
  PYTHON_BIN="${REPO_ROOT}/backend/.venv312/bin/python"
elif [[ -x "${REPO_ROOT}/backend/.venv/bin/python" ]]; then
  PYTHON_BIN="${REPO_ROOT}/backend/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
else
  echo "[AO-07] python3 not found and FUNC_PYTHON_BIN is not set" >&2
  exit 1
fi

MANIFEST_PATH="${GOLDEN_MANIFEST_PATH:-${FUNC_DIR}/clinical_rules/release_manifest.json}"
DOSE_CASES_PATH="${GOLDEN_DOSE_CASES_PATH:-${FUNC_DIR}/clinical_rules/golden/dose_cases.v1.mock.json}"
INTERACTION_CASES_PATH="${GOLDEN_INTERACTION_CASES_PATH:-${FUNC_DIR}/clinical_rules/golden/interaction_cases.v1.mock.json}"
OUTPUT_DIR="${GOLDEN_OUTPUT_DIR:-${FUNC_DIR}/evidence_rag_data/logs}"

MIN_PASS_RATE="${GOLDEN_MIN_PASS_RATE:-1.0}"
MIN_DOSE_PASS_RATE="${GOLDEN_MIN_DOSE_PASS_RATE:-${MIN_PASS_RATE}}"
MIN_INTERACTION_PASS_RATE="${GOLDEN_MIN_INTERACTION_PASS_RATE:-${MIN_PASS_RATE}}"

VERBOSE_ARGS=()
if [[ "${GOLDEN_VERBOSE:-0}" == "1" ]]; then
  VERBOSE_ARGS+=("--verbose")
fi

echo "[AO-07] Running clinical golden regression"
echo "[AO-07] Python: ${PYTHON_BIN}"
echo "[AO-07] Thresholds: overall=${MIN_PASS_RATE} dose=${MIN_DOSE_PASS_RATE} interaction=${MIN_INTERACTION_PASS_RATE}"
echo "[AO-07] Output: ${OUTPUT_DIR}"

pushd "${FUNC_DIR}" >/dev/null
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

CMD=(
  "${PYTHON_BIN}" scripts/run_clinical_golden.py
  --manifest "${MANIFEST_PATH}"
  --dose-cases "${DOSE_CASES_PATH}"
  --interaction-cases "${INTERACTION_CASES_PATH}"
  --output-dir "${OUTPUT_DIR}"
  --min-pass-rate "${MIN_PASS_RATE}"
  --min-dose-pass-rate "${MIN_DOSE_PASS_RATE}"
  --min-interaction-pass-rate "${MIN_INTERACTION_PASS_RATE}"
)
if [[ "${#VERBOSE_ARGS[@]}" -gt 0 ]]; then
  CMD+=("${VERBOSE_ARGS[@]}")
fi
"${CMD[@]}"
STATUS_CODE=$?
popd >/dev/null

REPORT_PATH="${OUTPUT_DIR}/clinical_golden_report.json"
if [[ -f "${REPORT_PATH}" ]]; then
  echo "[AO-07] Report generated: ${REPORT_PATH}"
fi

exit "${STATUS_CODE}"
