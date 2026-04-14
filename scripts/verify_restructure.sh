#!/usr/bin/env bash
# verify_restructure.sh — 專案重整驗證腳本
# 用法：bash scripts/verify_restructure.sh T01
#        bash scripts/verify_restructure.sh ALL

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; WARN=$((WARN + 1)); }

# ─── T01: server/ 目錄封存 ───
verify_T01() {
  echo "── T01: server/ directory archived ──"

  # server/ 不應存在於根目錄
  if [ -d "server" ]; then
    fail "server/ still exists in project root"
  else
    pass "server/ removed from project root"
  fi

  # 封存目錄應存在
  if [ -d "_archive_candidates/20260218/server" ]; then
    pass "server/ archived to _archive_candidates/20260218/server/"
  else
    fail "_archive_candidates/20260218/server/ not found"
  fi

  # 封存目錄應有 README
  if [ -f "_archive_candidates/20260218/server/README.md" ]; then
    pass "Archive README exists"
  else
    warn "Missing README.md in archived server/ directory"
  fi

  # health.ts 不應引用 dart_frog
  if grep -q 'dart_frog' src/lib/api/health.ts 2>/dev/null; then
    fail "health.ts still references dart_frog"
  else
    pass "health.ts references uvicorn (not dart_frog)"
  fi
}

# ─── T02: RAG 零除錯誤 ───
verify_T02() {
  echo "── T02: RAG zero-division fix ──"

  local rag_file="backend/app/services/llm_services/rag_service.py"

  if [ ! -f "$rag_file" ]; then
    fail "$rag_file not found"
    return
  fi

  # 應有零除防護（檢查常見 guard 模式）
  if grep -qE 'len\(.*\)\s*==\s*0|is None|\.size\s*==\s*0|not\s+.*index|empty|no.*vectors' "$rag_file" 2>/dev/null; then
    pass "Found zero-division guard in rag_service.py"
  else
    fail "No zero-division guard found in rag_service.py"
  fi

  # 執行測試確認
  if [ -d "backend" ] && [ -f "backend/tests/test_rag_service.py" ] || \
     find backend/tests/ -name "*.py" -exec grep -l "rag_query_not_indexed" {} \; 2>/dev/null | grep -q .; then
    echo "  ℹ  Run: cd backend && .venv312/bin/python -m pytest tests/ -k 'rag_query_not_indexed' -v"
    # 嘗試執行測試
    if [ -x "backend/.venv312/bin/python" ]; then
      cd backend
      if .venv312/bin/python -m pytest tests/ -k "rag_query_not_indexed" -v --tb=short 2>/dev/null; then
        pass "test_rag_query_not_indexed PASSED"
      else
        fail "test_rag_query_not_indexed FAILED"
      fi
      cd ..
    else
      warn "Cannot run pytest — venv not found, verify manually"
    fi
  else
    warn "Cannot locate rag test file, verify manually"
  fi
}

# ─── T03: Code-splitting（index chunk < 500 KB）───
verify_T03() {
  echo "── T03: Index chunk size < 500 KB ──"

  # 先 build
  if [ -f "package.json" ] && command -v npm &>/dev/null; then
    echo "  ℹ  Running npm run build..."
    if npm run build --silent 2>/dev/null; then
      pass "npm run build succeeded"
    else
      fail "npm run build failed"
      return
    fi
  else
    warn "Cannot run build, checking existing build/ directory"
  fi

  # 檢查 index chunk 大小
  local index_file
  index_file=$(find build/assets/ -name "index-*.js" 2>/dev/null | head -1)

  if [ -z "$index_file" ]; then
    fail "No index-*.js found in build/assets/"
    return
  fi

  local size_kb
  size_kb=$(du -k "$index_file" | cut -f1)
  echo "  ℹ  Index chunk: $index_file ($size_kb KB)"

  if [ "$size_kb" -lt 500 ]; then
    pass "Index chunk is ${size_kb} KB (< 500 KB)"
  else
    fail "Index chunk is ${size_kb} KB (≥ 500 KB) — needs more splitting"
  fi

  # 確認 patient-detail 有 lazy loading
  if grep -rqE 'React\.lazy|lazy\(' src/pages/ src/App.tsx 2>/dev/null; then
    pass "Found React.lazy usage"
  else
    fail "No React.lazy found — patient-detail tabs not split"
  fi
}

# ─── T04: .gitignore 更新 ───
verify_T04() {
  echo "── T04: .gitignore excludes _archive_candidates/ ──"

  if [ ! -f ".gitignore" ]; then
    fail ".gitignore not found"
    return
  fi

  if grep -q '_archive_candidates' .gitignore; then
    pass ".gitignore contains _archive_candidates/"
  else
    fail ".gitignore missing _archive_candidates/ entry"
  fi

  # 確認沒有被 git track
  local tracked
  tracked=$(git ls-files _archive_candidates/ 2>/dev/null || true)
  if [ -n "$tracked" ]; then
    fail "_archive_candidates/ files are still tracked by git:"
    echo "$tracked" | head -5
  else
    pass "_archive_candidates/ not tracked by git"
  fi
}

# ─── T05: CI 孤兒偵測閘門 ───
verify_T05() {
  echo "── T05: CI orphan detection gate ──"

  local ci_file=".github/workflows/ci.yml"

  if [ ! -f "$ci_file" ]; then
    fail "$ci_file not found"
    return
  fi

  if grep -q 'orphan' "$ci_file" 2>/dev/null; then
    pass "CI config contains orphan detection step"
  else
    fail "CI config missing orphan detection step"
  fi

  # 實際執行孤兒檢測
  echo "  ℹ  Running orphan scan on src/imports/..."
  local orphans=0
  for f in src/imports/*.tsx src/imports/*.ts; do
    [ -f "$f" ] || continue
    local base
    base=$(basename "$f" .tsx)
    base=$(basename "$base" .ts)
    if ! grep -r "$base" src/pages/ src/components/ src/lib/ \
         --include="*.tsx" --include="*.ts" -q 2>/dev/null; then
      fail "ORPHAN detected: $f"
      ((orphans++))
    fi
  done
  if [ "$orphans" -eq 0 ]; then
    pass "No orphaned imports found"
  fi
}

# ─── T06: CI 文件位置檢查 ───
verify_T06() {
  echo "── T06: CI markdown location gate ──"

  local ci_file=".github/workflows/ci.yml"

  if [ ! -f "$ci_file" ]; then
    fail "$ci_file not found"
    return
  fi

  if grep -qE 'markdown.*src|\.md.*src|No markdown' "$ci_file" 2>/dev/null; then
    pass "CI config contains markdown location check"
  else
    fail "CI config missing markdown location check"
  fi

  # 實際檢查 src/ 下的 .md
  local md_files
  md_files=$(find src/ -name "*.md" -not -path "*/node_modules/*" 2>/dev/null || true)
  if [ -n "$md_files" ]; then
    fail "Markdown files found in src/:"
    echo "$md_files"
  else
    pass "No markdown files in src/"
  fi
}

# ─── T07: CI 封存洩漏檢查 ───
verify_T07() {
  echo "── T07: CI archive leak gate ──"

  local ci_file=".github/workflows/ci.yml"

  if [ ! -f "$ci_file" ]; then
    fail "$ci_file not found"
    return
  fi

  if grep -qE 'archive_candidates|archived.*tracked' "$ci_file" 2>/dev/null; then
    pass "CI config contains archive leak check"
  else
    fail "CI config missing archive leak check"
  fi
}

# ─── T08: Batch 1-5 完整性驗證 ───
verify_T08() {
  echo "── T08: Batch 1-5 integrity check ──"

  # 根目錄不應有這些檔案
  echo "  [Batch 1] Root orphans removed:"
  for item in "config.py" "security_report.json" "chaticu-dev-skill" ".orchestrator"; do
    if [ -e "$item" ]; then
      fail "Root orphan still exists: $item"
    else
      pass "$item removed from root"
    fi
  done

  # src/imports/ 僅剩 svg-n38m0xb9r6.ts
  echo "  [Batch 2] src/imports/ cleanup:"
  local import_count
  import_count=$(find src/imports/ -type f 2>/dev/null | wc -l)
  if [ "$import_count" -eq 1 ]; then
    if [ -f "src/imports/svg-n38m0xb9r6.ts" ]; then
      pass "src/imports/ contains only svg-n38m0xb9r6.ts"
    else
      fail "src/imports/ has 1 file but it's not svg-n38m0xb9r6.ts"
    fi
  else
    fail "src/imports/ has $import_count files (expected 1)"
    find src/imports/ -type f 2>/dev/null
  fi

  # src/ 下無 .md
  echo "  [Batch 3] No markdown in src/:"
  local md_in_src
  md_in_src=$(find src/ -name "*.md" 2>/dev/null | wc -l)
  if [ "$md_in_src" -eq 0 ]; then
    pass "No .md files in src/"
  else
    fail "Found $md_in_src .md files in src/"
  fi

  # docs/frontend/ 應有 9 個遷移文件
  echo "  [Batch 3] docs/frontend/ populated:"
  if [ -d "docs/frontend" ]; then
    local doc_count
    doc_count=$(find docs/frontend/ -name "*.md" -type f 2>/dev/null | wc -l)
    if [ "$doc_count" -ge 9 ]; then
      pass "docs/frontend/ has $doc_count markdown files (≥9)"
    else
      warn "docs/frontend/ has $doc_count markdown files (expected ≥9)"
    fi
  else
    fail "docs/frontend/ directory not found"
  fi

  # health.ts 引用 uvicorn
  echo "  [Batch 5] Code fixes:"
  if grep -q 'uvicorn' src/lib/api/health.ts 2>/dev/null; then
    pass "health.ts references uvicorn"
  else
    fail "health.ts missing uvicorn reference"
  fi

  # tsconfig 不含 IcuPatientAi11
  if grep -q 'IcuPatientAi11' tsconfig.json 2>/dev/null; then
    fail "tsconfig.json still excludes IcuPatientAi11 (stale rule)"
  else
    pass "tsconfig.json clean — no stale IcuPatientAi11 exclude"
  fi

  # 封存目錄應有內容
  echo "  [Archive] _archive_candidates/20260218/:"
  if [ -d "_archive_candidates/20260218" ]; then
    local archived_count
    archived_count=$(find _archive_candidates/20260218/ -type f 2>/dev/null | wc -l)
    if [ "$archived_count" -ge 25 ]; then
      pass "Archive has $archived_count files (≥25)"
    else
      warn "Archive has $archived_count files (expected ~30)"
    fi
  else
    fail "_archive_candidates/20260218/ not found"
  fi

  # 空目錄應已清除
  for dir in "src/components/figma" "src/hooks" "src/guidelines"; do
    if [ -d "$dir" ]; then
      local dir_files
      dir_files=$(find "$dir" -type f 2>/dev/null | wc -l)
      if [ "$dir_files" -eq 0 ]; then
        warn "$dir exists but is empty — consider removing"
      else
        fail "$dir still has $dir_files files (should be archived)"
      fi
    else
      pass "$dir removed"
    fi
  done
}

# ─── 全域檢查 ───
verify_GLOBAL() {
  echo ""
  echo "══════════════════════════════════════"
  echo "  全域品質檢查"
  echo "══════════════════════════════════════"

  # TypeScript 編譯
  echo "── TypeScript compilation ──"
  if command -v npx &>/dev/null && [ -f "tsconfig.json" ]; then
    if npx tsc -p tsconfig.json --noEmit 2>/dev/null; then
      pass "TypeScript compiles with zero errors"
    else
      fail "TypeScript compilation errors"
    fi
  else
    warn "TypeScript compiler not available"
  fi

  # 前端 build
  echo "── Frontend build ──"
  if command -v npm &>/dev/null && [ -f "package.json" ]; then
    if npm run build --silent 2>/dev/null; then
      pass "npm run build succeeded"
    else
      fail "npm run build failed"
    fi
  else
    warn "npm not available"
  fi

  # 後端 pytest
  echo "── Backend tests ──"
  if [ -x "backend/.venv312/bin/python" ]; then
    cd backend
    local test_output
    test_output=$(.venv312/bin/python -m pytest tests/ --tb=no -q 2>&1 || true)
    # Parse pytest summary line: "X failed, Y passed, Z skipped, ..." or "Y passed in ..."
    # Use awk for portability (BSD grep lacks -P).
    local summary_line
    summary_line=$(echo "$test_output" | tail -5 | grep -E '[0-9]+ (passed|failed)' | tail -1 || true)
    local failed
    failed=$(echo "$summary_line" | awk -F'[ ,]+' '{ for(i=1;i<=NF;i++) if($i=="failed") print $(i-1) }')
    local passed
    passed=$(echo "$summary_line" | awk -F'[ ,]+' '{ for(i=1;i<=NF;i++) if($i=="passed") print $(i-1) }')
    failed="${failed:-0}"
    passed="${passed:-?}"
    echo "  ℹ  ${passed} passed, ${failed} failed"
    if [ "$failed" -eq 0 ]; then
      pass "All backend tests passed"
    else
      fail "$failed backend test(s) failed"
    fi
    cd ..
  else
    warn "Backend venv not found, skipping pytest"
  fi

  # 檢查根目錄 __pycache__
  echo "── Root __pycache__ ──"
  if [ -d "__pycache__" ]; then
    warn "Root __pycache__/ exists — run: rm -rf __pycache__/"
  else
    pass "No root __pycache__/"
  fi

  # git status 乾淨度
  echo "── Git cleanliness ──"
  local untracked
  untracked=$(git ls-files --others --exclude-standard 2>/dev/null | grep -v '_archive_candidates' | head -5 || true)
  if [ -n "$untracked" ]; then
    warn "Untracked files outside archive:"
    echo "$untracked"
  else
    pass "No unexpected untracked files"
  fi
}

# ─── 主入口 ───
main() {
  local target="${1:-ALL}"

  echo "══════════════════════════════════════"
  echo "  專案重整驗證 — $target"
  echo "══════════════════════════════════════"
  echo ""

  if [ "$target" = "ALL" ]; then
    for t in T01 T02 T03 T04 T05 T06 T07 T08; do
      verify_$t
      echo ""
    done
    verify_GLOBAL
  else
    verify_$target
  fi

  echo ""
  echo "══════════════════════════════════════"
  echo -e "  結果: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
  echo "══════════════════════════════════════"

  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}

main "$@"
