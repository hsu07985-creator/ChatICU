#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -z "${PYTHON_BIN:-}" ]]; then
  for candidate in ".venv312/bin/python" ".venv/bin/python" "../.venv312/bin/python" "../.venv/bin/python" "python3"; do
    if [[ "$candidate" == "python3" ]] || [[ -x "$candidate" ]]; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ -z "${SOURCE_DIR:-}" ]]; then
  if [[ -d "$ROOT_DIR/rag 文本" ]]; then
    SOURCE_DIR="$ROOT_DIR/rag 文本"
  elif [[ -d "$ROOT_DIR/../rag 文本" ]]; then
    SOURCE_DIR="$ROOT_DIR/../rag 文本"
  else
    SOURCE_DIR="$ROOT_DIR/rag 文本"
  fi
fi
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
RUN_EVAL="${RUN_EVAL:-1}"
FORCE_INGEST="${FORCE_INGEST:-0}"

if [[ "$PYTHON_BIN" != "python3" && ! -x "$PYTHON_BIN" ]]; then
  echo "Python executable not found: $PYTHON_BIN"
  echo "Set PYTHON_BIN or create a virtualenv in ./ or ../."
  exit 1
fi

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [[ "$FORCE_INGEST" == "1" ]]; then
  "$PYTHON_BIN" -m evidence_rag.auto_ingest --source-dir "$SOURCE_DIR" --force
else
  "$PYTHON_BIN" -m evidence_rag.auto_ingest --source-dir "$SOURCE_DIR"
fi

if [[ "$RUN_EVAL" == "1" ]]; then
  "$PYTHON_BIN" -m evidence_rag.evaluate
fi

exec "$PYTHON_BIN" -m uvicorn evidence_rag.api:app --host "$HOST" --port "$PORT"
