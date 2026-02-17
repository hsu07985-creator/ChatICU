# ChatICU 離線 JSON 開發模式 Runbook

本文件適用於尚未連接醫院內網時，以 `datamock/*.json` 作為離線資料來源的開發流程。

---

## 1. 目標

1. 前端只透過 API 讀寫資料。  
2. 後端在 `DATA_SOURCE_MODE=json` 下，先驗證 datamock，再 seed 到 DB。  
3. 啟動流程可重複執行（idempotent），便於本機與 CI 一致驗收。

---

## 2. 環境設定

編輯 `backend/.env`（可先複製 `backend/.env.example`）：

```env
DATA_SOURCE_MODE=json
DATAMOCK_DIR=
SEED_PASSWORD_STRATEGY=username
SEED_DEFAULT_PASSWORD=
```

說明：
- `DATA_SOURCE_MODE=json`：啟用離線 JSON 模式。
- `DATAMOCK_DIR`：可留空。系統會自動尋找 `/datamock`（容器）或 `<repo>/datamock`（本機）。
- 若使用 `SEED_PASSWORD_STRATEGY=username`，可不填 `SEED_DEFAULT_PASSWORD`。

---

## 3. 啟動前驗證（必跑）

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
python -m seeds.validate_datamock
```

預期：
- 成功時輸出 `Datamock validation passed`
- 失敗時列出缺欄位/關聯錯誤並以 non-zero exit 結束

---

## 4. 後端啟動（本機）

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
python -m alembic upgrade head
SEED_PASSWORD_STRATEGY=username python -m seeds.seed_if_empty
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

---

## 5. 前端啟動（本機）

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
VITE_API_URL=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 4173
```

---

## 6. 快速驗收

### 6.1 API 健康檢查
```bash
curl -fsS http://127.0.0.1:8000/health
```

### 6.2 關鍵 API smoke
```bash
curl -fsS http://127.0.0.1:8000/dashboard/stats
curl -fsS http://127.0.0.1:8000/patients
```

### 6.3 自動化測試
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run typecheck
npm run build
npm run test:e2e -- --project=chromium --grep "@critical|@t27-extended"

cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
./.venv312/bin/pytest tests/test_api -q
```

E2E 說明：
- `npm run test:e2e` 為受控模式：會自動啟動隔離埠 backend/frontend，避免外部程序衝突。
- 若你已手動啟動服務且要直接沿用，使用：
```bash
E2E_MANAGED_SERVERS=0 npm run test:e2e -- --project=chromium
```

---

## 7. Docker Compose 模式

`backend/docker-compose.yml` 已包含：
1. `python -m seeds.validate_datamock`
2. `python -m seeds.seed_if_empty`
3. `uvicorn app.main:app`

預設（DB mode）：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
docker compose -p chaticu up --build
```

離線 JSON mode（明確 opt-in）：

```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
docker compose -p chaticu-offline -f docker-compose.yml -f docker-compose.offline.yml up --build
```

說明：
- `-p` 會隔離 compose 專案，避免與其他專案共用 network/volume 命名。
- `docker-compose.offline.yml` 僅覆蓋 `DATA_SOURCE_MODE=json`，不影響預設 db mode。

---

## 8. 常見問題

1. `datamock directory not found`  
原因：找不到 `/datamock` 或 repo 內 `datamock/`。  
處理：設定 `DATAMOCK_DIR=/your/path/to/datamock`。

2. `SEED_DEFAULT_PASSWORD environment variable is required`  
原因：使用 `SEED_PASSWORD_STRATEGY=default` 卻未給密碼。  
處理：改用 `SEED_PASSWORD_STRATEGY=username` 或補 `SEED_DEFAULT_PASSWORD`。

3. 前端顯示網路錯誤  
先檢查：
```bash
curl -i http://127.0.0.1:8000/health
```
再確認 `VITE_API_URL` 與 CORS 設定一致。

4. 需要追查單次請求（request_id/trace_id）  
```bash
curl -i \
  -H "X-Request-ID: runbook_req_001" \
  -H "X-Trace-ID: runbook_trace_001" \
  http://127.0.0.1:8000/health
```
預期 response header 會回傳相同 `X-Request-ID` / `X-Trace-ID`，可用於前後端對齊追查。

5. 懷疑埠衝突導致無法連線  
```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:4173 -sTCP:LISTEN
```
若已有其他程序占用，先關閉占用程序或改用其他埠再啟動。

若要完全避開衝突，直接跑受控 E2E（自動使用隔離埠）：
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run test:e2e -- --project=chromium --workers=1
```
