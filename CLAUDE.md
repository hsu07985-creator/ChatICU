# CLAUDE.md — 專案重整與防護規範

## 開工前必讀（live tracking docs）

每次進入這個 repo 工作前，先讀以下檔案以掌握「目前正在進行的修補」與「PM 已決策但尚未落地」項目：

0. **[`docs/his-sync/his-auto-import-progress.md`](docs/his-sync/his-auto-import-progress.md)** — 🟡 **進行中（更新至 2026-07-22）**：HIS 病人、藥物、檢驗與培養串接。`1574779b1` 已部署 Railway + Vercel，migration 085 已套用；2,120 筆藥物、6,224 項檢驗、1,812 項培養/藥敏逐筆驗收零差異。新 mapping 需等下一次 HIS sync 寫入正式 DB；床號覆蓋行為仍待決策。碰 HIS sync / converter / 病人欄位前先看這頁。
1. **[`docs/team-chat/team-chat-followup-fixes-2026-05-03.md`](docs/team-chat/team-chat-followup-fixes-2026-05-03.md)** — 團隊聊天室 audit 後續追加修補（Wave 5）。包含 patient-board per-user 未讀、SOAP 落地、藥物統計頁 UX 三條進行中任務。
2. **[`docs/team-chat/team-chat-fixes-progress.md`](docs/team-chat/team-chat-fixes-progress.md)** — 主進度面板（Wave 1-5 + Backlog）。
3. **[`docs/team-chat/team-chat-audit-fixes-2026-05-03.md`](docs/team-chat/team-chat-audit-fixes-2026-05-03.md)** — 完整 41 條 audit 發現對照表。
4. **[`docs/coordination/backend-tasks.md`](docs/coordination/backend-tasks.md)** / **[`docs/coordination/frontend-tasks.md`](docs/coordination/frontend-tasks.md)** — 任務佇列。
5. **[`docs/i18n/i18n-rollout-progress.md`](docs/i18n/i18n-rollout-progress.md)** — i18n（中/英介面）導入進度。Wave 0+1 已完成（基建 + sidebar/notification/error/role 字典化）；Wave 2-7 依「使用者價值優先」分波段進行。觸碰任何 UI 字串前先看此文件確認該區是否已被字典化。
6. **[`docs/i18n/i18n-rollout-plan-2026-05-04.md`](docs/i18n/i18n-rollout-plan-2026-05-04.md)** — i18n 主計畫（架構、namespace、命名慣例、不在範圍項目）。新增字串請依 `<namespace>:<page>.<section>.<key>` 命名，且**避免硬編碼字串到 UI**（Wave 7 後將以 lint 強制）。
7. **[`docs/operations/deployment-guide.md`](docs/operations/deployment-guide.md)** — Commit / Push / 部署驗證標準流程（feature branch、pre-commit hook、`personal` vs `railway` remote 對應、後端/前端/DB 驗證指令、常見坑、rollback）。改完要 push 之前必看。

如果你的工作觸碰 team chat / 鈴鐺 / mention / patient board 任何相關區域，先看 `team-chat-followup-fixes-2026-05-03.md` 的「修補狀態」段落，確認你不會與正在進行的修補衝突。

## 背景

本次任務基於 2026-02-18 的專案盤點報告。Batch 1-5 的封存/遷移/修正已完成，
本輪聚焦於：既有技術債修復、CI 防護閘門建置、未決項目收尾。

## 修復流程

1. **修改前**：先讀取目標檔案，確認現狀與報告描述一致
2. **修改時**：只改必要部分，不重構無關代碼
3. **修改後**：立即執行 `bash scripts/verify_restructure.sh <TXX>`
4. **Commit 規範**：每個任務獨立 commit，格式 `chore(TXX): <英文描述>`

## 目錄慣例（完整結構契約見 [`docs/repo-structure.md`](docs/repo-structure.md)）

- Markdown 文件 **一律放 `docs/<功能域>/`**（team-chat、ai-chat、i18n、pharmacy、his-sync…），禁止放在 `src/` 或 repo 根目錄；audit/progress 配對文件放同一目錄
- 機器本地資料（參考語料、藥物來源資料、側專案、xlsx）放 **`local/`**（ignored），並登記到 `local/README.md`；`patient/` 是唯一例外——HIS sync 以固定路徑依賴，留在根目錄勿搬
- 封存檔案放 `_archive_candidates/YYYYMMDD/`，附 README 說明封存原因
- `src/imports/` 僅保留被活躍頁面 import 的檔案
- 前端 CSS 加在 `src/styles/globals.css`（`src/index.css` 是已移除的 Figma 死檔，勿重建）
- 前端 domain 邏輯放 `src/lib/<domain>/`，勿復活 `src/features/`
- 前端資料抓取一律走 TanStack Query（`usePatientList` / `useApiQuery`），勿再手刻 module-level cache / setInterval poller（2026-07-19 B1/B5 已收斂）

## 禁止事項

- 不得在 `src/` 新增 `.md` 文件（放 `docs/` 或 `docs/frontend/`）
- 不得將 `_archive_candidates/` 推入版本庫（應在 `.gitignore`）
- 不得在無防護的情況下對空向量執行 matmul / cosine similarity
- 不得新增 Figma 匯出檔到 `src/imports/` 而不在頁面中引用

## 部署架構

| 元件 | 平�� | URL | Git Remote |
|------|------|-----|------------|
| Frontend | Vercel | `https://chat-icu.vercel.app` | `railway` (→ hsu07985-creator/ChatICU) |
| Backend | Railway | `https://chaticu-production-8060.up.railway.app` | `personal` (→ jht12020304/ChatICU) |
| Database | Supabase | PostgreSQL (透過 Railway 的 DATABASE_URL 連線) | — |

> **注意**：remote 名稱容易混淆！`railway` remote 部署到 **Vercel**，`personal` remote 部署到 **Railway**。

## 部署與驗證流程（每次修改必須遵守）

### 1. 提交前
- Pre-commit hook 禁止直接 commit 到 `main` — 必須先建 feature branch 再 merge
- 格式：`git checkout -b fix/描述 && git commit && git checkout main && git merge fix/描述 --no-edit`

### 2. Push 到正確的 remote
- **後端變更** → `git push personal main`（Railway 自動部署，含 `alembic upgrade head`）
- **前���變更** → `git push railway main`（Vercel 自動 build）
- **兩者都改** → 兩個都 push

### 3. 部署驗證清單（必做）

#### Railway（後端）
```bash
# 等待 60-90 秒部署完成，然後：
curl -s https://chaticu-production-8060.up.railway.app/health
# 預期：{"success":true,"data":{"status":"healthy","database":"ok",...}}
# 2026-07-19 起 /health 會真的 SELECT 1:DB 不通回 503 + status=degraded。
# 容器 liveness 另有 /health/live(純 process 存活,不碰 DB)。
```

#### Vercel（前端）
```bash
# 確認新 bundle 已部署（hash 會變）：
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'

# 確認 VITE_API_URL 沒有洩漏 Railway URL（應為空）：
curl -s "https://chat-icu.vercel.app/$(curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js')" | grep -oE 'chaticu-production[^"]*' | head -1
# 預期：無���出（空）
```

#### Supabase（資料庫）
```bash
# 透過 Playwright 或瀏覽器呼叫 API 確認資料狀態：
# - 登入後 fetch('/auth/me') → 確認使用者存在
# - fetch('/record-templates?recordType=progress-note') → 確認模板存在
# - 如有 migration 變更，確認相關表/資料已更新
```

### 4. Alembic Migration 注意事項
- Procfile 啟動時自動執行 `alembic upgrade head`
- Seed data 的 `created_by_id` **必須**使用真實存在的 user ID（如 `usr_003`），不可用 `"system"`（FK 約束）
- 新 migration 必須是冪等的（用 `IF NOT EXISTS` 或先查再插）
- **新 migration 必須能在全新空 DB 上通過**（2026-07-10 起）：資料型 seed migration 引用 demo 病人／使用者前先檢查存在、缺席時安全跳過（先例：029/030/035/044/050）。asyncpg 陷阱：DATE 欄要傳 `datetime.date` 不可傳字串、一個 `op.execute` 只能一條 SQL、`:param::jsonb` 解析不了要用 `CAST(:param AS JSONB)`
- 改完 migration 跑 `bash scripts/ops/verify_fresh_db_bootstrap.sh`（拋棄式 pgvector 容器 → alembic head 零跳過 → seeds → API 冒煙，結尾應為 PASS）
- **2026-07-19 起：不要再新增 data-seed / backfill migration**——資料修補走 `backend/scripts/run_seed_repair.py`，alembic 只放 schema 變更。如果懷疑某個舊 migration 被標記完成但資料沒進去，用 seed_repair 腳本補，不要再疊 migration

### 5. 常見陷阱
- **Vercel VITE_API_URL**：`vercel.json` 的 `buildCommand` 已強制 `VITE_API_URL=`，確保前端走 Vercel proxy 而非直連 Railway
- **CORS**：前端透過 Vercel proxy 呼叫 API 不需要 CORS。如果看到 CORS 錯誤，表示請求繞過了 proxy 直連 Railway
- **Cookie 轉發**：Vercel proxy 會轉發 cookies，auth 正常運作。直連 Railway 則 cookies 不會送出
- **Vercel 共用路徑**：`/patients`、`/dashboard`、`/admin`、`/pharmacy` 需要 `x-request-id` header 才會���發到 Railway，否則返回 SPA HTML
- **SQLAlchemy async flush**：UPDATE 後若有 `onupdate=func.now()` 欄位，必須 `await db.refresh(obj)` 才能安全存取

## 手動更新 HIS 患者資料到 Supabase

新資料路徑：`patient/{MRN}/{YYYYMMDD_HHMMSS}/`。**放完新 snapshot 必須更新 `patient/{MRN}/latest.txt` 指到新目錄名**，否則 sync 會用舊 snapshot。

### 必用 serial 版（**禁用** `sync_his_snapshots.py`）
```bash
cd backend
python3 scripts/sync_his_snapshots_serial.py --force            # 全量強制重跑
python3 scripts/sync_his_snapshots_serial.py -p 50480738        # 單一 MRN
python3 scripts/sync_his_snapshots_serial.py                     # 增量（依 hash 跳過 unchanged）
```

### 為何禁用舊版 `sync_his_snapshots.py`（2026-04-27 發現）
舊版用 `asyncio.create_task` + `Semaphore` + `as_completed` + `engine.dispose()` 與 Supabase pooler (port 6543, transaction mode) 互動會 **silent fail**：
- ✅ console 報告 `synced=14, errors=0`
- ✅ `backend/.state/his_snapshot_sync_state.json` 標記成功
- ✅ `backend/.logs/his_sync/coverage_*.json` 寫入
- ❌ **但 DB 完全沒寫進去**（`patients` / `medications` 等表 `updated_at` 都停在更早的時間）

可疑信號：sync 在 < 1 秒完成（114 個 INSERT × pooler RTT ~450ms 不可能 0.7s 完成）。
Serial 版改用順序 `async with session_factory()` + `await session.commit()`，每位 4–5 分鐘但每筆都 persist。

### 寫入後的 DB 端驗證（不靠 sync 自報的 errors=0）

> **時區**：DB 存的 `updated_at` 是 UTC（`+00:00`）。下面 SQL 用 `AT TIME ZONE 'Asia/Taipei'` 轉成台北時間（UTC+8）方便比對你的本機時間。例：DB 的 `15:39 UTC` = 台北 `23:39`。

```bash
cd backend && python3 - <<'PY'
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
url = next(l.split('=',1)[1].strip().strip('"') for l in open('.env.his-sync') if l.startswith('DATABASE_URL='))
async def m():
    e = create_async_engine(url, connect_args={'prepared_statement_cache_size':0,'statement_cache_size':0})
    async with e.connect() as c:
        r = await c.execute(text("""
            SELECT id, name, bed_number,
                   (updated_at AT TIME ZONE 'Asia/Taipei') AS updated_taipei
            FROM patients
            WHERE updated_at >= now() - interval '2 hours'
            ORDER BY updated_at DESC
        """))
        for row in r:
            print(f'  {row.id} | {row.name} | bed={row.bed_number!r} | 台北時間 {row.updated_taipei}')
    await e.dispose()
asyncio.run(m())
PY
```
出現該位 patient row 的「台北時間」是剛剛 sync 的時刻 → 真寫進去。

### 速度與時程
- 每位病人 ~4–5 分鐘（Sydney pooler 每 INSERT RTT ~450ms × 300+ row）
- 14 位病人 ≈ 60 分鐘（背景跑、可邊做別的）
- 想加速 → 改 `backend/.env.his-sync` 用 Supabase **direct connection (port 5432)** 取代 pooler 6543（需 Supabase Pro plan 的 IPv4 add-on），單筆 RTT 可降到 50–100ms

### 前端 cache 的暗礁
HIS sync 直寫 DB，前端 `src/lib/patients-cache.ts` 完全不知情（5 分鐘 TTL）。sync 完要看到資料：
- 列表頁 (`/patients`) → `Cmd+Shift+R` 硬重整
- 詳情頁 (`/patient/:id`) → 無 cache，直接看到（前提：DB 真有寫進去）

### 完整流程文件
詳細步驟、`latest.txt` 格式、coverage report、launchd 排程等見：[`docs/his-sync/資料更新_0424.md`](docs/his-sync/資料更新_0424.md)
