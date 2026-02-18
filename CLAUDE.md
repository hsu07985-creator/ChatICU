# CLAUDE.md — 專案重整與防護規範

## 背景

本次任務基於 2026-02-18 的專案盤點報告。Batch 1-5 的封存/遷移/修正已完成，
本輪聚焦於：既有技術債修復、CI 防護閘門建置、未決項目收尾。

## 修復流程

1. **修改前**：先讀取目標檔案，確認現狀與報告描述一致
2. **修改時**：只改必要部分，不重構無關代碼
3. **修改後**：立即執行 `bash scripts/verify_restructure.sh <TXX>`
4. **Commit 規範**：每個任務獨立 commit，格式 `chore(TXX): <英文描述>`

## 目錄慣例

- Markdown 文件 **一律放 `docs/`**，禁止放在 `src/`
- 封存檔案放 `_archive_candidates/YYYYMMDD/`，附 README 說明封存原因
- `src/imports/` 僅保留被活躍頁面 import 的檔案
- `server/` 為 Dart Frog 參考實作，非正式後端

## 禁止事項

- 不得在 `src/` 新增 `.md` 文件（放 `docs/` 或 `docs/frontend/`）
- 不得將 `_archive_candidates/` 推入版本庫（應在 `.gitignore`）
- 不得在無防護的情況下對空向量執行 matmul / cosine similarity
- 不得新增 Figma 匯出檔到 `src/imports/` 而不在頁面中引用
