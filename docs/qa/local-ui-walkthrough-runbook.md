# 本機全功能 UI 走測 Runbook(2026-07-19 建立)

重大前端重構(資料層、poller、共用 hook)後,tsc/build 綠燈**不代表**互動沒壞——
2026-07-19 的走測就抓到兩條 tsc 抓不到的 P0(422 limit 超限、effect 依賴不穩定 identity
造成的無限請求風暴)。改到這些區域後照本文走一輪。

## 起環境(拋棄式,與 managed e2e 同配方)

```bash
# 1. 容器 DB(本機 homebrew PG 沒有 pgvector,勿直用)
docker rm -f chaticu-uiwalk-db 2>/dev/null
docker run -d --name chaticu-uiwalk-db -e POSTGRES_USER=chaticu \
  -e POSTGRES_PASSWORD=chaticu_password -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55434:5432 pgvector/pgvector:pg16 && sleep 5

# 2. 建 DB + migrate + seed(cwd = backend/;env 同 scripts/e2e/run_managed_e2e.sh)
#    關鍵 env:DATABASE_URL 指 55434、SEED_PASSWORD_STRATEGY=username、
#    JWT_SECRET 任意 32+ 字元、RATE_LIMIT 放寬
#    建 DB 後:.venv312/bin/python -m alembic upgrade head
#              .venv312/bin/python -m seeds.seed_data

# 3. 後端(同一組 env)
.venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 18100

# 4. 前端(repo 根)
VITE_API_URL='http://127.0.0.1:18100' npm run dev -- --host 127.0.0.1 --port 14173 --strictPort
```

登入:`admin` / `admin`(username 密碼策略;nurse/doctor/pharmacist 同理)。
收尾:kill 兩個 server、`docker rm -f chaticu-uiwalk-db`。

## ⚠️ 本機走測的兩顆地雷

1. **總覽頁「偵測新更新 / 全部重抓」絕對不要點**:本機後端的 `/admin/his-sync` 會
   subprocess 跑 `run_his_snapshot_sync.sh`,wrapper source `backend/.env.his-sync`
   → **直連 prod Supabase**。本機測試照樣寫穿正式資料庫。
2. **AI 功能會花真錢**:pydantic-settings 讀 `backend/.env`,裡面是真的 OPENAI_API_KEY。
   AI 問答/臨床摘要/工作站「執行全面評估」都會打 OpenAI——測一兩發可以,別狂按。

## 走測清單(每頁看 console error + 關鍵互動)

- 登入(顯示密碼切換)→ dashboard(搜尋、編輯儲存後卡片即時更新、通知鈴鐺**開啟後觀察
  network 沒有請求風暴**)
- 住院病人(列點擊導航)→ 病人詳情 6 tab(留言板標已讀 badge 即時降、檢驗數據 Vital
  Signs 有數值、用藥 PAD 帶入身高體重)
- 團隊訊息發送、AI 問答一發(看串流+「詳細」展開)
- 藥事 7 頁:每頁**病人下拉有 4 位**(共用 patient list hook 的煙霧信號)+ 各頁主查詢
  (交互 36 對、重複 L1-L4、相容矩陣、劑量計算驗數學)
- admin 3 頁(稽核紀錄應記到你剛才的每個操作)、出院頁空狀態
- 深色/英文切換、登出

## 歷史發現

- 2026-07-19:`getAllPatients` limit=200 → 422(後端 le=100)、B5 `refresh` 不穩定
  identity → 鈴鐺無限 invalidate 風暴、IV legend div-in-p。
  詳見 [`../codebase-health/architecture-fixes-progress.md`](../codebase-health/architecture-fixes-progress.md)。
