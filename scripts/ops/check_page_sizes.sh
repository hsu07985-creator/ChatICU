#!/usr/bin/env bash
# D1 (architecture-audit-2026-07-19): page-size ratchet gate.
#
# repo-structure.md 規定 src/pages 超過 ~900 行應拆成 page package。
# 既有 6 個超標頁面「凍結在現值」——只能變小,不能再長;
# 其他頁面一律 900 行上限。拆完一個頁面後,把它從 RATCHET 移除。
set -euo pipefail
cd "$(dirname "$0")/../.."

DEFAULT_MAX=900

# path=frozen-ceiling(現值 + 極小 buffer)
RATCHET=(
  "src/pages/patient-detail.tsx=1600"
  "src/pages/pharmacy/workstation.tsx=1100"
  "src/pages/ai-chat.tsx=950"
  "src/pages/patients.tsx=940"
  "src/pages/pharmacy/interactions.tsx=925"
)

limit_for() {
  local f="$1"
  for entry in "${RATCHET[@]}"; do
    if [[ "${entry%%=*}" == "$f" ]]; then
      echo "${entry##*=}"
      return
    fi
  done
  echo "$DEFAULT_MAX"
}

fail=0
while IFS= read -r f; do
  lines=$(wc -l < "$f" | tr -d ' ')
  max=$(limit_for "$f")
  if (( lines > max )); then
    echo "FAIL: $f is $lines lines (max $max) — split into a page package (src/pages/<page>/)"
    fail=1
  fi
done < <(find src/pages -name '*.tsx')

if (( fail )); then
  echo "見 docs/repo-structure.md「前端頁面」條目;ratchet 表在本腳本頂部。"
  exit 1
fi
echo "OK: all pages within size limits"
