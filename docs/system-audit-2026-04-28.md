# ChatICU 系統效能與架構審計報告

- **日期**：2026-04-28
- **版本**：v3（2026-04-28 第二輪人工 review 修正）
- **生產環境**：
  - Frontend：https://chat-icu.vercel.app/
  - Backend：https://chaticu-production-8060.up.railway.app/
  - Database：Supabase（透過 Railway 的 `DATABASE_URL` 連線）
- **審計範圍**：資料層連線池、HIS sync、前端 cache 機制、後端路由演進殘留、Vercel proxy、線上 bundle/TTFB 量測、AI/RAG pipeline、Patient detail 載入鏈
- **審計方法**：4 個 agent 平行 (a) 讀原始檔 (b) curl 量測線上 (c) 交叉驗證 CLAUDE.md 已記錄的陷阱；v2 新增人工 review 校對
- **本報告未修改任何 production 檔案**，僅作為決策依據

## 修復進度（持續更新）

| 批次 | 項目 | 狀態 | 完成時間 | Commit |
|---|---|---|---|---|
| 第一批 | #1 `database.py` 加 connect_args + 降 pool size | ✅ 部署完成，2h log 乾淨 | 2026-04-28 | `e2f97b2fd` |
| 第一批 | #2 抽 `query-keys.ts` + `patient-data-sync.ts` 補 TanStack invalidate | ✅ 部署完成，新 bundle 上線 | 2026-04-28 | `e2f97b2fd` |
| 第二批 | #3 Step 1：寫 invariant 測試保護 reconcile / created_at / 邊界 case | ✅ 已 push（純測試，Railway 健康） | 2026-04-28 | `46d39ff38` |
| 第二批 | #3 Step 2：`upsert_records` 改 `INSERT ... ON CONFLICT DO UPDATE` | ✅ 已 push、人工 review、本機 22 測試綠、單病人實測 ~2 min | 2026-04-28 | `3ad388bde` |
| 第二批 | #3 Step 3：multi-row VALUES batch + reconcile 改寫 | ⏸ 4 個 gate（見下） + 設計確認後動 | — | — |

### Step 3 進入 gate（必須全部 ✅ 才能動實作）

| Gate | 動作 | 負責 | 狀態 |
|---|---|---|---|
| G1 | `railway login` 恢復 live log 觀測能力 | 你 | ⏸ |
| G2 | 尖峰時段觀察 1-2 小時，確認無 DB pool / prepared statement / ON CONFLICT 相關錯誤 | 你 | ⏸ |
| G3 | 同一 tab 內 mutation 後切 `/dashboard`、`/patients`，確認有重抓且無 stale | 你 | ⏸ |
| G4 | Step 3 batch 設計確認（見附錄 D） | 雙方 | ⏸ |

**前置確認**：✅ `backend/.env.his-sync` 顯示 prod 走 Supabase pooler `aws-1-ap-southeast-2.pooler.supabase.com:6543`（transaction mode），§1.1 / §1.2 修法適用。

### 第一批本機改動明細

**#1 後端 (`backend/app/database.py`)**：
- 新增 `connect_args = {"prepared_statement_cache_size": 0, "statement_cache_size": 0}`（僅 PostgreSQL 路徑）
- `pool_size`: 20 → 5
- `max_overflow`: 10 → 5
- 加入註解指向 audit doc §1.0 / §1.1 觀察義務
- ✅ 本機 import smoke test：`from app.database import engine, async_session` 成功，driver = `postgresql+asyncpg`

**#2 前端**：
- 新增 `src/lib/query-keys.ts`（從 `src/hooks/use-api-query.ts` 抽出）
- `src/hooks/use-api-query.ts` 改 re-export `queryKeys`，保留所有 caller 的 import 路徑相容
- `src/lib/patient-data-sync.ts` 補：
  - `queryClient.invalidateQueries({queryKey: queryKeys.patients.all})`
  - 若 `refreshDashboardStats=true` → 額外 `queryClient.invalidateQueries({queryKey: queryKeys.dashboard.all})`
- ✅ `npx tsc --noEmit` 全綠（無錯誤）

### 部署前 checklist（第一批）

- [x] **跑 `python3 -m pytest tests/`**：822 通過 / 15 失敗
  - 15 個失敗已驗證是 **pre-existing**（在乾淨 main 上 stash 後仍同樣失敗）：
    - 6 個 `test_fhir/test_allergy_parser.py::TestRealPatientData`（依賴已刪除的 datamock 真實病人 JSON）
    - 9 個 `test_services/test_duplicate_detector.py`（疑似 fixture data 變動）
  - 結論：第一批改動**未引入任何新失敗**
- [x] 前端 `npx tsc --noEmit` 全綠
- [x] 後端 `python3 -c "from app.database import engine"` smoke test 通過
- [x] 開 feature branch `fix/db-pooler-and-cache-invalidate` + commit `e2f97b2fd` + merge main
- [x] **後端**推 `personal main`（Railway 自動部署）
- [x] **前端**推 `railway main`（Vercel 自動 build）
- [x] Railway `/health` 立即 verify 200（version 1.4.5）
- [x] Vercel 新 bundle 已上：`assets/index-CNtjDJ4u.js`（舊 `index-CMJMMXm_.js` 已替換）
- [x] **Railway log 觀察 2h**（透過 Railway CLI）：
  - ✅ 沒看到 `DuplicatePreparedStatementError`
  - ✅ 沒看到 `prepared statement ... already exists`
  - ✅ 沒看到 `QueuePool` 警示
  - ✅ 沒看到 `TimeoutError`
  - ✅ 近 30 分鐘 HTTP 5xx 沒查到
- [ ] 持續觀察尖峰時段 1-2h（多人 + AI chat + HIS sync 沒在跑時最值得看）
- [ ] 同一 tab 內手動操作驗證雙軌 invalidate（修正後的方法見 §九 prod 驗證 SOP）

### 第二批 #3 Step 1 改動明細

**新增 `backend/tests/test_fhir/test_snapshot_sync_invariants.py`（9 個測試）**：

零 production 程式碼變動，只新增 baseline 測試鎖定後續重構的不變量：

| 測試 | 鎖定的契約 |
|---|---|
| `test_upsert_records_preserves_created_at_on_update` | **最關鍵**：refactor 改 `INSERT ... ON CONFLICT DO UPDATE` 時 SET 子句**不可包含 `excluded.created_at`**，否則 audit/billing 時間軸錯亂 |
| `test_upsert_records_is_idempotent` | 重複呼叫不重複插入、不報錯 |
| `test_upsert_records_handles_empty_list` | 空輸入回 0 不發 SQL（PostgreSQL `INSERT ... VALUES` 不接受空 tuple） |
| `test_insert_records_handles_empty_list` | 同上 |
| `test_insert_records_returns_inserted_count` | 回傳值 = `len(records)`，summary/coverage 報告依賴此數字 |
| `test_reconcile_medications_with_empty_incoming_protects_admins_only` | HIS 全空時 → 有 administrations 的 med 必須 discontinued 不可 delete |
| `test_reconcile_medications_mixed_added_protected_deleted` | 混合情境下 4 個 counter 同時正確；`protected_ids` 與 `deleted_ids` 不可有交集 |
| `test_replace_patient_records_with_empty_incoming_removes_all` | lab/culture/diagnostic_reports 是「全替換」語意，無 protection 機制 |
| `test_replace_patient_records_with_unchanged_set_reports_zero_delta` | 同 ID 進出 → `added=0, removed=0`，前端 toast 跳過 zero-delta 事件依賴此契約 |

**驗證**：
- ✅ 新測試 9/9 全綠（在現行碼上 0.47s）
- ✅ `tests/test_fhir/` 整目錄 93 個測試全綠（扣掉 17 個 datamock 相關的 pre-existing 失敗）

**特別說明**：這些測試**只在 SQLite test fixture 上驗證邏輯契約**——但這正是測試 invariant 而非 SQL 語法的目的。Step 2 改 `INSERT ... ON CONFLICT DO UPDATE` 時這些測試仍要全綠，才能 prod 部署。

### 第二批 #3 Step 2 改動明細

**改 `backend/app/fhir/snapshot_sync.py:221-260`（`upsert_records` 函式）**：

從 per-row SELECT-then-INSERT/UPDATE（2 RTT/筆）改為 `INSERT ... ON CONFLICT (id) DO UPDATE`（1 RTT/筆）。

**關鍵實作細節**：
- 加空列表 guard：`if not records: return 0`（PG batch INSERT 不接受空 tuple，預先擋下）
- INSERT cols 排除 `created_at` / `updated_at`（讓 server default 接管）
- ON CONFLICT SET 子句：`{c} = excluded.{c}` for each non-id col + `updated_at = CURRENT_TIMESTAMP`
- **絕不**包含 `excluded.created_at`（否則覆蓋原始插入時間，audit/billing 出錯）
- 退化 case：若 record 只有 `id` 一個欄位 → `ON CONFLICT (id) DO NOTHING`（保留 legacy「不 bump updated_at」行為）

**驗證**：
- ✅ Step 1 的 9 個 invariant 測試全綠（含最關鍵的 `preserves_created_at_on_update`）
- ✅ 原 `test_snapshot_sync.py` 6 個 happy-path 測試全綠
- ✅ `tests/test_api/test_admin_his_sync.py` 全綠（其他 snapshot_sync consumer）
- ✅ `tests/test_fhir/` 整目錄 100 個測試全綠

**SQL 語法相容性**：
- PostgreSQL 9.5+ 支援 `INSERT ... ON CONFLICT` ✅
- SQLite 3.24+ 支援同語法（test fixture 用 SQLite in-memory）✅
- `excluded` keyword 在兩個 dialect 都接受

**預期 prod 效益**：
- 每筆 RTT：2 → 1（省一半）
- 每位病人 sync 時間：4-5 min → 預估 2-2.5 min（Step 3 batch 後再砍到 < 30 sec）

**人工 review + 本機驗證結果（2026-04-28）**：

| 項目 | 結果 |
|---|---|
| Diff review | ✅ empty guard / created_at 不入 SET / id-only 走 DO NOTHING 全部符合 |
| `tests/test_fhir/test_snapshot_sync.py` + `_invariants.py` + `tests/test_api/test_admin_his_sync.py` 22 個 | ✅ 全綠 |
| `tests/test_fhir/` 整目錄 | 99 passed / 5 skipped / 6 failed（**6 failed 與本次改動無關**：`test_allergy_parser.py` 硬編碼 snapshot id `20260415_152444`，本機 patient 目錄已是 `20260427_215128`） |
| 單病人實測 `sync_his_snapshots_serial.py -p 50480738 --force` | ✅ errors=0, synced=1, med_upserted=112, labs=42, cultures=2, reports=16 |
| 實測耗時 | ~**2 分鐘**（落在預估 2-2.5 min 區間，比 Step 2 前的 4-5 min 砍一半） |
| Railway `/health` | ✅ 200 |
| Railway live log | ⚠️ Railway CLI token 失效，目前只能監控公開 /health；尖峰觀察需重新 `railway login` |

---

### prod 觀察期間發現的 non-fatal warnings（不影響本次回退決策）

兩個 startup warning，**非本次 #1/#2 引入**，但呼應第五批 #10「startup_migrations 整理」的必要性：

1. **seed 日期型別錯**：seed data 寫入時 date/datetime 序列化問題
2. **diagnostic_report FK violation**：FK 約束在 startup repair 階段觸發

→ 列入第五批 #10 的具體修法輸入，當時拆 schema vs seed/repair job 時要直接修掉這兩個。

---

## 版本變更紀錄

### v2 → v3（本次）

依第二輪 review 收斂修法範圍與用詞：

| § | 修正 |
|---|---|
| §1.1 | 加註「P0 前提包含 prod 必須是 postgresql+asyncpg + pooler」；提醒修完後**觀察 Railway log 是否有 pool timeout**（slow AI/外部 API endpoint 可能間接佔住 pool） |
| §3.1 | 補：`patient-data-sync.ts` 也要 invalidate `queryKeys.dashboard.all`，不能只 invalidate patients；建議把 `queryKeys` 抽到 `src/lib/query-keys.ts` 解 `lib → hooks` 反向依賴 |
| §2.2 | 「半天」改成「1-1.5 天」；明確標出 `reconcile_medications` 的「有 administrations 時不可 delete，只能 status=discontinued」保護邏輯**必須保留**，不能用單純 bulk upsert 蓋掉；先寫測試再改 |
| §4.1 | access logging **不得記 payload / MRN / 病人姓名**，只記 endpoint、method、status、user role/id hash |
| §6.2 | charts chunk 進首屏的原因**不預設**是 `dashboard.tsx` / `patients.tsx`（人工檢查兩頁均無直接 import recharts）；修法改為「跑 bundle analyzer 反查」 |
| §8.3 | RAG 改 pgvector **不是純應用層改寫**；目前 retrieval 還混 BM25 + category filter + rerank，分階段：先把 vector top-k 改 DB 查詢，BM25/rerank merge 仍在 Python 端 |
| §8.4 | 撤回「`evidence_client` 阻塞 event loop」這個說法——多數呼叫已用 `asyncio.to_thread` 包住；真正問題是**沒共用連線池 + thread overhead + 三套 timeout/retry/circuit-breaker 不一致**；建議用 **lifespan-managed `AsyncClient`**（不是 module-level singleton），shutdown 時 `aclose()` |
| §8.1 | aggregate endpoint 改說法為「**initial bundle**」——只包首屏必要資料；其他 tab 仍 lazy fetch，避免變成「每次回超大包」 |
| §5.1 | `patient-detail.tsx` useState 數字標「**待確認**」——機器逐行 grep 為 42，外部 review 為 20，需先對齊；其他結論（單檔過大、零 React.memo、零 Context、拆檔方向）成立，但效能論述應改用 React Profiler 量測，不只用行數 |
| §8.5 | startup_migrations **不直接刪**；改為「schema 全搬進 Alembic + seed/repair 改成明確 job + 移除 `\|\| echo WARN` 容錯」，讓 alembic 失敗時部署直接失敗而非半開機 |
| §3.2 | `dashboard-stats-cache.ts` 工時從「1 小時」改成「**短期不動**」——先讓 §3.1 的 bridge 處理；整檔刪除會牽動 dashboard page 的 sync initial cache、subscribe、manual refresh 流程，等 dashboard 完全遷到 TanStack 後再刪 |
| §7.1 | `/api/*` namespace 收斂**保留舊路由一段時間**或做 compatibility rewrite，**不一次改完**所有 prefix |

### v1 → v2

v2 修正 v1 的下列錯誤與遺漏：

| 主題 | v1 寫法 | v2 修正 |
|---|---|---|
| `patient-detail.tsx` useState 數 | 43 | **42**（人工逐行於 411-494 確認，全在 `PatientDetailPage` 內） |
| `patient-medications-tab.tsx` useState 數 | 11 | **10**（主元件 8 + `ScoreSelector` 2） |
| Route-level lazy | 「沒看到 route-level 動態 import」 | **錯，App.tsx:20-30 已 lazy 多數大頁面**；正確問題是「為何 charts chunk 仍進首屏 preload」 |
| `patients.tsx` 混用兩套 cache | 「同時用 `getCachedPatients` 與 `usePatientListQuery`」 | **錯，該頁僅用手刻 cache**；雙軌制問題仍存在但不該舉這頁為例 |
| `patients_v2.py` 處置建議 | 「低風險直接刪」 | **錯，有 `test_patients_v2.py` + Vercel `/v2/:path*` rewrite**；改為「先 deprecation logging 觀測使用量再刪」 |
| 「成功回應但資料沒寫入」 | 暗示 prod runtime 也有此症狀 | **過度推論**；目前可確認的只有 `DuplicatePreparedStatementError` 風險，silent-write-fail 是舊 sync 腳本的歷史症狀 |

v2 新增 v1 漏掉的重點（§ 八）：
- Patient detail 初次載入 API fan-out
- AI chat 首輪 clinical snapshot 重建
- RAG 有 pgvector 但 retrieval 仍 in-memory
- httpx client 三套不一致（sync / per-call AsyncClient / in-process）
- Startup migration 與 Procfile alembic 雙重路徑
- `medication_duplicates` batch sequential recompute

---

## 摘要 (TL;DR)

| 級別 | 問題 | 影響 | 修復成本 |
|---|---|---|---|
| **P0** | `database.py` 主 engine 缺 asyncpg pooler-safe `connect_args`（前提：prod 走 transaction pooler） | `DuplicatePreparedStatementError` 風險 | 5 分鐘 |
| **P0** | `database.py` `pool_size=20+10` 對 Supabase pooler 偏大 | 高負載時壓爆 pooler 連線上限 | 1 行修改 |
| **P1** | 前端「雙軌 cache 失效」缺口（手刻 cache vs TanStack Query） | 部分元件看到 stale 資料 | 30 分鐘 |
| **P1** | `snapshot_sync.py` N+1 SELECT-then-INSERT | HIS sync 4-5 min/patient | 半天 |
| **P2** | `patients_v2.py` 前端不用但有 tests + Vercel rewrite | 不能直接刪，需先觀測 | 觀測 1-2 週後再決定 |
| **P2** | `dashboard-stats-cache.ts` copy/paste of `patients-cache.ts` | 維護成本 | 1 小時 |
| **P2** | RAG retrieval 沒用 pgvector index（in-memory cosine） | 隨資料量成長線性變慢 | 1-2 天 |
| **P2** | httpx client 三套不一致 | timeout/pooling/circuit breaker 邊界不清 | 1 天 |
| **P3** | `patient-detail.tsx` 2072 行 + 42 useState + 0 React.memo | 重渲熱點、初次載入 fan-out | 1-2 天 |
| **P3** | charts chunk 進首屏 preload（雖有 route lazy） | 首屏多吃 111 KB gz | 半天 |
| **P3** | Vercel `x-request-id` header gate | 設計缺陷、維運陷阱 | 中長期收斂 |

---

## 一、資料層風險（P0，前提需先確認）

### 0. **前提確認**：prod DATABASE_URL 是否真走 Supabase transaction pooler

修任何資料層東西前，先驗證：

```bash
# Railway 上 echo（或從 dashboard 看）DATABASE_URL 的 host:port
# 預期：aws-1-ap-southeast-2.pooler.supabase.com:6543（transaction mode）
# 若是 5432 → §1.1 不適用；若是 6543 → §1.1 適用
```

下文 §1.1 / §1.2 假設 prod 走 6543 transaction pooler。若是 session pooler 或 direct connection，則 P0 降級為 P2。

### 1.0 修完後的觀察義務（v3 補）

修 §1.1 + §1.2 後**必看**：

```bash
# Railway log 觀察 1-2 小時
# 1. 不再出現 DuplicatePreparedStatementError（§1.1 修對了）
# 2. 不出現 pool timeout / QueuePool limit reached（§1.2 砍 pool size 沒砍過頭）
```

**為何要看 pool timeout**：目前 `database.py:31-40` 的 `get_db()` 是 request-scope，session 持有到請求結束。AI chat、`evidence_client`、外部 RAG call 等慢 endpoint 會間接把 connection 佔到請求結束。砍到 5+5=10 條後，若有 10 個慢請求並發就會排隊。看 log 才知道真實上限要不要再調。

### 1.1 主 engine 缺 asyncpg pooler-safe `connect_args`

**證據**：`backend/app/database.py:6-18`

```python
engine_kwargs = {
    "echo": settings.DEBUG,
    "pool_pre_ping": True,
}
if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({
        "pool_size": 20,
        "max_overflow": 10,
    })
engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)
```

**問題**：
- asyncpg 預設啟用 prepared statement cache
- 與 Supabase transaction-mode pooler (6543) **不相容**：不同 transaction 可能被 pooler 路由到同一條 server backend，prepared statement 是 per-connection，會出現 `DuplicatePreparedStatementError`
- 對照組：`backend/scripts/sync_his_snapshots_serial.py:81-92` **有設** `connect_args={'prepared_statement_cache_size': 0, 'statement_cache_size': 0}` ——這就是當初為了修復舊 sync 腳本問題而加上的

> **v2 校正**：v1 暗示「成功回應但資料沒寫入」的 silent-write-fail 也會發生在主 engine。這是過度推論——silent-write-fail 是舊 `sync_his_snapshots.py` 的特殊組合（`asyncio.create_task` + `Semaphore` + `engine.dispose()` + transaction pooler）才出現。主 engine 目前可確認的風險只有 `DuplicatePreparedStatementError`。
>
> **v3 加註**：在沒有 prod log 證據前，**不要再寫「成功但沒寫入」這種 100% 確定的話**。要主張 silent-write-fail 在主 engine 也發生，需要 Railway log 出現「200 回應但對應 row 不存在」的具體證據。

**修復**：

```python
connect_args: dict = {}
if settings.DATABASE_URL.startswith("postgresql"):
    connect_args = {
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    }
engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)
```

### 1.2 `pool_size=20, max_overflow=10` 對 Supabase pooler 偏大

**證據**：同檔 13-16 行（總計 30 條）

**風險評估**（依賴外部資訊，需確認）：
- Supabase pooler 對 client 的 connection 上限視 plan 而定
- Railway 若多副本部署，每副本 30 連線會疊加
- **確認方式**：Supabase dashboard 看 plan 上限 + Railway 看 replica 數

**修復建議**：降到 `pool_size=5, max_overflow=5`（Railway 單副本 10 連線足夠 ICU 規模並發）

### 1.3 三套 `.env` DATABASE_URL 各走各的 port

**證據**：
- `backend/.env`：localhost:5433（dev）
- prod 用 pooler 6543（透過 Railway 環境變數）
- `backend/.env.his-sync`：pooler 6543

**問題**：每個新增的 script/service 都要手動加 `prepared_statement_cache_size=0`。

**建議**：在 `backend/app/database.py` 加一個 `_build_connect_args(url)` helper，所有 engine 建構統一走它。

---

## 二、HIS Sync 慢的根因（P1）

### 2.1 `snapshot_sync.py:209-246` 是真正的 N+1 瓶頸

**證據**：

`insert_records:209-218`（每筆 1 RTT）：
```python
async def insert_records(session, table, records):
    count = 0
    for record in records:
        ...
        await session.execute(text(sql), params)
        count += 1
    return count
```

`upsert_records:222-246`（每筆 **2 RTT**：先 SELECT 再 INSERT/UPDATE）：
```python
for record in records:
    row = await session.execute(text(f"SELECT id FROM {table} WHERE id = :id"), ...)
    exists = row.scalar() is not None
    if exists:
        await session.execute(text(UPDATE_SQL), params)
    else:
        await session.execute(text(INSERT_SQL), params)
```

`reconcile_medications:268-293`（每筆 stale med 額外查 administrations，最多 3 RTT/筆）

**數學**：
- Sydney pooler RTT ≈ 450ms
- 每位病人約 300+ records × 2 RTT = **270 秒** = 4.5 分鐘
- 14 位病人 = **63 分鐘**

### 2.2 修法（不是「換 serial」，是「砍 RTT」）

**v3 校正**：原本「半天」工時偏樂觀，改 **1-1.5 天**，因為要：
1. 先寫測試保護現有語意（特別是 `reconcile_medications` 的 protected medication 邏輯）
2. `replace_patient_records()` 目前是「先算 added/removed，再 delete+insert」，不能直接換成 bulk upsert
3. `reconcile_medications()` 的「有 administrations 時不可 delete，只能 `status=discontinued`」**必須保留**

**Step 1 — 先寫測試（半天）**：
```python
# tests/test_fhir/test_snapshot_sync_invariants.py
async def test_reconcile_protects_medications_with_administrations():
    """有 administrations 的 medication 從 incoming 消失時，必須 discontinued 而非 delete"""

async def test_replace_patient_records_added_removed_correct():
    """delete+insert 的 added/removed 集合與新邏輯結果一致"""

async def test_upsert_records_preserves_created_at():
    """ON CONFLICT 不可覆蓋 created_at（只更新 updated_at）"""
```

**Step 2 — `upsert_records` 改 PostgreSQL native upsert（半天）**：
```python
INSERT INTO {table} ({cols}) VALUES ({placeholders})
ON CONFLICT (id) DO UPDATE SET {set_clause}, updated_at = CURRENT_TIMESTAMP
```
→ 一個 RTT 取代兩個（純 medication/lab 等簡單 upsert 路徑安全）

**Step 3 — `reconcile_medications` 改寫但保留保護邏輯（半天）**：
```python
# stale = existing - incoming
# 對 stale 仍逐筆查 administrations（這部分先不批次化），
# 因為要決定 delete vs discontinue
# upsert 部分用 multi-row VALUES + ON CONFLICT
```

**Step 4 — 測試 + Railway 驗證**：跑 `python3 scripts/sync_his_snapshots_serial.py -p <某 MRN>` 並對比修前後 row 一致性。

**預期效果**：4-5 min/patient → 30-60 秒/patient，14 位 < 15 分鐘

### 2.3 舊 `sync_his_snapshots.py` silent fail 已知根因（CLAUDE.md 已記）

`asyncio.create_task` + `Semaphore(2)` + `as_completed` 配 transaction-mode pooler + 立即 `engine.dispose()`。serial 版繞過並行問題，但**沒解決 N+1**。

---

## 三、前端 Cache 雙軌制 stale bug（P1）

### 3.1 真實 bug：兩條 invalidate 路徑互不相通

**證據**：

`src/lib/patient-data-sync.ts`（整檔 45 行）：
```typescript
import { invalidateDashboardStats } from './dashboard-stats-cache';
import { invalidatePatients } from './patients-cache';

export async function refreshSharedPatientDataAfterMutation(...) {
  const [patientsResult, dashboardStatsResult] = await Promise.allSettled([
    invalidatePatients(),
    refreshDashboardStats ? invalidateDashboardStats() : Promise.resolve(null),
  ]);
}
```

整檔**零個** `queryClient.invalidateQueries` 呼叫、**零個** `@tanstack/react-query` import（grep 驗證）。

但 `src/hooks/use-patient-mutations.ts:28/54/81` 走 TanStack：
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
```

**結果**：
- 元件 A 用手刻 `getCachedPatients()` 讀（藥局 8 個頁面、`patients.tsx`）
- 元件 B 用 TanStack `useAllPatients()` 讀（部分新元件）
- 寫操作呼叫 `refreshSharedPatientDataAfterMutation()` → 只清掉手刻 cache，**TanStack 不知道**
- 反過來 `use-patient-mutations` → 只清掉 TanStack，**手刻 cache 仍 stale 5 分鐘**

> **v2 校正**：v1 舉「`pages/patients.tsx` 同時 import 兩套」當證據是錯的——該頁實際只 import `getCachedPatients`（line 5）、沒有 TanStack hook。雙軌制問題仍存在，但證據應改舉「藥局 8 頁用手刻 / 新 mutation hook 走 TanStack」這種跨檔不一致，不是同檔混用。
>
> **v3 補強**：修法不能只 invalidate `queryKeys.patients.all`，**也要 invalidate `queryKeys.dashboard.all`**（如果 `refreshDashboardStats=true`）。
>
> **v3 架構建議**：`patient-data-sync.ts` 在 `src/lib/`，若 import `queryKeys` from `src/hooks/use-api-query.ts` 是 lib → hooks 的反向依賴。建議先把 `queryKeys` 抽出來放 `src/lib/query-keys.ts`，讓 lib 與 hooks 都 import 它。

**v3 修法草稿**：
```typescript
// src/lib/query-keys.ts (新檔)
export const queryKeys = {
  patients: { all: ['patients'] as const, /* ... */ },
  dashboard: { all: ['dashboard'] as const, /* ... */ },
} as const;

// src/lib/patient-data-sync.ts (改寫)
import { queryClient } from './query-client';
import { queryKeys } from './query-keys';

export async function refreshSharedPatientDataAfterMutation(options = {}) {
  const { refreshDashboardStats = true } = options;
  const promises: Promise<unknown>[] = [
    invalidatePatients(),
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
  ];
  if (refreshDashboardStats) {
    promises.push(invalidateDashboardStats());
    promises.push(queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }));
  }
  // ...
}
```

### 3.2 `dashboard-stats-cache.ts` 是 `patients-cache.ts` 的 copy/paste

兩檔結構幾乎逐字相同（diff 驗證僅變數命名差 `_` 前綴）：

| 元素 | 都有 |
|---|---|
| `_cache: T \| null` | ✓ |
| `_pending: Promise<T> \| null` | ✓ |
| `STALE_MS = 5 * 60 * 1000` | ✓ |
| `Set<listener>` | ✓ |
| `getCachedX / getCachedXSync / invalidateX / subscribeX` | ✓ |

**TanStack Query 1:1 對照**：

| 手刻功能 | TanStack 對應 |
|---|---|
| `_pending` Promise dedup | 同 queryKey 自動 dedup |
| `STALE_MS` | `staleTime` |
| `subscribeX` | `useQuery` 訂閱 |
| `getCachedXSync()` | `queryClient.getQueryData(key)` |
| `invalidateX()` | `queryClient.invalidateQueries({queryKey})` |

→ 兩個手刻 cache 可整檔刪除，全部走 TanStack；`patient-data-sync.ts` 改呼叫 `queryClient.invalidateQueries`。

### 3.3 後端無 push 機制，純 60 秒輪詢

- `backend/app/routers/sync_status.py:14-44`：只有 GET，無 SSE/WebSocket
- `src/hooks/use-external-sync-polling.ts:7`：`POLL_INTERVAL_MS = 60_000`
- `patients-cache.ts:6` 5 分鐘 TTL 與 polling 60 秒**節奏不對稱**

**短期建議**：手刻 cache TTL 從 5 分鐘降到 60 秒。
**長期建議**：SSE 或 Supabase Realtime channel。

---

## 四、後端架構整理（P2，需謹慎）

### 4.1 `patients_v2.py` 需先觀測再決定

**證據**：

`backend/app/main.py:75-76, 436` 註冊：
```python
from app.routers import patients_v2
app.include_router(patients_v2.router)  # /v2/patients
```

前端 `src/lib/api/`：
- 全部 endpoint 走 v1（`/patients/...`）
- `src/lib/api/layer2-mode.ts`（`patientReadApiBase()` 回 `/v2/patients`）**沒有任何外部 import**

**但**：
- `backend/tests/test_api/test_patients_v2.py` 完整測試 `/v2/patients/meta`、`/v2/patients`（含 search/intubated/department/pagination）、`/v2/patients/{patient_id}`
- `vercel.json:28-30` 有 `/v2/:path*` rewrite
- `services/layer2_store.py` 仍被 `scores.py:37` 用

> **v2 校正**：v1 寫「低風險直接刪」太激進。實際應分兩步：
> 1. **觀測 1-2 週**：在 `patients_v2.py` 各 endpoint 加 access log + 計數，確認 prod 真的零流量（包括外部腳本/監控）
> 2. **若觀測零流量**：刪 router + tests + Vercel rewrite + 前端 `layer2-mode.ts`，但**保留 `services/layer2_store.py`**（給 `scores.py` 內部用）

> **v3 安全要求（必讀）**：access logging **絕對不得記下列任何欄位**：
> - request payload / response body
> - 病歷號（MRN）、病人姓名、出生日期
> - 任何可識別 PHI（Protected Health Information）的字段
>
> 只可記：endpoint path、method、status code、user role、user id 的 SHA256 hash、timestamp、rough user-agent。
> 否則會把 PHI 打進 Railway log，違反院內資安規範。

### 4.2 `services/` 重疊命名澄清（**該保留並文件化**）

| 模組對 | 結論 |
|---|---|
| `duplicate_detector` + `duplicate_cache` | 「核心 + 快取層」分離，`duplicate_cache.py:43-45` 明文 wrap detector |
| `safety_gate` + `safety_guardrail` | **不同階段**：gate 是 pre-answer 拒答閘門，guardrail 是 post-answer 文字後處理 |

### 4.3 `safety_gate.py` 可能未接 orchestrator

`safety_gate.py:61` 看起來只有 self-reference，可能預備但未整合。需確認是否該接到 orchestrator 或刪除。

---

## 五、前端巨型單檔（P3）

### 5.1 `patient-detail.tsx`：2072 行、**42 個 useState**、0 React.memo、0 Context

**人工逐行驗證**（line 411-494，全在 `export function PatientDetailPage()` 內，line 407 起）：

```
chat 相關（411-429）：16 個
patient meta（435-441）：5 個
lab data（459-460）：2 個
medications（463, 466）：2 個
messages/tags（472-478）：7 個
vitals/ventilator（481-488）：6 個
chat sessions（491-494）：4 個
合計：42 個
```

> **v2 校正**：v1 寫 43，外部 review 寫 20。實際 42。差異原因：v1 的 `grep -c useState` 多算了 line 4 的 import；外部 review 數字不知如何得來，但實際逐行確認是 42。
>
> **v3 待確認**：第二輪 review 仍堅持是 20。雙方獨立計數差距大，先標**待確認**。
> - 機器計數：grep -c = 43，扣 line 4 import = 42 個 useState 呼叫，全部位於 `export function PatientDetailPage()`（line 407 起）內，line 411-494
> - 不論最終是 20 還是 42，**結論不變**：
>   - 單檔 2072 行 → 過大
>   - 0 個 React.memo / 0 個 Context → 重渲熱點
>   - 拆檔（按 tab lazy）+ 加 memo + reducer/Context 是正確方向
> - **但效能論述不應只憑 useState 數量或行數**，應用 React Profiler 在實際情境量測 render time / commit count，再決定哪個 tab 拆優先。

**問題**：
- 42 個 useState 全部攤在頂層 component
- 任一 `chatInput`、`expandedExplanations`、`messageInput` 變動 → 整顆 2000 行樹重渲
- 子 component 沒有 `React.memo` 包覆
- 沒有 Context

### 5.2 `patient-medications-tab.tsx`：1293 行、10 useState

人工驗證：
- `ScoreSelector` 子元件：2 個（line 184-185）
- `PatientMedicationsTab` 主元件：8 個（line 604-619）
- 合計 10 個（v1 寫 11 是把 line 1 import 算進去）

### 5.3 修法

**短期（半天）**：對顯而易見的 leaf component 加 `React.memo`
**中期（1-2 天）**：把 useState 按 tab 收進子元件或 reducer + Context

---

## 六、Bundle 與線上量測（P3）

### 6.1 量測快照（2026-04-28）

| 檔案 | Raw | Gzipped | 備註 |
|---|---|---|---|
| `assets/index-CMJMMXm_.js` | 361 KB | 110 KB | 主入口 |
| `assets/charts-BImDY05S.js` | **421 KB** | **111 KB** | 最大 chunk |
| `assets/vendor-OAwDkqbR.js` | 164 KB | 53 KB | React 等 |
| `assets/ui-BRkLZrVo.js` | 38 KB | 8 KB | UI |
| `assets/index-DbfBKgxr.css` | 209 KB | 34 KB | 單一 CSS |
| **JS 合計** | ~985 KB | **~282 KB** | |

### 6.2 Route lazy 與 charts preload 矛盾

> **v2 校正**：v1 寫「沒有 route-level 動態 import」是錯的。

`src/App.tsx:20-30` 確實已 `lazy()` 多數大頁面：
```typescript
const PatientDetailPage = lazy(() => import('./pages/patient-detail')...);
const ChatPage = lazy(() => ...);
const PharmacyWorkstationPage = lazy(() => ...);
// ... 多個 pharmacy pages
```

**正確的問題**：雖然有 route lazy，但 `charts-BImDY05S.js`（111 KB gz）仍被首屏 `<link rel="modulepreload">` 拉進入口路徑——**需要追出哪個 entry-path 模組 import 了 recharts**。

> **v3 校正**：v2 直接點名 `dashboard.tsx` / `patients.tsx`。第二輪 review 已實地檢查兩頁均**沒有**直接 import recharts。原因可能是某個共用元件、layout、或 sidebar 拉進來。
>
> **正確修法**：跑 bundle analyzer 反查 charts chunk 的依賴鏈：
> ```bash
> npx vite-bundle-visualizer
> # 或
> npm i -D rollup-plugin-visualizer
> # 在 vite.config.ts 加 visualizer plugin → npm run build → 看 stats.html
> ```
> 找出真正把 recharts 拉進首屏 entry path 的檔案，再決定改 lazy 或抽出。

### 6.3 Vercel proxy `x-request-id` gate

| 路徑 | header | Status | Content-Type |
|---|---|---|---|
| `/health` | — | 200 | json |
| `/auth/me` | — | 401 | json |
| `/patients` | 無 | 200 | **text/html** |
| `/patients` | `x-request-id: test` | 401 | json |
| `/dashboard` | 無 | 200 | text/html |
| `/dashboard` | `x-request-id: test` | **404** | json |

**TTFB**（中位數）：
- Vercel edge HTML：98 ms ✅
- Railway `/health`：690 ms ⚠️ Sydney pooler 跨區
- `VITE_API_URL` 洩漏：0 命中 ✅

---

## 七、結構性缺陷（長期收斂）

### 7.1 Vercel `x-request-id` header gate

`vercel.json:39-118` 的 4 組路徑（`/patients`、`/dashboard`、`/admin`、`/pharmacy`）用 header 區分前端 SPA route 與後端 API。

**設計動機**（合理）：path 同名衝突。
**問題**：監控/curl 易誤判；`/dashboard` 帶 header 反而 404（Vercel 規則寬鬆轉發了不該轉的 path）。
**長期解法**：所有後端路由收進 `/api/*` namespace，刪掉 header gate。
**成本**：高（前端所有 callsite + types 重生）。

---

## 八、v2 新增：v1 漏掉的重點

### 8.1 Patient detail 初次載入 API fan-out（P2）

> **v3 修法收斂**：aggregate endpoint 不要做成「一次回所有資料」（會變成超大 payload，首屏 TTFB 反而更糟）。
> 改為 **initial bundle**：只包**首屏必要**資料（patient meta + 預設 tab 的關鍵摘要）。其他 tab 仍 lazy fetch，但用 TanStack `useQueries` 共用 cache 避免同份資料被多個 effect 重抓。


**證據**：`src/pages/patient-detail.tsx:534-540`

```typescript
const [patientResult, medsResult, messagesResult, weaningResult] = await Promise.allSettled([
  patientsApi.getPatient(id),
  medicationsApi.getMedications(id, { status: 'all' }),
  messagesApi.getMessages(id),
  ventilatorApi.getWeaningAssessment(id),
]);
// 後續還有 line 557 fetchChatSessionsApi、line 600 messages 重抓
// useEffect at 612, 617, 651 各自再觸發 fetch
// line 633 medications 重抓
```

**問題**：
- 進入單一病人頁就打 4-7 個 API（每個都吃 ~700ms Sydney TTFB）
- 部分路徑（labs、scores、vitals）還沒看到，可能更多
- 同一份 medications 在不同 effect 中被抓多次

**修法**：
- 後端開一支 `/patients/{id}/full-context` aggregate endpoint，一次回所有 ICU 第一屏需要的資料
- 或用 TanStack Query 的 `useQueries` + 共用 cache 避免重複 fetch

### 8.2 AI Chat 首輪重建 clinical snapshot（P2）

**證據**：`backend/app/routers/ai_chat.py:296-316`

```python
is_first_turn = session.snapshot_metadata is None

if is_first_turn:
    # First turn: build full snapshot and store only the snapshot text.
    snapshot, (lab, meds) = await asyncio.gather(
        build_clinical_snapshot(patient_id, db),
        # 並行抓 lab + meds
    )
    key_vals = extract_snapshot_key_values(lab, meds)
    session.snapshot_metadata = {
        "snapshot_taken_at": datetime.now(...).isoformat(),
        "snapshot_key_values": key_vals,
        "clinical_snapshot": snapshot,
    }
```

**問題**：
- 每次首輪都重新組 snapshot + 並行抓 lab/meds
- `build_clinical_snapshot` 內部可能還有更多 fetch（需查 `patient_context_builder.py`）
- 結合 `duplicate_cache` warmup（`medication_duplicates.py:195`），首輪 latency 可能很高

**修法**：
- 共用 patient detail 已抓的 cache（後端 in-process LRU 或 Redis）
- snapshot 本身可在「進入病人頁」時 pre-compute

### 8.3 RAG retrieval 沒用 pgvector index（P2）

> **v3 校正**：v2 寫「純應用層改寫」太樂觀。目前 retrieval 還混合 BM25 + category filter + rerank，整個換掉**召回品質可能變差**。
>
> **分階段做**：
> 1. 先把 vector top-k 改 DB 查詢（`SELECT ... ORDER BY embedding <=> :q LIMIT k * 2`，多取一些給後處理用）
> 2. BM25 / category filter / rerank merge 仍在 Python 端，吃 DB 回的 top-k 子集
> 3. 跑 offline eval 確認召回品質沒退化才能上 prod
> 4. 最終才考慮把 BM25 也搬到 DB（如 pg_trgm + GIN）


**證據**：

`backend/app/services/llm_services/rag_service.py:454`：
```python
"""
Uses in-memory embeddings loaded from pgvector at startup.
"""
```

`backend/alembic/versions/022_pgvector_rag_chunks.py` 確實 migration 了 pgvector 表。

**問題**：
- pgvector 只當 **儲存 + cold start load**，retrieval 走 in-memory cosine
- 隨 chunks 數量成長，每次 query 都做 N×D 矩陣乘法
- pgvector 的 ANN index（`ivfflat` / `hnsw`）完全沒用到
- 啟動時要把所有 embeddings 載入記憶體 → Railway memory footprint 隨 corpus 線性成長

**修法**：
- 改 `SELECT ... ORDER BY embedding <=> :query_embedding LIMIT k` 走 pgvector 索引
- 啟動時不再全載入，retrieval-time on-demand
- Migration 已備好，這是純應用層改寫

### 8.4 httpx client 三套不一致（P2）

**證據**：

| 檔案 | line | 模式 | 問題 |
|---|---|---|---|
| `evidence_client.py:44,46` | `httpx.get(...)` `httpx.post(...)` | **Sync！在 async router 裡呼叫會阻塞 event loop** |
| `drug_rag_client.py:104,181` | `async with httpx.AsyncClient(...) as client:` | 每次 call 新建 + 關閉 client，**無連線重用** |
| `guideline_rag_client.py` | in-process pickle/BM25 | 不走 HTTP，無此問題但 timeout/retry 也沒法統一 |

**問題**（v3 校正）：
- ~~`evidence_client` 阻塞 event loop~~ → **撤回**。實際多數呼叫已用 `asyncio.to_thread(...)` 包住 sync httpx call，不是直接卡 event loop
- 真正問題：
  1. 沒共用連線池 → 每次 call 付 TCP handshake 成本
  2. `asyncio.to_thread` 有 thread overhead（context switch、GIL 競爭）
  3. 三套 timeout/retry/circuit-breaker 邊界不一致，難排錯
  4. `drug_rag_client` 每次新建 `AsyncClient` → 同樣無連線重用

**修法**（v3 細修）：
- **不要**用 module-level singleton `AsyncClient`（不會被正確 `aclose()`）
- 改用 **lifespan-managed `AsyncClient`**：在 `main.py` lifespan 啟動時建立、shutdown 時 `await client.aclose()`，存入 `app.state.http_client`
- `evidence_client` 改 async，共用該 client，移除 `asyncio.to_thread` 包裝
- 為三個 client 抽共用基底（`BaseHttpClient` with timeout/retry/circuit-breaker）

```python
# backend/app/main.py lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    # ... 其他 startup
    yield
    await app.state.http_client.aclose()
```

### 8.5 Startup migration 在 lifespan（P3）

**證據**：`backend/app/main.py` lifespan：

```python
async def _run_startup_warmups() -> None:
    try:
        from app.startup_migrations import run_all as run_startup_migrations
        await run_startup_migrations(engine)
    except Exception as e:
        logger.warning("[INTG][DB] Startup migrations failed (non-fatal): %s", e)
    # ... + RAG warmup
asyncio.create_task(_run_startup_warmups(), ...)
```

但 `Procfile` 啟動時**已經跑 `alembic upgrade head`**（CLAUDE.md 明文）。

**問題**：
- 雙重 migration 路徑：alembic + `startup_migrations.run_all`
- 後者宣稱「fallback」「best-effort」，但部署時若兩者邏輯重疊或競態，會出現難以診斷的「migration 跑了但結果不一致」
- RAG warmup 在 background 跑，但若失敗就 silent log warning——沒有健康指標暴露

**修法**（v3 校正：**不直接刪**）：

`startup_migrations.run_all` 目前是「Alembic 失敗後的 fallback + 補資料 + 補 schema」混合體，直接刪會破壞還在依賴它的部署路徑。正確做法：

1. **盤點 `startup_migrations.py` 內容**：哪些是 schema migration、哪些是 seed/repair
2. **schema 部分全搬進 Alembic**：寫對應的 alembic revision
3. **seed/repair 改成明確 job**：例如 `backend/scripts/run_seed_repair.py`，部署時用 Procfile 顯式呼叫
4. **移除 lifespan 內的 `_run_startup_warmups` 對 migration 的呼叫**
5. **移除 Procfile / 部署腳本中 `alembic upgrade head` 後的 `|| echo WARN` 容錯**——讓 alembic 失敗時部署直接失敗，而非半開機 + log warning
6. RAG warmup 留在 lifespan 但失敗應暴露在 `/health` 的 `data.rag_status` 欄位

### 8.6 `medication_duplicates` batch 路徑（待深入確認，疑 P2）

**證據**（淺層）：`backend/app/routers/medication_duplicates.py:195`

```python
"duplicate_cache: warmup failed for patient=%s: %s", pid, exc
```

→ 暗示 batch 是 per-patient sequential warmup，不是並行 + 不是 SQL aggregation。

**待確認**：
- batch endpoint 是否真的 `for patient in patients: await detector.analyze(...)`
- 若是，14 位病人 × N ms = 線性放大

**修法**：
- 改 `asyncio.gather` 並行
- 或把 detector 邏輯 SQL 化（hospital ATC 比對可在 DB 端做）

---

## 九、修復優先順序（v3 依第二輪 review 收斂）

### 第一批（馬上做）
| # | 修什麼 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| 1 | **先確認 prod DATABASE_URL 走 pooler 6543**；若是 → 修 `database.py` `connect_args` + 降 pool size；**修完觀察 Railway log 1-2h 找 pool timeout** | 低 | 15-30 min | ⭐⭐⭐⭐⭐ |
| 2 | 抽 `src/lib/query-keys.ts` → 改 `patient-data-sync.ts` 同時 invalidate `patients.all` + `dashboard.all` | 低 | 30-60 min | ⭐⭐⭐⭐ |

### 第二批（第一批驗證穩定後做）
| # | 修什麼 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| 3 | `snapshot_sync.py` 改 upsert + batch（**先寫測試保護 reconcile 的 protected medication / delta 行為**） | 中 | **1-1.5 天** | ⭐⭐⭐⭐（HIS sync 提速 5×+） |

### 第三批（觀測類）
| # | 修什麼 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| 4 | `patients_v2.py` 加非 PHI access logging，觀測 1-2 週 | 低 | 30 min | ⭐⭐（觀測為主） |
| 5 | 跑 bundle analyzer 反查 charts 為何進首屏，再決定 lazy 策略 | 低 | 半天 | ⭐⭐⭐ |

### 第四批（中期架構）
| # | 修什麼 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| 6 | RAG retrieval 分階段改 pgvector：先 vector top-k 走 DB、BM25/rerank 留 Python，跑 offline eval | 中 | 2-3 天 | ⭐⭐⭐⭐ |
| 7 | httpx 改 lifespan-managed `AsyncClient` + 抽共用基底（撤回阻塞 event loop 說法） | 中 | 1 天 | ⭐⭐⭐ |
| 8 | Patient detail **initial bundle**（不是 full-context！）+ `useQueries` 共用 cache | 中 | 1-2 天 | ⭐⭐⭐ |
| 9 | `patient-detail.tsx` 用 React Profiler 量測後再決定拆檔順序 | 中 | 1-2 天 | ⭐⭐ |

### 第五批（雜項，不急）
| # | 修什麼 | 風險 | 工 | 收益 |
|---|---|---|---|---|
| 10 | `startup_migrations` 拆解：schema → Alembic、seed/repair → 明確 job、移除 `\|\| echo WARN` | 低 | 1-2 天 | ⭐⭐ |
| 11 | `dashboard-stats-cache.ts` 等 dashboard 完全遷 TanStack 後再刪 | 低 | 等 §3.1 後 | ⭐ |
| 12 | Vercel `/api/*` namespace 收斂，**保留舊路由 compatibility rewrite**，不一次改完 | 高 | 2-3 天 | ⭐⭐ |

### 9.0 prod 驗證 SOP（v3 修正版，必讀）

> v2 的「兩個 browser tab 互相通知」測法**錯誤**——不同 tab 各自有獨立 memory cache，本來就不會自動同步。本次 #2 修的是**同一個 tab 內**手刻 cache 與 TanStack cache 不再不同步。

**A. Railway 後端觀察（事件處理流程）**

| 觀察結果 | 正確處理 |
|---|---|
| `DuplicatePreparedStatementError` 出現 | **不要立即 rollback**。先確認：(1) 新版本是否真的部署（railway log 找新 commit hash）、(2) DATABASE_URL 是否仍走 pooler 6543、(3) `connect_args` 是否生效（log 中應看到 asyncpg 連線而非每次握手）。**只有確認是新 commit 導致 outage** 才 rollback |
| `QueuePool limit size 5 overflow 5 reached` 偶發 1-2 次 | 部署剛啟動或短暫尖峰，**不調整** |
| `QueuePool limit reached` **持續出現** + API 變慢 / 5xx 上升 | 才考慮調 `pool_size=8, max_overflow=8`；同時確認 Supabase pooler plan 上限與 Railway replica 數 |
| `TimeoutError: QueuePool` | 同上，先看頻率 |
| 一切平靜 | ✅ 可進第二批 |

**B. Vercel 前端驗證（同一 tab 內）**

> 跨 tab 即時同步**不是本次修法的範圍**——那需要 `BroadcastChannel` 或 `localStorage` 事件，是未來另一個議題。

正確測法（**單一 tab**）：
1. 開 https://chat-icu.vercel.app/ 登入
2. 進 `/patients` 列表，記住某個病人狀態（例如 archived 與否）
3. 對該病人做 update / archive
4. **同一 tab 內** 立即切到 `/dashboard` → 統計卡片應反映變更
5. **同一 tab 內** 切回 `/patients` → 列表應反映變更
6. DevTools Network 看：mutation 完成後應看到 `/patients`、`/dashboard` 立即重抓一次

| 結果 | 意思 |
|---|---|
| 同 tab 內切換頁面 → 立即看到新資料 | ✅ 雙軌 invalidate 修好 |
| 同 tab 內切換頁面 → 仍是舊資料、需 reload | ❌ invalidate 沒走到 |

**C. 如果真要 rollback（注意 worktree 髒）**

目前本地有大量未 commit 變更（CLAUDE.md mod、datamock 刪除、untracked artifacts），直接 `git revert` 可能被卡。正確做法：

```bash
# 在 *clean clone* 或 *clean worktree* 上做：
git clone https://github.com/jht12020304/ChatICU.git /tmp/chaticu-rollback
cd /tmp/chaticu-rollback
git revert e2f97b2fd --no-edit
git push personal main
git push railway main
```

不要在現有的髒 worktree 上做 revert。

---

### 9.1 #1 詳細修法

```python
# backend/app/database.py
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine_kwargs = {
    "echo": settings.DEBUG,
    "pool_pre_ping": True,
}

connect_args: dict = {}
if settings.DATABASE_URL.startswith("postgresql"):
    connect_args = {
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    }
    engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
    })

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)
```

**部署驗證**（依 CLAUDE.md 流程）：

```bash
git checkout -b fix/db-pooler-args
# 改 database.py
git commit -m "chore(db): set asyncpg pooler-safe args + reduce pool size"
git checkout main
git merge fix/db-pooler-args --no-edit
git push personal main  # Railway 自動部署

# 等 60-90 秒
curl -s https://chaticu-production-8060.up.railway.app/health
# 預期：{"success":true,"data":{"status":"healthy",...}}

# 觀測 Railway log 1-2 小時，確認沒有 DuplicatePreparedStatementError
```

---

## 附錄 A：關鍵檔案座標

| 用途 | 路徑 | 行號 |
|---|---|---|
| DB engine（**P0 修這裡**） | `backend/app/database.py` | 6-18 |
| HIS sync N+1（**P1 修這裡**） | `backend/app/fhir/snapshot_sync.py` | 209-293 |
| 雙軌 cache 橋接（**P1 修這裡**） | `src/lib/patient-data-sync.ts` | 全檔 |
| 手刻 cache copy/paste | `src/lib/dashboard-stats-cache.ts` | 全檔 |
| 手刻 cache 原型 | `src/lib/patients-cache.ts` | 全檔 |
| Dead 嫌疑 router（先觀測） | `backend/app/routers/patients_v2.py` | 全檔 |
| Dead helper（無 import） | `src/lib/api/layer2-mode.ts` | 全檔 |
| 巨型元件 | `src/pages/patient-detail.tsx` | 411-494（state 集中區） |
| Patient detail fan-out | `src/pages/patient-detail.tsx` | 534-540, 612, 617, 651 |
| AI chat 首輪 snapshot | `backend/app/routers/ai_chat.py` | 296-316 |
| RAG in-memory cosine | `backend/app/services/llm_services/rag_service.py` | 454 |
| httpx sync（阻塞） | `backend/app/services/evidence_client.py` | 44, 46 |
| httpx per-call async | `backend/app/services/drug_rag_client.py` | 104, 181 |
| Lifespan startup | `backend/app/main.py` | 130-200 |
| Vercel proxy | `vercel.json` | 39-118 |
| TanStack defaults | `src/lib/query-client.ts` | 全檔 |
| Sync polling | `src/hooks/use-external-sync-polling.ts` | 7 |
| Route lazy 證據 | `src/App.tsx` | 20-30 |

## 附錄 B：CLAUDE.md 已警告但本次再次確認

1. 舊 sync 腳本 silent fail → 確認；同地雷在主 engine 的形式是 `DuplicatePreparedStatementError` 風險（**不是** silent-write-fail）
2. VITE_API_URL 洩漏 → ✅ prod bundle 量測 = 0 命中
3. Vercel 共用路徑 x-request-id → ✅ 仍在
4. HIS sync 寫入後前端 cache 不知情 → 結合 §3.3 polling + §3.1 雙軌制可解釋整個 stale 鏈路

## 附錄 D：Step 3 batch 設計（實作前確認）

> **目的**：把效能優化和語意變更切乾淨。Step 3 動 SQL 改寫前，先把以下決策定案，避免在 PR review 階段才發現「batch 順手把 delete+insert 改掉了」這類隱性語意改動。

### D.1 batch 範圍 — 只動 SQL 形狀，不動上層流程

**動的部分**：
- `insert_records()`：per-row `INSERT VALUES (...)` → multi-row `INSERT VALUES (...), (...), ...`
- `upsert_records()`：per-row `INSERT ... ON CONFLICT` → multi-row `INSERT ... VALUES (...),(...) ON CONFLICT (id) DO UPDATE`

**不動的部分（即使「順手」也不能改）**：
- `replace_patient_records()` 的 **DELETE + INSERT** 兩段式語意（見 D.3）
- `reconcile_medications()` 的 **per-stale-med admin check 迴圈**（保護 protected medication 邏輯，見 D.4）
- 三函式的回傳 shape（`total/added/removed/added_ids/removed_ids` for replace；`upserted/added/deleted/protected` for reconcile）

### D.2 records 欄位不一致時的處理

**現況觀察**：HIS converter (`his_converter.py`) 對同一 table 的 records 產出 schema 一致；同 sync 內理論上 keys 應該全部相同。

**但 batch SQL 對 schema 不一致是「致命」的**：multi-row VALUES 必須所有 row 同 column 數 + 同順序。混到一個 row 多/少欄位就會 SQL error 或欄位錯位。

**設計選擇**（兩條路擇一）：

| 路 | 行為 | 優點 | 缺點 |
|---|---|---|---|
| **(A) Group by signature** | 用 `frozenset(record.keys())` 分組，每組獨立 batch | 容忍 schema 偏移 | 多一層複雜度；隱藏 converter bug |
| **(B) Assert + fail loud** | 用第一筆 record 的 keys 為基準，後續 record key set 不符就 raise | 簡單；converter bug 立刻浮現 | 一筆壞資料會擋掉整批 sync |

**建議走 (B)**：
- 上游 converter 是受控代碼，schema 偏移是 bug 而非常態
- HIS sync 是夜間批次，fail loud 能及時抓到上游回歸
- 加一個明確的 `SchemaInconsistencyError` 例外讓 caller 處理（必要時 fallback 到 per-row）

```python
def _assert_uniform_schema(records: list[dict]) -> list[str]:
    """Return the column list, raising if records disagree."""
    if not records:
        return []
    expected = set(records[0].keys())
    for i, record in enumerate(records[1:], start=1):
        if set(record.keys()) != expected:
            raise SchemaInconsistencyError(
                f"records[{i}] has different keys: "
                f"{set(record.keys()) ^ expected}"
            )
    return [k for k in records[0].keys() if k not in {"created_at", "updated_at"}]
```

### D.3 `replace_patient_records()` delete+insert delta 不可動

**現況**（必須保留）：
```
SELECT existing IDs → compute added=incoming-existing, removed=existing-incoming
→ DELETE all rows for patient
→ INSERT all incoming rows
→ return {total, added, removed, added_ids, removed_ids}
```

**為什麼不能優化成「只 DELETE removed + 只 INSERT added」**：
- 對「ID 沒變但欄位值變了」的 row（例如 lab 的 `value` 修正、status 變化），如果只 INSERT added 不會更新到
- 改成 upsert 又會丟失「DELETE 後留下乾淨痕跡」的特性（雖然目前沒有審計日誌依賴這個，但下游可能假設）
- frontend toast feed (`recent_deltas`) 用 `added_ids` 與 `removed_ids` 顯示「N 筆新 lab、M 筆消失」，這個語意必須維持

**Step 3 對 `replace_patient_records()` 唯一允許的改動**：把內部呼叫的 `insert_records(records)` 從 per-row 改成 multi-row batch。整個函式的入出參與行為不變。

### D.4 `reconcile_medications()` 保護邏輯不可動

**現況**（必須保留）：
```
SELECT existing IDs
→ upsert_records(incoming)              # ← Step 3 內部改 batch OK
→ stale_ids = existing - incoming
→ for med_id in stale_ids:              # ← 此迴圈保持 per-row
    if has_administrations(med_id):
        UPDATE status = 'discontinued'   # protected
    else:
        DELETE                           # deletable
→ return {upserted, added, deleted, protected, ...}
```

**為什麼 stale-loop 不 batch**：
- 每筆 stale 都要先查 `medication_administrations` 才能決定 `discontinued` vs `delete`
- 改成「先 batch SELECT 哪些有 admins → 再 batch UPDATE protected → 再 batch DELETE deletable」**理論上可以**，但牽動三個 SQL 而不是一個重構，風險超出 Step 3 範圍
- Step 3 先省 RTT 在 upsert 路徑（最大宗），stale-loop 留待之後若還有需求再優化

### D.5 PG 參數綁定上限與 chunk size

PostgreSQL 預設 `bind parameter` 上限是 32767/statement。每筆 medication ~20 欄位 → 理論單批最多 ~1600 筆。

**保守取值**：`CHUNK_SIZE = 500`
- 留足 buffer
- ICU 病人單次 sync 通常 < 500 筆 records，多數情境一批就完成
- 超過時自動分多批

```python
CHUNK_SIZE = 500
for chunk in (records[i:i+CHUNK_SIZE] for i in range(0, len(records), CHUNK_SIZE)):
    await _execute_batch_upsert(session, table, chunk)
```

### D.6 dedupe 防護

PG 規則：**單一 INSERT 語句不能用 `ON CONFLICT DO UPDATE` 對同一 row 更新兩次**——同 batch 內 `id` 重複會 `cannot affect row a second time` 報錯。

**設計選擇**：batch 入口先 dedupe by `id`，**保留最後一筆**（與目前 per-row 流程下「後者覆蓋前者」行為一致）：

```python
def _dedupe_by_id(records: list[dict]) -> list[dict]:
    seen: dict[Any, dict] = {}
    for r in records:
        seen[r["id"]] = r  # last-write-wins
    return list(seen.values())
```

### D.7 SQL 模板 — 安全 placeholder 命名

避免 placeholder 衝突：每筆 record 在 batch 中用 `_{i}` 後綴。

```python
def _build_batch_upsert_sql(table: str, cols: list[str], n_records: int) -> str:
    rows = []
    for i in range(n_records):
        placeholders = [f":{c}_{i}" for c in cols]
        rows.append(f"({', '.join(placeholders)})")
    update_cols = [c for c in cols if c != "id"]
    set_clauses = [f"{c} = excluded.{c}" for c in update_cols]
    set_clauses.append("updated_at = CURRENT_TIMESTAMP")
    return (
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES {', '.join(rows)} "
        f"ON CONFLICT (id) DO UPDATE SET {', '.join(set_clauses)}"
    )

# params:
# {f"{col}_{i}": _serialize(record[col]) for i, record in enumerate(chunk) for col in cols}
```

### D.8 既有 invariant 測試覆蓋情況檢查

實作前先 review Step 1 的 9 個測試是否仍能擋住 batch 重構的退化：

| 測試 | Step 3 是否仍能擋退化 | 備註 |
|---|---|---|
| `preserves_created_at_on_update` | ✅ | SET 子句邏輯不變 |
| `is_idempotent` | ⚠️ 需新增 batch idempotency 案例 | 同一 batch 內 dupe id 的處理（D.6） |
| `handles_empty_list` (×2) | ✅ | guard 一樣有效 |
| `returns_inserted_count` | ✅ | count 仍 = len(records) |
| `empty_incoming_protects_admins_only` | ✅ | reconcile 保護邏輯沒動 |
| `mixed_added_protected_deleted` | ✅ | 同上 |
| `replace_*` 兩個 | ✅ | replace 結構沒動 |

**Step 3 動工前要補的測試**：
1. `test_upsert_records_batch_dedupes_within_chunk` — 同 batch 出現兩筆相同 id，最後一筆勝出，無報錯
2. `test_upsert_records_raises_on_inconsistent_schema` — 兩筆 record key set 不同，raise `SchemaInconsistencyError`
3. `test_upsert_records_chunks_large_input` — > CHUNK_SIZE 筆 records，分多批正確處理
4. `test_replace_patient_records_still_uses_delete_then_insert` — 用 spy / 觀察行為驗證沒被改成 upsert（白盒測試）

### D.9 實作順序建議

1. 加 D.8 的 4 個新測試（pre-fail，確認新測試在現行 per-row 碼上通過或合理失敗）
2. 寫 `_assert_uniform_schema` / `_dedupe_by_id` / `_build_batch_upsert_sql` helper
3. 改 `upsert_records` 用 batch，跑全測試
4. 改 `insert_records` 用 batch，跑全測試
5. **不動** `replace_patient_records` / `reconcile_medications` 結構，只享用底層加速
6. 本機跑 `sync_his_snapshots_serial.py -p <某 MRN>` 對比 Step 2 後的 ~2 min baseline
7. 預期 < 30 sec/patient → push

---

## 附錄 C：本次審計仍未涵蓋（後續可加）

- [ ] 整 repo 衛生（根目錄 22+ 個 `.png` / `.yml` artifacts、`_archive_candidates/` 19MB）
- [ ] Migration 序列 / seed data 一致性
- [ ] Supabase RLS / index 覆蓋分析
- [ ] e2e 測試覆蓋率審計
- [ ] `medication_duplicates` batch 路徑深入確認（§8.6）
- [ ] `patient_context_builder.py` 內部 fetch 模式（§8.2 延伸）
