#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
PYTHON_BIN="${BACKEND_DIR}/.venv312/bin/python"

if [[ "${CI:-}" == "true" || "${CI:-}" == "1" || "${E2E_MANAGED_SERVERS:-1}" == "0" ]]; then
  cd "${ROOT_DIR}"
  exec npx playwright test "$@"
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "[INTG][E2E] npx not found. Install Node.js/npm first."
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "[INTG][E2E] Python runtime not found at ${PYTHON_BIN}"
  echo "[INTG][E2E] Expected backend virtualenv: backend/.venv312"
  exit 1
fi

find_free_port() {
  local port="$1"
  while lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "${port}"
}

BACKEND_PORT="$(find_free_port "${E2E_BACKEND_PORT:-18100}")"
FRONTEND_PORT="$(find_free_port "${E2E_FRONTEND_PORT:-14173}")"

BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

E2E_PG_ADMIN_URL="${E2E_PG_ADMIN_URL:-postgresql:///postgres}"
E2E_DB_NAME="${E2E_DB_NAME:-chaticu_e2e_managed}"
E2E_DB_OWNER="${E2E_DB_OWNER:-chaticu}"
E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql+asyncpg://chaticu:chaticu_password@127.0.0.1:5432/${E2E_DB_NAME}}"

SEED_LOG="${E2E_SEED_LOG:-/tmp/chaticu-e2e-seed.log}"
BACKEND_LOG="${E2E_BACKEND_LOG:-/tmp/chaticu-e2e-backend.log}"
FRONTEND_LOG="${E2E_FRONTEND_LOG:-/tmp/chaticu-e2e-frontend.log}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
    wait "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local attempts="${4:-90}"
  local interval_seconds="${5:-1}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "[INTG][E2E] ${label} ready: ${url}"
      return 0
    fi
    sleep "${interval_seconds}"
  done

  echo "[INTG][E2E] ${label} failed to start in time: ${url}"
  if [[ -f "${log_file}" ]]; then
    echo "[INTG][E2E] --- ${label} log tail (${log_file}) ---"
    tail -n 200 "${log_file}" || true
  fi
  return 1
}

trap cleanup EXIT INT TERM

echo "[INTG][E2E] managed run enabled (isolated local stack)"
echo "[INTG][E2E] backend=${BACKEND_URL} frontend=${FRONTEND_URL}"
echo "[INTG][E2E] database=${E2E_DATABASE_URL}"

export DEBUG=true
export DATA_SOURCE_MODE=json
export DATAMOCK_DIR="${ROOT_DIR}/datamock"
export DATABASE_URL="${E2E_DATABASE_URL}"
export E2E_PG_ADMIN_URL
export E2E_DB_NAME
export E2E_DB_OWNER
export REDIS_URL="redis://127.0.0.1:6390/0"
export JWT_SECRET="${JWT_SECRET:-e2e_local_only_jwt_secret_minimum_32_chars_ok}"
export RATE_LIMIT_LOGIN="${RATE_LIMIT_LOGIN:-100/minute}"
export RATE_LIMIT_DEFAULT="${RATE_LIMIT_DEFAULT:-500/minute}"
export FUNC_API_URL="${FUNC_API_URL:-http://127.0.0.1:18001}"
export FUNC_API_TIMEOUT="${FUNC_API_TIMEOUT:-5.0}"
export FUNC_API_RETRY_COUNT="${FUNC_API_RETRY_COUNT:-1}"
export FUNC_API_RETRY_BACKOFF_SECONDS="${FUNC_API_RETRY_BACKOFF_SECONDS:-0.2}"
# Keep managed E2E startup deterministic; skip heavy auto-index unless explicitly set.
export RAG_DOCS_PATH="${RAG_DOCS_PATH:-}"
export SEED_PASSWORD_STRATEGY="${SEED_PASSWORD_STRATEGY:-username}"
export SEED_DEFAULT_PASSWORD="${SEED_DEFAULT_PASSWORD:-unused_when_username_strategy}"
export CORS_ORIGINS="[\"${FRONTEND_URL}\",\"http://127.0.0.1:4173\",\"http://localhost:4173\",\"http://127.0.0.1:3000\",\"http://localhost:3000\"]"

cd "${BACKEND_DIR}"
"${PYTHON_BIN}" - <<'PY'
import asyncio
import os
import re
import asyncpg

admin_dsn = os.environ["E2E_PG_ADMIN_URL"]
db_name = os.environ["E2E_DB_NAME"]
db_owner = os.environ["E2E_DB_OWNER"]

if not re.fullmatch(r"[a-zA-Z0-9_]+", db_name):
    raise SystemExit(f"[INTG][E2E] Invalid E2E_DB_NAME: {db_name!r}")
if not re.fullmatch(r"[a-zA-Z0-9_]+", db_owner):
    raise SystemExit(f"[INTG][E2E] Invalid E2E_DB_OWNER: {db_owner!r}")

async def main() -> None:
    conn = await asyncpg.connect(admin_dsn)
    try:
        await conn.execute(
            "SELECT pg_terminate_backend(pid) "
            "FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            db_name,
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        await conn.execute(f'CREATE DATABASE "{db_name}" OWNER "{db_owner}"')
    finally:
        await conn.close()

asyncio.run(main())
print(f"[INTG][E2E] Recreated database: {db_name} owner={db_owner}")
PY

"${PYTHON_BIN}" -m alembic upgrade head >"${SEED_LOG}" 2>&1
"${PYTHON_BIN}" -m seeds.seed_data >>"${SEED_LOG}" 2>&1

"${PYTHON_BIN}" -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID="$!"

cd "${ROOT_DIR}"
VITE_API_URL="${BACKEND_URL}" npm run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort --open false >"${FRONTEND_LOG}" 2>&1 &
FRONTEND_PID="$!"

wait_for_url "${BACKEND_URL}/health" "backend" "${BACKEND_LOG}"
wait_for_url "${FRONTEND_URL}" "frontend" "${FRONTEND_LOG}"

export E2E_BASE_URL="${FRONTEND_URL}"
export E2E_USERNAME="${E2E_USERNAME:-nurse}"
export E2E_PASSWORD="${E2E_PASSWORD:-nurse}"
export E2E_EXT_USERNAME="${E2E_EXT_USERNAME:-doctor}"
export E2E_EXT_PASSWORD="${E2E_EXT_PASSWORD:-doctor}"
export E2E_PHARMACY_USERNAME="${E2E_PHARMACY_USERNAME:-pharmacist}"
export E2E_PHARMACY_PASSWORD="${E2E_PHARMACY_PASSWORD:-pharmacist}"

echo "[INTG][E2E] running playwright test $*"
npx playwright test "$@"
