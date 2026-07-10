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

## 第二波（同日稍晚）— 未完成清單全數收掉

| 項目 | 狀態 |
|---|---|
| security-scan 11 個 Medium：逐點審查（10 nosec 附不變量理由、1 處根修 f-prefix、B310 加 https 強制） | ✅ bandit medium exit 0 |
| 工作站「產生報告」按鈕恢復（F-DECIDE 選項 1）＋ e2e 覆蓋完整送出旅程 | ✅ e2e 7/7 |
| svc-2 per-item lab 時效標註（不丟資料、>24h 標 (Nh前)/(N天前)、4 條單元測試） | ✅ pytest 811 passed |
| 小項四件：vite /ai proxy bypass、colgroup 空白、呼吸器天數欄寬、ScrollArea forwardRef | ✅ tsc/build/eslint 綠 |

### 最終確認（2026-07-10 18:50）

- **CI run `fabf5e713` conclusion: SUCCESS — 全部 job 綠**（backend-lint / migration-check /
  backend-test / static-guards / frontend-build / **security-scan** / dast / e2e-critical /
  reproducibility-report / docker-build；e2e-extended 為條件性 job 正常 skip）。
  這是本 repo 記錄以來第一次 CI 全綠。
- 部署：Railway `/health` healthy；Vercel 新 bundle（`index-DTEXfl_q.js`）上線、
  含恢復按鈕的 i18n key、無 Railway URL 洩漏。
- 本機測試資源已清理（visual stack 停止、`chaticu-visual-db` 移除；
  `chaticu-redis` 為 compose 正式服務保留）。

**後續建議（新）**：snapshot_sync 欄位名以常數白名單斷言（目前隱含信任 HISConverter 的 key 紀律，
是最可能的回歸點——見 security commit 訊息）；review doc 剩餘 ~14 條 low/cosmetic 可另批處理。

## 原「未完成」清單（已全數處理，留存紀錄）

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
