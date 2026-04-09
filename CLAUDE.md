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
# 預期：{"success":true,"data":{"status":"healthy",...}}
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
- 如果懷疑某個 migration ��標記完成但資料沒進去，建立新的 migration 重新 seed

### 5. 常見陷阱
- **Vercel VITE_API_URL**：`vercel.json` 的 `buildCommand` 已強制 `VITE_API_URL=`，確保前端走 Vercel proxy 而非直連 Railway
- **CORS**：前端透過 Vercel proxy 呼叫 API 不需要 CORS。如果看到 CORS 錯誤，表示請求繞過了 proxy 直連 Railway
- **Cookie 轉發**：Vercel proxy 會轉發 cookies，auth 正常運作。直連 Railway 則 cookies 不會送出
- **Vercel 共用路徑**：`/patients`、`/dashboard`、`/admin`、`/pharmacy` 需要 `x-request-id` header 才會���發到 Railway，否則返回 SPA HTML
- **SQLAlchemy async flush**：UPDATE 後若有 `onupdate=func.now()` 欄位，必須 `await db.refresh(obj)` 才能安全存取
