# backend/scripts — 操作腳本清單

> **路徑不可移動**：`sync_his_snapshots*.py`、`run_his_snapshot_sync.sh` 被
> launchd / crontab（見 `chaticu_his_sync.crontab.example`）與 CLAUDE.md 記載的
> 工作流以固定相對路徑引用；搬移會無聲弄壞排程。

## HIS 同步（生產工作流）

| 腳本 | 用途 |
|---|---|
| `sync_his_snapshots_serial.py` | **正式版** HIS snapshot → Supabase 同步（順序寫入，每筆 persist）。用法見根 CLAUDE.md |
| `sync_his_snapshots.py` | 舊版並行 sync——寫入模式已在程式內硬性停用（Supabase pooler silent-fail，2026-04-27）；僅剩 `--dry-run` 預覽。launchd/wrapper 自 2026-07-19 起改跑 serial 版 |
| `run_his_snapshot_sync.sh` | launchd/cron 進入點（包 venv 與 log） |
| `install_his_sync_launchd.sh` | 安裝 launchd 排程 |
| `keep_mac_awake.sh` | 同步期間防休眠 |
| `chaticu_his_sync.crontab.example` | crontab 範例 |
| `import_his_patients.py` | HIS JSON → DB 匯入（upsert、冪等；`--dry-run` 預覽） |
| `audit_alt_mrn.py` | 稽核 patient/ 內 MRN 對應 |

## 藥物資料

| 腳本 | 用途 |
|---|---|
| `build_formulary_csv.py` | 從 `local/xlsx/` 陽明藥品清單產出 `app/fhir/code_maps/drug_formulary.csv` |
| `refresh_rxnorm_cache.py` | 更新 RxNorm 快取 |
| `backfill_drug_interactions_atc.py` | 回填交互作用 ATC 欄位 |
| `upgrade_xd_from_lexicomp.py` | Lexicomp X/D 升級候選（輸出到 `reports/`） |
| `seed_duplicate_groups.py` / `seed_demo_duplicates.py` | 重複用藥 seed |
| `smoke_test_duplicates.py` | 重複用藥 smoke test |

## 稽核／基準／一次性

| 腳本 | 用途 |
|---|---|
| `fhir_baseline_audit.py` | FHIR 基準稽核（寫 docs/fhir-baseline-report.md） |
| `b15_baseline_synthetic.py` / `b15_snapshot_audit.py` | B15 snapshot 延遲基準 |
| `backfill_orphan_advice.py` | 孤兒 advice 記錄回填（一次性） |
| `run_seed_repair.py` | seed 修復（一次性） |
| `probe_ai_chat_context.py` | AI chat context 探測（除錯用） |
