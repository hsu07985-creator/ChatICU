# ChatICU 前後端啟動與開啟程式碼

## 哪一個是正確的前後端

- 前端: 專案根目錄的 Vite + React (`src/`，入口 `src/main.tsx`、`src/App.tsx`)
- 後端: FastAPI (`backend/app/`，入口 `backend/app/main.py`)
- `server/`: Dart Frog 專案（另一套後端），目前這份前端主要呼叫 FastAPI 的 `/api/v1/*`，不是接 `server/`。

## 一鍵啟動（推薦，含 DB/Redis/種子資料）

後端 `backend/docker-compose.yml` 已整合：

- 自動 Alembic migration（`alembic upgrade head`）
- 若 DB 尚未有任何使用者，會自動從 `../datamock` seed demo 資料（帳密為 username/username）
- 同時提供一個前端靜態站台（用於 smoke/E2E），從 `../build` 服務並支援 SPA route fallback

啟動：

```bash
cd backend
docker compose up -d
```

如果你是第一次啟動或前端畫面空白，請先在專案根目錄執行一次：

```bash
npm run build
```

開啟：

- 前端: `http://127.0.0.1:3000`
- 後端 health: `http://127.0.0.1:8000/health`
- 後端 swagger: `http://127.0.0.1:8000/docs`

測試帳號（username / password）：

- `nurse` / `nurse`
- `doctor` / `doctor`
- `admin` / `admin`
- `pharmacist` / `pharmacist`

## 開啟程式碼（看前端/後端在哪）

- 前端主要看: `src/`, `vite.config.ts`, `.env.development`
- 後端主要看: `backend/app/`, `backend/.env`, `backend/Dockerfile`

用你本機的 IDE 直接開專案根目錄即可（會同時包含 `src/` + `backend/`）。

## 啟動後端（FastAPI）

```bash
cd backend
./.venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

測試:

```bash
curl -sS http://127.0.0.1:8000/health
```

Swagger:

- `http://127.0.0.1:8000/docs`

## 啟動前端（Vite）

在專案根目錄:

```bash
npm run dev -- --host 127.0.0.1 --port 3000
```

如果 `3000` 被佔用，Vite 會自動改用其他 port（常見如 `4173`、`5173`），以終端機輸出的 URL 為準。

## 先做埠衝突檢查（建議）

某些本機工具（例如容器/轉發服務）可能佔用 `3000` 或 `8000`，導致啟動看似成功但流量未走到預期服務。

```bash
lsof -nP -iTCP -sTCP:LISTEN | rg ':(3000|4173|8000)\\b|COMMAND'
```

若看到非本專案 `node (vite)` / `Python (uvicorn)` 的行程，建議先停掉該行程或改用其他埠，再啟動前後端。

## 登入不了: 「網路連線失敗，請檢查網路狀態」怎麼查

這個錯誤通常不是「真的斷網」，而是瀏覽器請求被擋下，前端拿不到 HTTP 回應（Axios 的 `error.response` 會是 `undefined`），最常見原因是 CORS 白名單沒有包含你目前前端的 Origin（例如前端跑在 `http://127.0.0.1:3001`）。

檢查方式:

1. 看前端實際跑在哪個網址（例如 `http://127.0.0.1:3001/`）。
2. 確認後端 `backend/.env` 的 `CORS_ORIGINS` 有包含同一個 Origin（必須完全一致，含 port）。

目前預設已允許這些常見開發 Origin：

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:4173`
- `http://localhost:4174`
- `http://localhost:5173`
- `http://localhost:5174`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:3001`
- `http://127.0.0.1:4173`
- `http://127.0.0.1:4174`
- `http://127.0.0.1:5173`
- `http://127.0.0.1:5174`

同步位置：

- `backend/.env`
- `backend/.env.example`
- `backend/app/config.py`（預設清單）

如果你之後前端跑到其他未列入的 port（例如 `3002`），請把對應 Origin 加進 `backend/.env` 的 `CORS_ORIGINS`，再重啟後端。
