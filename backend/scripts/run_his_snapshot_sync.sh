#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNC_ENV_PATH="${SYNC_ENV_PATH:-$BACKEND_DIR/.env.his-sync}"

cd "$BACKEND_DIR"

if [[ -f "$SYNC_ENV_PATH" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SYNC_ENV_PATH"
  set +a
fi

if [[ -x "/opt/homebrew/bin/python3" ]]; then
  PYTHON_BIN="/opt/homebrew/bin/python3"
elif [[ -x "/usr/local/bin/python3" ]]; then
  PYTHON_BIN="/usr/local/bin/python3"
else
  PYTHON_BIN="$(command -v python3)"
fi

exec "$PYTHON_BIN" -u scripts/sync_his_snapshots.py "$@"
