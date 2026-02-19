# TASKS.md — 專案重整：剩餘任務追蹤

## 使用方式
每完成一個任務，將 `[ ]` 改為 `[x]` 並填入 commit hash。
全部完成後執行 `bash scripts/verify_restructure.sh ALL` 做最終驗證。

---

## 未決項目

- [x] **T01** server/ 目錄處理 — 封存 Dart Frog 後端 `1ff8d23`
  - 路徑：`server/`（528 KB，含 lib/、routes/、pubspec.yaml）
  - 現狀：`server/routes/dashboard/stats.dart` 有未提交修改；DEV_START 文件明確標注前端不接 server/
  - 動作：
    1. 先 commit 或 stash `stats.dart` 的未提交修改（保留歷史）
    2. `mv server/ _archive_candidates/20260218/server/`
    3. 在 `_archive_candidates/20260218/server/` 建立 `README.md`，說明：「Dart Frog 參考實作，非正式後端。stats.dart 含 API 契約參考，如需回溯請查閱此目錄。」
    4. 確認 `health.ts:69` 已在 Batch 5 修正為 uvicorn 指令（不再引用 dart_frog）
  - 驗證：`bash scripts/verify_restructure.sh T01`
  - Commit: <!-- hash -->

## 既有技術債

- [x] **T02** RAG 零除錯誤修復 `18121fd`
  - 檔案：`backend/app/services/llm_services/rag_service.py:103` 附近
  - 問題：RAG index 不存在時，matmul 運算觸發 `RuntimeWarning: divide by zero`，test_rag_query_not_indexed 失敗
  - 動作：
    1. 找到執行 cosine similarity / matmul 的函式
    2. 在查詢前檢查向量索引是否存在且非空（`if index is None or len(index) == 0: return []`）
    3. 若向量長度為 0，直接回傳空結果，不進入 matmul
    4. 確認 `test_rag_query_not_indexed` 測試通過
  - 驗證：`bash scripts/verify_restructure.sh T02`
  - Commit: <!-- hash -->

- [x] **T03** 前端 index chunk code-splitting（626 KB → 293 KB） `9a7f870`
  - 檔案：`src/pages/patient-detail.tsx`（最大頁面）
  - 問題：Vite 建置產出 `index-*.js` 為 626 KB，超過 500 KB 警告閾值
  - 動作：
    1. 辨識 patient-detail.tsx 中可延遲載入的子元件（labs、vitals、ventilator、medications、summary tab）
    2. 使用 `React.lazy()` + `<Suspense fallback={<Skeleton />}>` 包裝各 tab 子元件
    3. 確認 `npm run build` 後 index chunk < 500 KB
    4. 若仍超過，考慮將 Recharts 相關頁面也做 lazy loading
  - 驗證：`bash scripts/verify_restructure.sh T03`
  - Commit: <!-- hash -->

## CI 防護閘門

- [x] **T04** .gitignore 更新 — 排除封存目錄 `1ff8d23`
  - 檔案：`.gitignore`
  - 動作：新增 `_archive_candidates/` 到 `.gitignore`
  - 注意：如果封存檔已被 git track，需先 `git rm -r --cached _archive_candidates/` 再 commit
  - 驗證：`bash scripts/verify_restructure.sh T04`
  - Commit: <!-- hash -->

- [x] **T05** CI 孤兒偵測閘門 `df83af4`
  - 檔案：`.github/workflows/ci.yml`
  - 動作：新增 job step，掃描 `src/imports/` 中未被任何 `src/pages/`、`src/components/`、`src/lib/` 引用的檔案
  - 邏輯：
    ```yaml
    - name: Check for orphaned imports
      run: |
        orphans=0
        for f in src/imports/*.tsx src/imports/*.ts; do
          [ -f "$f" ] || continue
          base=$(basename "$f" .tsx)
          base=$(basename "$base" .ts)
          if ! grep -r "$base" src/pages/ src/components/ src/lib/ \
               --include="*.tsx" --include="*.ts" -q; then
            echo "::error::ORPHAN: $f"
            orphans=$((orphans + 1))
          fi
        done
        [ "$orphans" -eq 0 ] || exit 1
    ```
  - 驗證：`bash scripts/verify_restructure.sh T05`
  - Commit: <!-- hash -->

- [x] **T06** CI 文件位置檢查閘門 `df83af4`
  - 檔案：`.github/workflows/ci.yml`
  - 動作：新增 job step，檢查 `src/` 下是否有 `.md` 檔案（不應有）
  - 邏輯：
    ```yaml
    - name: No markdown in src/
      run: |
        md_files=$(find src/ -name "*.md" -not -path "*/node_modules/*" 2>/dev/null)
        if [ -n "$md_files" ]; then
          echo "::error::Markdown files found in src/ — move to docs/"
          echo "$md_files"
          exit 1
        fi
    ```
  - 驗證：`bash scripts/verify_restructure.sh T06`
  - Commit: <!-- hash -->

- [x] **T07** CI 封存目錄洩漏檢查 `df83af4`
  - 檔案：`.github/workflows/ci.yml`
  - 動作：新增 job step，確認 `_archive_candidates/` 未被 git track
  - 邏輯：
    ```yaml
    - name: No archived files tracked
      run: |
        tracked=$(git ls-files _archive_candidates/ 2>/dev/null)
        if [ -n "$tracked" ]; then
          echo "::error::_archive_candidates/ should be in .gitignore"
          echo "$tracked"
          exit 1
        fi
    ```
  - 驗證：`bash scripts/verify_restructure.sh T07`
  - Commit: <!-- hash -->

## 收尾

- [x] **T08** 驗證 Batch 1-5 完整性
  - 動作：確認報告中所有已執行的操作仍然正確（無人回退）
    1. 根目錄不存在 `config.py`、`security_report.json`、`chaticu-dev-skill/`、`.orchestrator/`
    2. `src/imports/` 僅剩 `svg-n38m0xb9r6.ts`
    3. `src/` 下無 `.md` 檔案
    4. `health.ts:69` 包含 `uvicorn` 而非 `dart_frog`
    5. `tsconfig.json` 的 exclude 中不含 `IcuPatientAi11`
    6. `_archive_candidates/20260218/` 中有 30 個封存檔
  - 驗證：`bash scripts/verify_restructure.sh T08`
  - Commit: <!-- hash (if any fix needed) -->

---

## T22 — CI 3 Consecutive Green Runs

- [x] CI 設置 (`.github/workflows/ci.yml`): 11 jobs — backend-test, frontend-build, backend-lint, security-scan, migration-check, static-integration-guards, dast-scan, reproducibility-report, e2e-critical-journey, e2e-extended-journeys, docker-build
- [x] **Green Run #1** — run `22177463198` (2026-02-19): 10/10 jobs passed (e2e-extended-journeys: scheduled-only, skipped)
- [ ] **Green Run #2** — pending
- [ ] **Green Run #3** — pending

### CI 修正歷程
1. `9734354` fix(T22): JWT_SECRET ≥32 chars for non-DEBUG mode, package-lock.json sync, E2E AI-chat graceful
2. `1cf0c95` fix(T22): package.json vite version sync, orphaned Figma imports removed
3. `708f06f` fix(T22): install ripgrep in CI static-integration-guards
4. `ed04550` chore(T01+T03): commit pending deletions (server/, patches/, src/ markdown, Figma)

---

## 最終驗證
- [x] `bash scripts/verify_restructure.sh ALL` 全部通過 — 33 passed, 0 failed, 1 warning
- [x] `npx tsc -p tsconfig.json --noEmit` 零錯誤
- [x] `npm run build` 通過且 index chunk 284 KB (< 500 KB)
- [x] `cd backend && .venv312/bin/python -m pytest tests/ -v --tb=short` — 170+ passed
- [x] `git status` 僅剩預期的 untracked docs/frontend/ 文件（已遷移但未 commit）
