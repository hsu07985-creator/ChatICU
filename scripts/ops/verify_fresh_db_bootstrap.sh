#!/usr/bin/env bash
# Fresh-DB bootstrap acceptance check.
#
# Proves that a COMPLETELY EMPTY database can be brought up with the exact
# steps docker-compose / CI / new dev machines use:
#
#   alembic upgrade head   (must apply every revision — no skips, no stubs)
#   seeds.seed_data        (users, patients, meds, ..., system templates)
#   seeds.seed_culture_results
#   uvicorn boot + authenticated API smoke
#
# Requires Docker (spins a disposable pgvector/pgvector:pg16 container and
# removes it afterwards). Exit 0 = bootstrap path healthy.
#
# Usage:  bash scripts/ops/verify_fresh_db_bootstrap.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
PYTHON_BIN="${BACKEND_DIR}/.venv312/bin/python"

CONTAINER="chaticu-bootstrap-check"
PORT="${BOOTSTRAP_DB_PORT:-55499}"
API_PORT="${BOOTSTRAP_API_PORT:-18299}"
DB_URL="postgresql+asyncpg://chaticu:chaticu_password@127.0.0.1:${PORT}/chaticu_bootstrap"  # pragma: allowlist secret — disposable local container

log()  { echo "[BOOTSTRAP-CHECK] $*"; }
fail() { echo "[BOOTSTRAP-CHECK] FAIL: $*"; exit 1; }

[ -x "${PYTHON_BIN}" ] || fail "backend venv not found at ${PYTHON_BIN}"
command -v docker >/dev/null || fail "docker is required"

BACKEND_PID=""
cleanup() {
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# ── 1. Disposable pgvector database ─────────────────────────────────────
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
log "starting disposable pgvector container on 127.0.0.1:${PORT}"
docker run -d --name "${CONTAINER}" \
  -e POSTGRES_USER=chaticu -e POSTGRES_PASSWORD=chaticu_password \
  -e POSTGRES_DB=chaticu_bootstrap \
  -p "127.0.0.1:${PORT}:5432" pgvector/pgvector:pg16 >/dev/null

for i in $(seq 1 30); do
  docker exec "${CONTAINER}" pg_isready -U chaticu -d chaticu_bootstrap >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${CONTAINER}" pg_isready -U chaticu -d chaticu_bootstrap >/dev/null 2>&1 \
  || fail "postgres did not become ready"

# ── 2. Migrations — every revision must apply, no tolerance loop ────────
cd "${BACKEND_DIR}"
export DATABASE_URL="${DB_URL}"
export REDIS_URL="redis://127.0.0.1:1/0"   # deliberately dead; app must not need it to boot
export JWT_SECRET="bootstrap_check_only_jwt_secret_32chars_x"  # pragma: allowlist secret
export DEBUG=true
export DATA_SOURCE_MODE=json
export DATAMOCK_DIR="${ROOT_DIR}/datamock"
export SEED_PASSWORD_STRATEGY=username
export SEED_DEFAULT_PASSWORD=unused_when_username_strategy
export RATE_LIMIT_LOGIN="100/minute"
export RATE_LIMIT_DEFAULT="500/minute"

log "alembic upgrade head (fresh database)"
"${PYTHON_BIN}" -m alembic upgrade head || fail "alembic upgrade head errored on a fresh DB"

CURRENT=$("${PYTHON_BIN}" -m alembic current 2>/dev/null | tail -1)
log "alembic current: ${CURRENT}"
echo "${CURRENT}" | grep -q "head" || fail "alembic did not reach head"

# ── 3. Seeds ─────────────────────────────────────────────────────────────
log "seeds.seed_data"
"${PYTHON_BIN}" -m seeds.seed_data >/dev/null || fail "seeds.seed_data errored"
log "seeds.seed_culture_results"
"${PYTHON_BIN}" -m seeds.seed_culture_results >/dev/null || fail "seed_culture_results errored"

# ── 4. Sanity: key tables non-empty ─────────────────────────────────────
"${PYTHON_BIN}" - <<'PY' || fail "post-seed sanity check failed"
import asyncio, os, sys
import asyncpg

CHECKS = {
    "users": 1,
    "patients": 1,
    "medications": 1,
    "record_templates": 8,     # migrations deferred → seed pipeline provides
    "culture_results": 1,
    "diagnostic_reports": 0,   # demo rows skipped on fresh DB; table must exist
    "drug_library_audit_log": 0,
}

async def main():
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    ok = True
    try:
        for table, minimum in CHECKS.items():
            n = await conn.fetchval(f'SELECT COUNT(*) FROM "{table}"')
            status = "ok" if n >= minimum else "TOO FEW"
            if n < minimum:
                ok = False
            print(f"[BOOTSTRAP-CHECK]   {table}: {n} rows (>= {minimum}) {status}")
    finally:
        await conn.close()
    sys.exit(0 if ok else 1)

asyncio.run(main())
PY

# ── 5. Boot the API + authenticated smoke ────────────────────────────────
log "booting uvicorn on 127.0.0.1:${API_PORT}"
"${PYTHON_BIN}" -m uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}" \
  >/tmp/chaticu-bootstrap-check-api.log 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 45); do
  curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null \
  || { tail -30 /tmp/chaticu-bootstrap-check-api.log; fail "backend /health never came up"; }
log "/health ok"

COOKIES=$(mktemp)
# Seeded demo account (SEED_PASSWORD_STRATEGY=username).
LOGIN_BODY='{"username":"pharmacist","password":"pharmacist"}'  # pragma: allowlist secret
curl -fsS -c "${COOKIES}" -X POST "http://127.0.0.1:${API_PORT}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "${LOGIN_BODY}" >/dev/null \
  || fail "seeded pharmacist login failed"
log "login ok (seeded pharmacist account)"

curl -fsS -b "${COOKIES}" "http://127.0.0.1:${API_PORT}/pharmacy/drug-library/stats" >/dev/null \
  || fail "drug-library stats endpoint failed (072/073 schema)"
log "drug-library stats ok (editor schema present)"

curl -fsS -b "${COOKIES}" "http://127.0.0.1:${API_PORT}/record-templates?recordType=progress-note" \
  | grep -q "SOAP" || fail "system record templates missing"
log "system record templates ok"
rm -f "${COOKIES}"

log "PASS — fresh DB bootstrap is healthy (migrations + seeds + API smoke)"
