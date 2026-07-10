# Repo 結構契約（2026-07-10 重塑後）

> 本文件是目錄結構的「單一事實來源」：每個頂層目錄的用途、anatomy、
> 以及**新檔案該放哪**。參考 agent-skills 的組織原則：每個關注點一個
> 頂層目錄、根目錄只留設定與入口文件。

## 頂層目錄

| 目錄 | 用途 | Git | 部署 |
|---|---|---|---|
| `src/` | 前端原始碼（Vite + React + TS） | tracked | Vercel |
| `public/` | Vite 靜態資產（favicon） | tracked | Vercel |
| `backend/` | FastAPI 後端 | tracked | Railway |
| `datamock/` | 離線 demo 資料 + seed 輸入（CI、docker-compose、e2e 依賴） | tracked | — |
| `e2e/` | Playwright E2E specs（`playwright.config.js` testDir） | tracked | CI |
| `scripts/` | repo 層工具（verify_restructure.sh、e2e/、ops/、匯入腳本） | tracked | CI |
| `func/` | Evidence-RAG 參考管線（自含，不部署） | tracked | — |
| `docs/` | 全部文件，按功能域分組（見下） | tracked | — |
| `reports/` | 產出的稽核/重整報告 | tracked | — |
| `patient/` | HIS 病人 snapshot（`{MRN}/{ts}/` + `latest.txt`） | untracked | — |
| `local/` | 機器本地工作資料（見 `local/README.md`） | ignored | — |
| `_archive_candidates/` | 封存區（`YYYYMMDD/` + README） | ignored | — |
| `build/`、`output/` | 產物（Vite build / Playwright、DAST 報告） | ignored | — |

## 不可移動的路徑（載重清單）

- **部署咬死**：`src/`、`public/`、`index.html`、`build/`（vite outDir + vercel outputDirectory）、`backend/`（Railway）、`package.json`、`vite.config.ts`、`tsconfig.json`、`vercel.json`。
- **CI 咬死**：`datamock/`（DATAMOCK_DIR）、`e2e/`、`output/`、`_archive_candidates/`（不得 tracked）、`src/imports/`（orphan gate）。
- **排程/腳本咬死**：`patient/`（admin_his_sync router + 5 個 backend scripts + launchd）；`backend/scripts/sync_his_snapshots*.py`（crontab/launchd 以固定路徑執行）。
- 引用 `local/` 內資料的程式：`scripts/generate_full_interactions_seed.py`、`scripts/import_iv_compatibility.py`、`func/`（rag 文本）、`backend/app/config.py`（DRUG_GRAPH_*）、`backend/scripts/build_formulary_csv.py`（xlsx）。

## 新檔案該放哪

| 你要新增的東西 | 放哪 |
|---|---|
| 文件（.md） | `docs/<功能域>/`——先找既有分組（team-chat、ai-chat、i18n、pharmacy、medical-records、his-sync、clinical-safety、audit-log、codebase-health、operations、frontend、qa、security、release、coordination、notes）；沒有再開新域。**禁止放 `src/` 或 repo 根目錄** |
| dated audit/progress 配對文件 | 同一個功能域目錄（配對放一起，交叉引用） |
| 前端頁面 | `src/pages/`；超過 ~900 行考慮頁面包 `src/pages/<page>/{index.tsx,…}`（lazy import specifier 不變） |
| 前端共用元件 | `src/components/<domain>/`；shadcn primitives 在 `src/components/ui/` |
| 前端 domain 邏輯/型別 | `src/lib/<domain>/`（**不要**復活 `src/features/`） |
| 前端 CSS | `src/styles/globals.css` 末尾（`src/index.css` 是已移除的死檔，勿重建） |
| 後端 endpoint | `backend/app/routers/`；大 router 拆包先例：`pharmacy_routes/drug_library/`（aggregator routes.py + 子模組） |
| 後端商業邏輯 | `backend/app/services/<package>/` |
| 操作腳本 | `backend/scripts/`（登記到其 README） |
| 本地資料集/參考語料/側專案 | `local/<名稱>/`（登記到 `local/README.md`；部署環境沒有 local/） |
| 臨時輸出/測試產物 | `output/`（ignored）；**不要**丟根目錄 |
| 封存 | `_archive_candidates/YYYYMMDD/` + README 說明原因 |

## docs/ 功能域分組規則

- 以**功能域**分組（不是文件類型）：一個 feature 的 audit / plan / progress / fix 文件放同一目錄。
- 檔名慣例維持 `<topic>-<type>-<YYYY-MM-DD>.md`。
- CLAUDE.md「開工前必讀」清單引用的路徑改動時必須同步更新。

## 驗證

結構完整性由三道閘門保護：
1. `bash scripts/verify_restructure.sh ALL`（T01-T08 + 全域檢查）
2. CI `static-integration-guards`（no md in src、imports orphan、archive leak）
3. 本文件（人工 review 基準）
