# ChatICU 系統架構盤點(2026-07-19)

> 配對進度文件:[`architecture-fixes-progress.md`](architecture-fixes-progress.md)
> 方法:3 個並行探查 agent(後端 / 前端 / 資料流與維運),架構視角、非 bug hunt;
> 已排除 [`codebase-systematic-review-2026-06-03.md`](codebase-systematic-review-2026-06-03.md) 的正確性發現
> 與 2026-07-10 restructure 已處理項目。P0 各條指控由主 agent 親自讀碼二次驗證。
> 排序依「使用者價值優先」:病安/資料完整性 > 每天踩到 > 不做會出事 > cosmetic。

---

## P0 — 資料完整性/病安(立即處理)

### A1. 所有自動化 sync 路徑仍在跑被禁用的舊 async script ⚠️ 已親自驗證
- **證據**:`backend/scripts/run_his_snapshot_sync.sh:25` → `exec "$PYTHON_BIN" -u scripts/sync_his_snapshots.py "$@"`。
  launchd plist(`com.chaticu.his-sync.plist`)的 ProgramArguments 指向這個 wrapper;
  `/admin/his-sync` 端點(`admin_his_sync.py`)subprocess 也跑同一個 wrapper,且其註解(`:41`)仍在解析舊 script 的 summary 格式。
  wrapper 最後修改於 2026-04-17 —— 早於 2026-04-27 發現 silent-fail 的日期,從未被改指到 serial 版。
- **後果**:CLAUDE.md 明令禁用的 `sync_his_snapshots.py`(asyncio.create_task + Semaphore 對 Supabase pooler 會 silent fail、回報 errors=0 但 DB 沒寫入)是**每天 06:00/18:00 排程實際執行的版本**。目前多數 snapshot 因 hash 相同被跳過所以未爆;一旦 snapshot 真的變動,臨床資料會靜默過期。
- **修法**:wrapper 第 25 行改指 `sync_his_snapshots_serial.py`(一行);確認 `admin_his_sync.py` 的 summary 解析與 serial 版輸出格式相容;考慮直接刪除舊 script 斷後路。
- **為何 CI 沒抓到**:flake8/檢查只掃 `app/`,`backend/scripts/` 與 shell wrapper 無任何 gate(見 D4)。

### A2. 壞部署完全隱形:Dockerfile 吞 migration 失敗 + /health 靜態 + 告警未接 ⚠️ 已親自驗證
- **證據**:
  - `backend/Dockerfile`(CMD)`alembic upgrade head || echo 'WARN: migration failed, starting anyway'; uvicorn ...` —— migration 失敗照樣開機;`Procfile` 卻用 `&&`(fatal),兩者行為分歧,且 repo 無 railway.json 指明用哪個。
  - `backend/app/routers/health.py:9-14` 回傳硬編碼 `{"status":"healthy"}`,不碰 DB —— DB 斷線/半套 schema 一樣回 healthy,CLAUDE.md 的部署驗證 `curl /health` 實際驗證不了任何東西。
  - `ALERT_WEBHOOK_URL` 在 `config.py:120` 與 `.env.example:71` 皆為空,`main.py:315-351` 的 severe-error webhook 從未啟用;無 Sentry/OTel(前後端 grep = 0)。前端無全域 `window.onerror`/`unhandledrejection`。
- **後果**:半套 migration + 靜態 health + 無告警三者疊加 = 壞部署零訊號、MTTR 全靠使用者回報。
- **修法**:Dockerfile 改 `&&`;/health 加一句 `SELECT 1`(可另留 /health/live 給容器 liveness);設定 ALERT_WEBHOOK_URL 指向任一 webhook(Slack/Discord)。

---

## P1 — 結構性架構問題(每天在付利息)

### B1. 前端雙資料層:react-query 建好但只有 4 個檔案在用
- `@tanstack/react-query` 已全套接妥(QueryClientProvider、query-keys factory、typed wrappers),但只有 **4 個 page/component 檔**消費;**47 個檔案**仍直接 import `lib/api/*` 手刻 useState/useEffect。
- 病人列表同時活在兩個 cache:react-query(`use-patients.ts`,patients 頁)+ 手刻 singleton `patients-cache.ts`(5 分 TTL;dashboard、login、全部 5 個 pharmacy 頁)。`dashboard.tsx:15,61,81` 一個元件同時讀兩套。
- `patient-data-sync.ts:24-29` 是手動一致性橋:同時 invalidate react-query key + 呼叫 legacy `invalidatePatients()`,漏一邊即分歧;且橋只失效 list/dashboard,**per-patient detail cache 不在範圍** —— HIS sync 改了病人 X 的用藥,停在 X 詳情頁的臨床人員看不到(60s poll 只刷 list)。
- 另有 `pad-drugs-cache.ts`、`team-chat-cache.ts`(chat.tsx 直接改模組全域物件欄位)共三套形狀各異的手刻 cache。
- **修法方向**:pharmacy 5 頁 + dashboard 遷移到 `useAllPatients`,刪 `patients-cache.ts` 與橋;團隊約定新 code 一律 react-query。

### B2. 後端序列化無契約:133 routes 僅 2 個 response_model、24 個手刻 *_to_dict、354 個手打 camelCase key
- 幾乎每個 router 自帶 serializer(`patient_to_dict`、`msg_to_dict`、`med_to_dict`…24 個/25 檔),ORM→camelCase 對映逐欄位重打;無 OpenAPI schema、欄位改名靠 grep。
- 這也解釋了 `types.generated.ts` 為何死掉(見 C1):後端沒有可信的 OpenAPI 可生成。
- **修法方向**:建一個共用 serializer 層或復活 camelCase schema(加 alias_generator),從新 endpoint 與最常改的 router 開始,不必一次全遷。

### B3. Fat routers + authz 住在 router 裡
- routers 共 12,436 行 vs services 8,298 行;44 個 router 只有 8 個 import services。`clinical.py`(858L)~70% 是 service 層工作(LLM SSE 編排、stream JSON parser、guardrail 全在 router);`patients.py` ~60%、`messages.py` ~55%、`ai_chat.py` 內仍有 ~460 行 inline 編排。
- `verify_patient_access`/`normalize_patient_id` 定義在 `app/routers/patients.py:207,213`,被 **11 個 sibling router 反向 import** —— patients.py 成為耦合樞紐;且它是 handler 內 imperative 呼叫而非 `Depends`,**新 handler 忘記呼叫 = 靜默無 authz**。ai_chat 又用另一套 `patient_acl.assert_patient_chat_access`,同一件事兩套機制。
- **修法方向**:先搬 authz 到 `app/dependencies.py` 並改為 Depends(小、高槓桿);router 瘦身從 clinical.py 的 SSE 編排搬進 services 開始。

### B4. 14 處複製貼上的 pooler connect_args,且已出現漏抄 ⚠️ 已親自驗證
- `prepared_statement_cache_size=0, statement_cache_size=0` 散落在 `database.py`、`alembic/env.py` 與 12 個 scripts,無共用 engine factory。
- `backend/scripts/seeds/seed_culture_results.py:188` 建 engine **沒帶 connect_args** —— 對 6543 transaction pooler 正是這組設定要防的 DuplicatePreparedStatementError/silent-drop 類故障。
- **修法**:抽一個 `create_pooled_engine()`(database.py),所有 script 改用;順手修 seed_culture_results。

### B5. Polling 散落:每個登入頁面 4-5 個獨立 poller
- AppLayout 掛 `useExternalSyncPolling`(60s)+ sidebar 的 `useNotificationSummary`(60s)+ `useTeamChatUnread`(60s),NotificationBell 再掛**第二個獨立的** `useNotificationSummary` —— `/notifications/summary` 每 60s 被打兩次、兩個 badge 可短暫不一致;chat 頁再加第 5 個 30s interval。
- 三個 poller hook 各自手刻 visibilitychange/inFlightRef/intervalRef(近乎逐行相同),無 backoff。unread 概念來自兩個重疊端點、兩個獨立 hook,無單一事實來源。
- **修法方向**:收斂到 react-query `refetchInterval` + 共用 query key(基建已存在),自動 dedup 兩個 bell/badge。

---

## P2 — 中期架構風險

### C1. `types.generated.ts` 4,249 行零引用死碼 ⚠️ 已親自驗證(grep 全 repo 0 import)
- openapi-typescript 一次性快照;無 generator 依賴、無 script、無 CI 接線,占 src TS ~9%。**直接刪除即可**,誰誤信它是 source of truth 誰中獎。

### C2. HIS ingestion 單機 SPOF
- `patient/`、launchd 排程、sync state(`.state/`、`.logs/`,gitignored)、以及所有 prod 明文密鑰(`backend/.env` 真 OPENAI_API_KEY + DATABASE_URL)全綁在同一台 Mac。Mac 關機 = 06:00/18:00 排程直接跳過;Railway 端 `/admin/his-sync` 無 `patient/` 目錄即 503,無 server-side 替代路徑;sync 狀態無法從任何遠端觀測。
- 短期至少:coverage/state 寫一份到 DB 或 Supabase storage,讓「上次成功 sync 時間」可從 prod 查到,配 A2 的告警。

### C3. Migration-as-deploy 體質
- 81 個 migration 每次 boot 全鏈執行;19 個是 data-seed/fix(23%),含 035→036→037→038 同一份資料連續四次 seed 的 retry saga;data-seed 不可逆,rollback = 無法回滾資料效果。fresh bootstrap 已有驗收腳本護住(2026-07-10),但趨勢是 boot 時間持續變長。
- 方向:新資料修補走 `scripts/run_seed_repair.py` 而非 migration;可考慮定期 squash 基線。

### C4. Vercel proxy 路由契約 silent fail by design
- `vercel.json` 白名單路由 + `x-request-id` header 條件;新增 top-level 後端路由若忘了同步 vercel.json,前端拿到的是 **200 的 SPA HTML** 而非錯誤;繞過 `api-client.ts` 的 fetch(缺 header)同樣靜默拿到 HTML。
- 方向:e2e 加一條「新 router prefix 必在 vercel.json」的對照檢查,或 API response 統一帶識別 header 由 client 驗證。

### C5. 無 staging;本機可直連 prod DB
- `backend/.env` 放真 Supabase URL,schema/seed 變更只在 CI 臨時 Postgres 與 prod 之間驗證;開發機與 live 臨床 DB 之間沒有隔離層。docker-compose + datamock 的離線模式存在但非預設。

### C6. 交易邊界雙模式
- `get_db()` yield 成功即 auto-commit,但 router 內又有 26 處顯式 `.commit()`(ai_chat 6、team_chat 5…),`messages.py` 21 個 SQL 卻 0 次 commit —— 「這個 request 的 transaction 在哪結束」沒有單一答案。挑一種(建議顯式 commit、拿掉 auto-commit)並文件化。

---

## P3 — 清理與防護(低成本、可順手)

### D1. 巨型頁面:6 頁超過 900 行契約線,4 頁完全沒拆
- patient-detail 1576、workstation 1104、chat 966、patients 954、ai-chat 938、interactions 930。約定存在但無 lint gate。
- AI streaming 編排(streamChatMessage→rAF flush→15 欄 assistantMsg)在 ai-chat 與 patient-detail 各兩份(含 regenerate)共 ~4 份,**且已 drift**:ai-chat 版有 AbortController/onThinking,patient-detail 版沒有。保留 inline 是既有決策,但 drift 是新的資料點,可考慮只抽「streaming 狀態機」一個 hook。
- pharmacy 3 頁(interactions/compatibility/duplicates)有逐位元組相同的病人載入 scaffold → 待抽 `usePharmacyPatientPicker`。

### D2. Working-tree rot(與 A1 複合)
- 未 commit 的**刪除**:`docs/his-sync-schedule-and-manual-trigger.md` —— 這是 launchd 排程與 wrapper 的唯一 runbook(內含 SYNC_ENV_PATH 相對路徑會靜默寫進本機 docker DB 的地雷說明),而排程本身正配置錯誤(A1)。刪它之前 A1 必須先修 + runbook 內容需有去處。
- main 領先 origin **34 commits 未 push**;`reports/lexicomp_xd_candidates_*` 未 commit(reports/ 是 tracked 目錄,非 ignored);`seed_demo_duplicates.py`/`smoke_test_duplicates.py` 未 commit;`his_lab_mapping.py` 修改未 commit。
- 空殼 package:`app/services/data_services/`、`app/services/llm_services/` 只剩 `__pycache__`。
- 根目錄 CLAUDE.md 仍寫「`server/` 為 Dart Frog 參考實作」但 server/ 已不存在;`func/`(115 檔)無任何 app 引用,是否留任需決策。

### D3. 兩套 HIS 匯入腳本並存(fhir-2 的延伸)
- `sync_his_snapshots.py`(舊,禁用)與 `sync_his_snapshots_serial.py` 都還在、都可執行;A1 修完後應封存舊版,`import_his_patients.py`(upsert、不刪舊列)依 2026-06-03 建議降級 dry-run 或改呼叫 sync 核心。

### D4. CI 閘門缺口(正是 A1 漏網的原因)
- flake8/檢查只掃 `backend/app/`,`backend/scripts/` 與 shell wrapper 零 gate;前端無 unit test(只有 tsc + build);orphan gate 只掃 `src/imports/`(剩 1 個檔,trivially pass),真正的死碼(C1)無人看管 —— 建議引入 knip/ts-prune 級別的 unused-file 檢查、flake8 範圍加入 scripts/。

---

## 已驗證的健康面(不用花力氣)

- **後端 package 邊界乾淨**:services 不 import routers(0 hits)、fhir/services 完全解耦、app.llm 是 leaf —— 分層方向全對,問題只是邏輯滯留在 router 層。
- **main.py 橫切關注集中**:exception envelope、SecurityHeaders、CORS/rate-limit 單點。
- **前端 axios client 真正集中**:單一 instance、401 refresh、統一錯誤 toast、trace header。
- **Route-level code-splitting 一致**,重庫皆 lazy;依賴精簡(單一 chart lib、零 date lib)。
- **CI 本體強**:pytest、migration-check on pgvector、e2e-critical in CI、bandit、ZAP DAST、secret-scan。缺口只在 D4 列的邊角。
- **config.py 集中**(~50 settings、fail-closed JWT),app 內僅 1 處良性 os.getenv。
- migration 無外部服務呼叫(verified);datamock/ 是活的 CI fixture 非 rot;src/imports/ 乾淨。

---

*產出:2026-07-19 · 3 並行探查 agent + 主 agent 對 P0/關鍵指控逐條讀碼複核。*
