# 部署教學 — Commit / Push / 驗證

本文件是 ChatICU 的標準部署流程（feature branch → commit → merge main → push 到對的 remote → 驗證）。CLAUDE.md 有更詳細的背景說明，本文件聚焦在「可直接複製貼上」的指令。

---

## 0. 一次釐清：哪個 remote 部署到哪？

**remote 名稱跟實際平台是反過來的**，這是最常見的誤踩。記住下面這張表：

| Remote 名稱 | GitHub repo | 實際部署平台 | 部署網址 |
|---|---|---|---|
| `personal` | `jht12020304/ChatICU` | **Railway（後端）** | `https://chaticu-production-8060.up.railway.app` |
| `railway` | `hsu07985-creator/ChatICU` | **Vercel（前端）** | `https://chat-icu.vercel.app` |
| `origin` | `ZymoMed/ChatICU_YU` | （不部署，只是 ZymoMed 主 repo） | — |

> 後端改 → push 到 `personal`
> 前端改 → push 到 `railway`
> 兩邊都改 → 兩個都 push

確認 remote 設定：
```bash
git remote -v
```

---

## 1. 開工：建 feature branch（必做）

main 被 `pre-commit` hook 鎖住，**不能直接 commit 上 main**。每次都建一條短命名的 branch：

```bash
git checkout main
git pull origin main         # 可選，但建議先同步
git checkout -b fix/<簡短描述>
```

命名慣例：
- `fix/...` — bug 修復
- `feat/...` — 新功能
- `chore/...` — 雜務、文件、設定
- `i18n/...` — i18n 相關
- `docs/...` — 純文件

---

## 2. 改完 → commit

```bash
git status                    # 確認改了什麼
git add <具體檔案>             # 不要用 git add . 或 -A，避免誤加 .env / 大檔
git commit -m "feat(xx): <英文描述>"
```

### Pre-commit hook 會擋什麼？

`.pre-commit-config.yaml` 設定的會自動跑：

| 檢查項 | 會擋的情況 |
|---|---|
| `detect-secrets` | 偵測到 API key、password、token |
| `gitleaks` | 另一套 secret scanner |
| `check-added-large-files` | 單檔 > 500 KB |
| `check-merge-conflict` | 殘留 `<<<<<<<` 標記 |
| `detect-private-key` | RSA/SSH 私鑰 |
| `no-commit-to-branch main` | 直接在 main 上 commit |

### Hook 失敗怎麼辦？

**不要用 `--no-verify`**（CLAUDE.md 禁止），先看為什麼擋：
- secret scanner 誤報 → 加到 `.secrets.baseline`：`detect-secrets scan --baseline .secrets.baseline`
- 大檔誤入 → 改放 `_archive_candidates/` 或 `git rm --cached <file>`
- merge conflict 殘留 → 解完衝突再 commit

---

## 3. Merge 回 main → push 對的 remote

```bash
git checkout main
git merge fix/<branch> --no-edit
```

### 推到實際部署的 remote（不是 origin！）

```bash
# 後端變更（含 backend/、alembic、Procfile、.env.example、scripts/）
git push personal main

# 前端變更（含 src/、vercel.json、index.html、package.json、tailwind 等）
git push railway main

# 兩邊都改
git push personal main && git push railway main
```

> `git push origin main` **不會觸發任何部署** — origin 只是 ZymoMed 主 repo。如果你想同步 ZymoMed 也記得 push 一份。

---

## 4. 部署驗證（每次 push 完都要做）

### 4-1. 後端（Railway）

```bash
# 等 60–90 秒讓 Railway build + alembic upgrade head 跑完
sleep 80

curl -s https://chaticu-production-8060.up.railway.app/health
# 預期：{"success":true,"data":{"status":"healthy","database":"ok",...}}
# 2026-07-19 起 /health 真的 SELECT 1:DB 不通會回 503 + status=degraded、
# database=unreachable —— 這個 curl 現在驗得到 DB 連線,不再是硬編碼綠燈。
# /health/live 是純 liveness(不碰 DB),給容器 HEALTHCHECK 用。
```

如果 503 / timeout：
- 先看回應 body：`database:"unreachable"` = app 活著但 DB 不通(Supabase/pooler 問題)
- 開 Railway dashboard 看 build log
- 通常是 alembic migration 失敗或環境變數錯
- Procfile 與 Dockerfile 啟動都會 `alembic upgrade head` 且**失敗即不開機**(2026-07-19 起 Dockerfile 不再吞 migration 失敗),migration 必須冪等

### 4-2. 前端（Vercel）

```bash
# 確認新 bundle 已部署（hash 會跟上次不同）
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'

# 確認 VITE_API_URL 沒洩漏 Railway URL（應為空字串）
JSURL=$(curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js' | head -1)
curl -s "https://chat-icu.vercel.app/$JSURL" | grep -oE 'chaticu-production[^"]*' | head -1
# 預期：無輸出
```

如果 grep 抓到 `chaticu-production...`，代表前端會直連 Railway 而不是走 Vercel proxy → cookies 不會送出 → auth 壞掉。修法是確認 `vercel.json` 的 `buildCommand` 開頭有 `VITE_API_URL=`。

### 4-3. 資料庫（Supabase）

如果有改 migration 或 seed，跑：

```bash
cd backend && python3 - <<'PY'
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
url = next(l.split('=',1)[1].strip().strip('"') for l in open('.env.his-sync') if l.startswith('DATABASE_URL='))
async def m():
    e = create_async_engine(url, connect_args={'prepared_statement_cache_size':0,'statement_cache_size':0})
    async with e.connect() as c:
        # 看最近 migration
        r = await c.execute(text("SELECT version_num FROM alembic_version"))
        print("alembic_version:", r.first().version_num)
    await e.dispose()
asyncio.run(m())
PY
```

---

## 5. 完整流程速查（複製貼上）

### 前端小改

```bash
git checkout -b fix/sidebar-typo
# ... 改檔案 ...
git add src/components/Sidebar.tsx
git commit -m "fix(sidebar): typo in patient list label"
git checkout main
git merge fix/sidebar-typo --no-edit
git push railway main
sleep 60
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'
```

### 後端小改

```bash
git checkout -b fix/medication-api
# ... 改檔案 ...
git add backend/api/medications.py
git commit -m "fix(api): handle null dosage in medication list"
git checkout main
git merge fix/medication-api --no-edit
git push personal main
sleep 80
curl -s https://chaticu-production-8060.up.railway.app/health
```

### 前後端都改

```bash
git checkout -b feat/new-feature
# ... 改前後端 ...
git add src/... backend/...
git commit -m "feat(xx): <描述>"
git checkout main
git merge feat/new-feature --no-edit
git push personal main && git push railway main
sleep 90
curl -s https://chaticu-production-8060.up.railway.app/health
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'
```

---

## 6. 常見坑

### Vercel 共用路徑回傳 SPA HTML

`/patients`、`/dashboard`、`/admin`、`/pharmacy` 這幾個路徑同時是前端 route 也是後端 API path。Vercel proxy 規則只在 request 帶 `x-request-id` header 時才轉發到 Railway，否則回 SPA。前端 `apiFetch` 已經自動加這 header；如果你用 curl 直接打要自己加：

```bash
curl -H "x-request-id: test" https://chat-icu.vercel.app/patients
```

### CORS 錯誤

前端透過 Vercel proxy 不需要 CORS。看到 CORS error 就是請求繞過 proxy 直連 Railway 了 → 檢查 `VITE_API_URL` 是否在 build 時被洩漏。

### SQLAlchemy `onupdate=func.now()` 欄位讀到舊值

UPDATE 後要 `await db.refresh(obj)`，否則 ORM cache 還是舊的。

### Migration 標記完成但資料沒進去

不要 downgrade + upgrade（容易毀資料）。建立新的 migration 重新 seed，並用 `IF NOT EXISTS` 確保冪等。

### Seed data 的 `created_by_id`

必須是真實存在的 user ID（如 `usr_003`），不能填 `"system"` 字串 — FK constraint 會 reject。

---

## 7. 緊急 rollback

### Railway（後端）

Railway dashboard → Deployments → 找到上一個成功的 deploy → "Rollback"。

或本地 revert：
```bash
git checkout main
git revert <bad-commit-sha> --no-edit
git push personal main
```

### Vercel（前端）

Vercel dashboard → Deployments → 上一個成功的 → "Promote to Production"。

或本地 revert + push railway。

---

## 8. 全新資料庫 bootstrap（本地 / CI / 新機器）

2026-07-10 起，**完全空白的資料庫**可以用與 prod 相同的兩步驟直接建起：

```bash
cd backend
python -m alembic upgrade head        # 80 條 migration 全數套用，零跳過
SEED_PASSWORD_STRATEGY=username python -m seeds.seed_data
python -m seeds.seed_culture_results  # 選配：培養結果 demo 資料
```

前提與注意：

- **DB 必須有 pgvector**（migration 022 執行 `CREATE EXTENSION vector`）。
  docker compose 與 CI 已改用 `pgvector/pgvector:pg16`；本機裸 postgres
  沒裝 pgvector 時，`scripts/e2e/run_managed_e2e.sh` 會在 preflight 直接
  告訴你怎麼開一個拋棄式容器。
- 資料型 migration（029/030 模板、035–038/043/044/047/049/050 demo 資料）
  在空 DB 上會自動偵測前置資料不存在而**安全跳過該部分**；系統模板改由
  seed 管線（`seeds/system_templates.py`）在 users 建立後補上。
- **驗收指令**（拋棄式容器 → migration → seed → API 冒煙 → 自動清理）：

```bash
bash scripts/ops/verify_fresh_db_bootstrap.sh
# 預期結尾：PASS — fresh DB bootstrap is healthy
```

---

## 9. 相關文件

- `CLAUDE.md` — 專案總指南（背景、目錄慣例、HIS sync 流程）
- `docs/his-sync/資料更新_0424.md` — HIS 患者資料 sync 完整步驟
- `docs/team-chat/team-chat-followup-fixes-2026-05-03.md` — Wave 5 進行中項目
- `.pre-commit-config.yaml` — hook 設定
- `vercel.json` — Vercel proxy 規則 + build 設定
- `Procfile` — Railway 啟動指令（含 `alembic upgrade head`）
