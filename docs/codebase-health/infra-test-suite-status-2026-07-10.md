# 基建與測試套件狀態 — 2026-07-10

> 本文件記錄 2026-07-10 repo 重塑後續的基建修復與測試套件復活工作的最終狀態。
> 結構契約見 [`../repo-structure.md`](../repo-structure.md)；fresh DB bootstrap 操作見
> [`../operations/deployment-guide.md`](../operations/deployment-guide.md) §8。

## 已完成（全部已 push 至 personal + railway 兩個 remote）

| 項目 | 狀態 | 證據 |
|---|---|---|
| Repo 重塑（根目錄 60+→28 項、docs 功能域分組、local/ 慣例、src/backend 拆包） | ✅ | commits `e9c8a19a4`..`66e13cc92`，`docs/repo-structure.md` |
| `.compact-table` UI bug 修復（規則原寫在死檔 index.css 從未生效） | ✅ | `db5dd17a6`，prod CSS 已驗證含該規則 |
| Migration 035/036/072 修復（placeholder/日期/多語句 bug——fresh DB 上從未跑通過） | ✅ | `6f29b3d5a` |
| **Fresh DB bootstrap**：空 DB 一鍵 `alembic upgrade head`（80 條零跳過）＋ seeds | ✅ | `2d0e0f184`；驗收 `scripts/ops/verify_fresh_db_bootstrap.sh` = PASS |
| pgvector 基建：compose db image ＋ CI 四個 postgres service → `pgvector/pgvector:pg16` | ✅ | 同上 commit |
| 系統模板 seed 管線（`seeds/system_templates.py`，029/030 空 DB 自動 defer） | ✅ | 同上 commit |
| pytest 全綠：**807 passed / 0 failed**（llm_param_helper 斷言更新至 gpt-5.5 `none` 契約；allergy_parser 改 latest.txt 解析＋輪替 MRN skip） | ✅ | `91727c2f3` |
| e2e 三支 spec 全部翻修至現行 UI：**7 passed / 0 failed**（fresh managed stack） | ✅ | `6e88b0e52` |
| bandit 2 個 High（B324 弱雜湊誤報）→ `usedforsecurity=False` | ✅ | `ff59a29cc` |
| 部署驗證：Railway /health healthy、Vercel 新 bundle 上線且無 URL 洩漏 | ✅ | 兩批 push 後皆確認 |

### CI job 狀態（jht12020304/ChatICU）

修復後首個 run（`2d0e0f184`）：migration-check ✅、backend-test ✅、e2e-critical-journey ✅、
dast ✅、frontend-build ✅、static-guards ✅、backend-lint ✅——先前這些因 pgvector 缺失＋
過時 selectors 長期全紅。唯一殘紅：security-scan（見下）。

## 未完成（依價值排序）

1. **security-scan 殘餘 11 個 Medium**（B608 字串組 SQL ×10、B310 urlopen ×1，早於本輪、
   7/5 排程 run 已紅）。每一處都要逐點驗證「無使用者輸入進入字串插值」後才可加
   `# nosec` 豁免——不可趕工批量豁免。位置：`app/fhir/snapshot_sync.py` ×6、
   `app/routers/patients.py`、`app/routers/pharmacy_routes/advice_records.py`、
   `app/routers/pharmacy_routes/drug_library/catalog_routes.py`、`app/fhir/rxnorm.py`。
2. **工作站「產生報告→送出建議」流程斷頭**：需 PM 二選一（恢復按鈕 vs 刪死碼），
   已登記 `docs/coordination/frontend-tasks.md` F-DECIDE。
3. **6 月 codebase review 殘餘 findings**：confirmed clinical-AI false-negative
   （micro-1/bsc-3/svc-2/3…），見 `codebase-systematic-review-2026-06-03.md`。
4. 小項：vite dev proxy `/ai` 前綴誤傷 `/ai-chat` 整頁載入（dev-only）；
   「呼吸器天數」表頭截斷；colgroup 空白與 ScrollArea forwardRef 兩個 dev console 警告。

## 本輪建立的防護

- `scripts/ops/verify_fresh_db_bootstrap.sh` — 空 DB 驗收（migration 改動後必跑）
- `run_managed_e2e.sh` pgvector preflight — 缺件時給出可操作指令而非天書
- CLAUDE.md §4 新增「migration 必須空 DB 可通過」慣例＋asyncpg 三陷阱
- e2e auth helper 改等 `chaticu_logged_in` cookie（token→cookie 遷移知識落地）
