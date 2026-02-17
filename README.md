# ChatICU 2026

ChatICU 是 ICU 臨床協作系統，包含前端（Vite + React）與後端（FastAPI）。
目前可在「離線 JSON 模式」下開發與驗證，不需醫院內網。

## 1. 專案結構

- 前端：`/src`
- 後端：`/backend/app`
- 離線資料：`/datamock/*.json`
- E2E：`/e2e`
- 測試追蹤：`/docs/json-offline-remediation-task-tracker.md`

## 2. 啟動前需求

- Node.js 20+
- Python 3.12（建議使用 `backend/.venv312`）
- npm

## 3. 快速啟動（離線 JSON 模式）

### 3.1 後端設定與啟動

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
cp .env.example .env
```

確認 `.env` 至少包含：

```env
DATA_SOURCE_MODE=json
SEED_PASSWORD_STRATEGY=username
```

執行初始化與啟動：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
./.venv312/bin/python -m seeds.validate_datamock
./.venv312/bin/python -m alembic upgrade head
SEED_PASSWORD_STRATEGY=username ./.venv312/bin/python -m seeds.seed_if_empty
./.venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 3.2 前端啟動

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm install
VITE_API_URL=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 4173
```

瀏覽器開啟：`http://127.0.0.1:4173`

### 3.3 Docker 啟動（避免與其他專案混用）

預設（DB mode）：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
docker compose -p chaticu up --build
```

離線 JSON mode（需明確 opt-in）：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
docker compose -p chaticu-offline -f docker-compose.yml -f docker-compose.offline.yml up --build
```

說明：
- `-p` 會隔離 compose project name，避免和你其他 Docker 專案混用資源。
- `docker-compose.offline.yml` 只覆蓋 `DATA_SOURCE_MODE=json`，不會影響預設 db mode。

## 4. 驗證命令（建議每次改動後執行）

### 4.1 前端

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run typecheck
npm run build
```

### 4.2 後端

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
./.venv312/bin/pytest tests/test_api -q
```

### 4.3 E2E smoke（若需）

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run test:e2e -- --project=chromium --grep "@critical|@t27-extended"
```

說明：
- `npm run test:e2e` 會使用受控本機執行器（自動啟動隔離埠 backend/frontend、seed、健康檢查、測試後關閉），可避免被其他專案佔用 `8000/4173` 影響。
- 若要直接使用既有已啟動服務，改用：`E2E_MANAGED_SERVERS=0 npm run test:e2e -- --project=chromium ...`
- 若要跳過受控執行器並直接呼叫 Playwright：`npm run test:e2e:raw -- --project=chromium ...`

## 5. 可觀測性（Observability）

### 5.1 統一 log tag

系統使用統一 tag：

- `[INTG]` 整體整合流程
- `[API]` API 請求/回應
- `[DB]` 資料庫鏈路
- `[AI]` AI/LLM/RAG 鏈路
- `[E2E]` 端到端驗證

快速搜尋：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
rg -n "\[INTG\]|\[API\]|\[DB\]|\[AI\]|\[E2E\]" backend src e2e
```

### 5.2 request_id / trace_id 鏈路

- 前端 API client 會送出：`X-Request-ID`、`X-Trace-ID`
- 後端 middleware 會回傳同名 header，並在錯誤 envelope 帶 `request_id` / `trace_id`

快速檢查：

```bash
curl -i -H "X-Request-ID: demo_req_001" -H "X-Trace-ID: demo_trace_001" http://127.0.0.1:8000/health
```

預期 response header 含：

- `X-Request-ID: demo_req_001`
- `X-Trace-ID: demo_trace_001`

## 6. 常見問題排查

### 6.1 前端顯示「網路連線失敗，請檢查網路狀態」

先確認後端是否可達：

```bash
curl -i http://127.0.0.1:8000/health
```

若失敗，檢查：

1. 後端是否啟動在 `127.0.0.1:8000`
2. 前端是否使用 `VITE_API_URL=http://127.0.0.1:8000`
3. 是否有其他程序占用 8000/4173

查埠：

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

若你要直接驗證「不受外部程序干擾」：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run test:e2e -- --project=chromium --workers=1
```

此命令會自動使用隔離埠執行，不依賴目前 8000/4173 是否已被其他程式占用。

### 6.2 登入失敗或 API 401 循環

1. 清除瀏覽器 localStorage 的 token（`chaticu_token`, `chaticu_refresh_token`）
2. 重新登入
3. 確認後端 `auth/refresh` 可用

### 6.3 datamock 驗證失敗

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
./.venv312/bin/python -m seeds.validate_datamock
```

根據輸出修正 `datamock/*.json` 缺欄位或關聯錯誤。

## 7. 相關文件

- 離線模式 Runbook：`/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/operations/json-offline-dev-runbook.md`
- 任務追蹤：`/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/json-offline-remediation-task-tracker.md`
# ChatICU_YU
