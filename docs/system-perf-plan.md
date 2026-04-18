# ChatICU 系統效能優化計畫（polish 之外）

日期: 2026-04-18
前情提要: `/api/v1/clinical/polish` 的 P1–P5 已完成（見 `docs/clinical-polish-perf-plan.md`），TTFB 15–23s → <1s 首 token。
範圍: 本文件盤點 **polish 以外** 的系統效能熱點，依 CP 值（改善幅度 ÷ 風險）排序。

---

## 摘要表

| # | 項目 | 檔案/位置 | 預期改善 | 風險 | 實作時間 | 狀態 |
|---|------|----------|---------|------|---------|------|
| 1 | `_get_patient_dict` over-fetch | `backend/app/routers/clinical.py:260-331` | 200–600 ms × 6 endpoints | 低 | 2–3 小時 | ⬜ |
| 2 | team_chat mentions/count 重複查詢 | `backend/app/routers/team_chat.py:46-67` | 50–300 ms | 低 | 1 小時 | ⬜ |
| 3 | 7 個 LLM endpoint 尚未 streaming | `backend/app/routers/clinical.py` 多點 | 5–15 s TTFB | 中 | 1–2 天 | ⬜ |
| 4 | 前端 charts 411KB 過早載入 | `src/components/lab-trend-chart.tsx` 等 | 250–400 ms 首載 | 低 | 1 小時 | ⬜ |
| 5 | `/lab-data/trends` 無窗口預設 | `backend/app/routers/lab_data.py:177-225` | 500 ms–2 s + bandwidth | 低 | 30 分鐘 | ⬜ |
| 6 | medications list 重複建 dict | `backend/app/routers/medications.py:137-200` | 30–100 ms | 極低 | 15 分鐘 | ⬜ |
| 7 | messages list 缺 partial index | `backend/app/routers/messages.py:311-323` | 20–80 ms | 低 | 30 分鐘 | ⬜ |
| 8 | streaming audit log 阻塞 done frame | `backend/app/routers/clinical.py:834-854`, `ai_chat.py:245` | 50–150 ms | 中 | 1 小時 | ⬜ |

---

## H1 — `_get_patient_dict` 只取最新一筆（最高 CP）

**現況**
- `backend/app/routers/clinical.py:260-331` 使用 `selectinload(Patient.lab_data / vital_signs / medications / ventilator_settings)` 把**全部**歷史 row 撈回
- 然後 Python 端 `sorted(...)[0]` 只留最新一筆（lab / vital / ventilator）
- 影響 6 個 endpoint：`/summary` (342)、`/explanation` (379)、`/guideline` (423)、`/decision` (497)、`/polish` (699)、`/polish/stream` (772)
- HIS 導入的病患動輒 100+ lab rows、數十筆 ventilator rows，全部走線後丟棄

**提案**
- 改成三個獨立子查詢 `select(LabData).where(...).order_by(timestamp.desc()).limit(1)`
- 用 `asyncio.gather` 並行執行
- `medications` 現在 Python 端 filter `status == "active"`，push 到 SQL
- 既有索引 `ix_lab_data_patient_ts` 等已足夠（見 `alembic/versions/009_add_composite_indexes.py`）

**預期**
- 每個 clinical endpoint 省 200–600 ms（依病患歷史大小）
- 連帶讓剛優化過的 polish/stream 再省幾百 ms
- payload 大小 & JSON 序列化 也同步減少

**風險**
- 低：邏輯單純，有索引支援
- 要確保 `medications` 的 active 過濾邏輯 1:1 對齊

**檔案清單**
- `backend/app/routers/clinical.py:260-331`

---

## H2 — team_chat mentions/count 改寫為單一 COUNT 查詢

**現況**
- `backend/app/routers/team_chat.py:46-67` 跑了一次 `count(*)` 但**結果從未使用**
- 接著載入所有 unread mentioned messages 到 Python，再用 `sum(1 for m in ... if user.role in m.mentioned_roles)`
- 側邊欄會輪詢這個 endpoint

**提案**
- 刪除無用的第一個 count query
- 把 role 檢查 push 到 SQL：使用 JSONB containment `WHERE mentioned_roles @> :role` 或 `jsonb_path_exists`
- 回 `SELECT COUNT(*) ...` 即可

**預期**
- 省 50–300 ms
- 減輕 DB 負擔（高頻輪詢）

**風險**
- 低：純查詢改寫，無 schema 變更

**檔案清單**
- `backend/app/routers/team_chat.py:46-67`

---

## H3 — 其他 7 個 LLM endpoint 改 streaming

**現況**
- 7 個 endpoint 仍是 `await asyncio.to_thread(call_llm, ...)` 非 streaming：
  - `/summary` (`clinical.py:345`) — clinical_summary，用戶可見
  - `/explanation` (`clinical.py:382`) — patient_explanation，用戶可見
  - `/guideline` (`clinical.py:453`) — guideline_interpretation
  - `/decision` (`clinical.py:527`) — multi_agent_decision（5–15s）
  - `/polish` non-stream (`clinical.py:706`) — 保留相容
  - `/query` (`clinical.py:1154, 1187`) — unified_clinical_query
- 基礎設施已備：`call_llm_stream` + `polish_stream` + `ai_chat.py:159` 已證可行

**提案**
- 比照 `polish_stream` (`clinical.py:794`) 模式：
  1. 切換 `call_llm_stream`
  2. 回傳 `StreamingResponse` (SSE: `delta` / `done` / `error`)
  3. Guardrail + post-process 移到 stream 結束後
  4. 前端 `src/lib/api/ai.ts` 增加對應 streaming 函數
- 優先順序：`/decision` > `/summary` > `/explanation` > 其他

**預期**
- `/decision` / `/summary` TTFB 5–15s → <1s 首 token
- 體感改善量級同 polish

**風險**
- 中：每個 endpoint 都有自己的 `build_*_structured` post-process，需要搬移
- 前端每支對應元件都要改接 stream

**檔案清單**
- `backend/app/routers/clinical.py:345, 382, 453, 527, 706, 1154, 1187`
- `src/lib/api/ai.ts`
- 各對應前端元件

---

## H4 — 前端 charts chunk 延遲載入

**現況**
- `build/assets/charts-R9FNwixW.js` 411 KB（第二大 asset）
- `vite.config.ts:65` 已 `manualChunks: { charts: ['recharts'] }`，但 `lab-trend-chart.tsx`、`score-trend-chart.tsx`、`ui/chart.tsx` 靜態 import recharts
- 打開任何病患都會立即抓這 411 KB

**提案**
- 把 trend chart 元件包 `React.lazy`，在 trend tab 才載入
- 沿用 `App.tsx:19` 與 `pages/patient-detail.tsx` 現有 lazy pattern

**預期**
- 首載省 250–400 ms（慢網路）
- 減少 Vercel CDN 出站流量

**風險**
- 低：已有 pattern

**檔案清單**
- `src/components/lab-trend-chart.tsx`
- `src/components/score-trend-chart.tsx`
- `src/components/ui/chart.tsx` 的 import 鏈

---

## H5 — `/lab-data/trends` 加預設時間窗

**現況**
- `backend/app/routers/lab_data.py:177-225`
- 無 `category` 過濾時 `select(LabData).order_by(timestamp.desc()).limit(2000)` + `lab_to_dict` 每筆約 10 個 JSONB 欄位
- 真實 HIS 病患 ~954 筆 → payload 1–2 MB

**提案**
- 當 `days` 與 `category` 皆未提供時，預設 `days=30`
- 或改用分頁

**預期**
- 首載省 500 ms–2 s
- 帶寬節省可觀

**風險**
- 低：行為變更，但現有前端沒依賴全歷史

**檔案清單**
- `backend/app/routers/lab_data.py:177-225`

---

## H6 — medications list 重複建 dict

**現況**
- `backend/app/routers/medications.py:103-206`
- 迴圈內 `med_to_dict(m)` 建到 `grouped`
- 迴圈外又 `[med_to_dict(m) for m in medications]` 建一次到 `all_meds`
- 1791 筆的病患會序列化兩次

**提案**
- 第一次迴圈時同時 append 到 list，重用 dict

**預期**
- 省 30–100 ms

**風險**
- 極低：純重構

**檔案清單**
- `backend/app/routers/medications.py:137-157, 200`

---

## H7 — messages list partial index

**現況**
- `backend/app/routers/messages.py:311-323` 常用查詢：
  `WHERE patient_id = ? AND reply_to_id IS NULL ORDER BY timestamp DESC`
- 既有 index `ix_patient_messages_patient_ts (patient_id, timestamp)` 對 `IS NULL` filter 效率不佳

**提案**
- 新增 partial index：
  `CREATE INDEX ix_patient_messages_toplevel ON patient_messages (patient_id, timestamp DESC) WHERE reply_to_id IS NULL`
- 新 Alembic migration

**預期**
- 省 20–80 ms（每次開病患）

**風險**
- 低：新增 index，無資料遷移

**檔案清單**
- 新增 `backend/alembic/versions/XXX_messages_toplevel_index.py`

---

## H8 — streaming endpoint audit log 不阻塞 done

**現況**
- `backend/app/routers/clinical.py:834-854`：`await create_audit_log(...)` 跑在 SSE generator 中，然後才 `yield` `done`
- 同樣 pattern in `ai_chat.py:245`：`db.commit()` 在 done 前
- audit log INSERT + flush 30–80 ms 被計入用戶感知延遲

**提案**
- 先 `yield` `done`，用 `asyncio.create_task` 背景寫 audit log
- 背景 task 必須用**新的** DB session（不能用 request-scoped session）
- 接受「abrupt disconnect 時可能漏 audit log」的 tradeoff

**預期**
- 感知延遲省 50–150 ms

**風險**
- 中：需要 fresh session pattern、錯誤處理
- 審計完整性降級（可接受，屬 defense-in-depth）

**檔案清單**
- `backend/app/routers/clinical.py:834-854`
- `backend/app/routers/ai_chat.py:245`

---

## 建議執行順序

1. **H1**（`_get_patient_dict`）— 最大 CP、連動 6 endpoint
2. **H2**（team_chat count）— 15 分鐘 quick win
3. **H6**（medications dup dict）— 15 分鐘 quick win
4. **H5**（lab trends 窗口）— 30 分鐘
5. **H7**（messages partial index）— 30 分鐘 + migration
6. **H4**（charts lazy）— 前端獨立
7. **H8**（audit log fire-and-forget）— 需要驗證
8. **H3**（7 個 LLM endpoint streaming）— 最大工程量，但絕對值最高，分支逐個 ship

---

## To-Do List

### Phase 1 — Quick wins（半天以內可做完）

- [ ] **H2** — 刪除 `team_chat.py:46-67` 無用 `count(*)` query，改 JSONB containment count
- [ ] **H6** — `medications.py` 在迴圈內重用 `med_to_dict`，移除重複序列化
- [ ] **H5** — `lab_data.py:177-225` 無 `category` + 無 `days` 時預設 `days=30`
- [ ] Commit `perf(api): quick wins H2/H5/H6` + push `personal` + push `railway`
- [ ] Railway `/health` 驗證 + smoke test

### Phase 2 — Patient fetch 重寫（H1）

- [ ] 讀 `clinical.py:260-331` 並列出每個呼叫點的欄位需求
- [ ] 寫三個新 helper：`_latest_lab(db, pid)`, `_latest_vital(db, pid)`, `_latest_ventilator(db, pid)` 各用 `.order_by().limit(1)`
- [ ] `medications` query push `WHERE status = 'active'` 到 SQL
- [ ] 用 `asyncio.gather` 並行跑四個子查詢
- [ ] 本機跑 `backend/tests/` 驗證既有 clinical endpoint 回應 shape 不變
- [ ] Playwright smoke test：`/summary`、`/decision`、`/polish/stream` 各跑一次
- [ ] Commit `perf(clinical): fetch only latest lab/vital/ventilator`
- [ ] 量測 TTFB 改善，更新本文件驗收表

### Phase 3 — Index & frontend（H4、H7）

- [ ] H7: `alembic revision -m "messages_toplevel_index"`，加 partial index
- [ ] 本機 `alembic upgrade head` 驗證
- [ ] H4: `lab-trend-chart.tsx`、`score-trend-chart.tsx` 改 `React.lazy`
- [ ] Playwright 驗證 trend tab 仍正常顯示
- [ ] `build/` 檢查 `charts-*.js` 是否只在 trend tab 載入
- [ ] Commit `perf(frontend): lazy-load chart bundle` + `perf(db): messages toplevel partial index`
- [ ] Push `personal` + `railway`，Railway migration 自動跑 `alembic upgrade head`

### Phase 4 — Streaming audit log（H8）

- [ ] 寫 helper `fire_and_forget_audit(action, user_id, details)` 建立獨立 session
- [ ] `polish_stream` yield `done` 後才呼叫 helper
- [ ] `ai_chat.py:245` 同步改寫
- [ ] 本機驗證 audit log 確實寫入
- [ ] Commit `perf(stream): defer audit log to background task`

### Phase 5 — 剩餘 LLM endpoint streaming（H3，逐個 ship）

- [ ] **H3.1** `/decision` — 最高優先、用戶等最久
  - [ ] 後端 `/decision/stream` endpoint（比照 polish_stream 模式）
  - [ ] `src/lib/api/ai.ts` 加 `streamDecision(...)`
  - [ ] 前端呼叫點改 stream
  - [ ] Playwright 驗證
  - [ ] Commit + deploy
- [ ] **H3.2** `/summary`
  - [ ] 後端 + 前端 + verify + commit + deploy
- [ ] **H3.3** `/explanation`
- [ ] **H3.4** `/guideline`
- [ ] **H3.5** `/query` unified
- [ ] `/polish` non-stream 是否保留？（目前當 fallback，評估是否刪除）

### Phase 6 — 驗收與文件

- [ ] Production Playwright probe 跑每個 endpoint，填下方驗收表
- [ ] 更新 `docs/coordination/README.md` 記錄效能改善
- [ ] 若發現新 bottleneck，回到本文件新增項目

---

## 驗收表

| 項目 | 完成日期 | Commit | Before (ms) | After (ms) | 備註 |
|------|---------|--------|-------------|------------|------|
| H1 | | | | | |
| H2 | | | | | |
| H3.1 `/decision` | | | | | |
| H3.2 `/summary` | | | | | |
| H3.3 `/explanation` | | | | | |
| H3.4 `/guideline` | | | | | |
| H3.5 `/query` | | | | | |
| H4 charts lazy | | | | | 量 bundle 大小 + 首載時間 |
| H5 lab trends window | | | | | 量 payload KB |
| H6 medications dup dict | | | | | |
| H7 messages partial index | | | | | `EXPLAIN ANALYZE` before/after |
| H8 audit log 背景 | | | | | |

---

## 不做的事（刻意排除）

- **不改 DB provider**：Supabase 目前夠用
- **不升級 LLM model**：已優化的路徑體感已可接受
- **不加 Redis cache**：目前沒證據需要；先把 DB 查詢改好再評估
- **不重寫 ORM 層**：SQLAlchemy async 表現可接受

---

## 相關檔案索引

| 層 | 檔案 | 關鍵行 |
|----|------|--------|
| 後端 patient fetch | `backend/app/routers/clinical.py` | 260–331 |
| 後端 LLM endpoint | `backend/app/routers/clinical.py` | 345, 382, 453, 527, 706, 1154, 1187 |
| 後端 polish stream 範本 | `backend/app/routers/clinical.py` | 772–854 |
| 後端 ai_chat stream 範本 | `backend/app/routers/ai_chat.py` | 159, 245 |
| 後端 team_chat | `backend/app/routers/team_chat.py` | 46–67 |
| 後端 medications | `backend/app/routers/medications.py` | 103–206 |
| 後端 lab_data | `backend/app/routers/lab_data.py` | 177–225 |
| 後端 messages | `backend/app/routers/messages.py` | 311–323 |
| 前端 chart | `src/components/lab-trend-chart.tsx`、`score-trend-chart.tsx` | — |
| 前端 AI API | `src/lib/api/ai.ts` | — |
| 前端建置 | `vite.config.ts` | 65 (manualChunks) |
| Alembic 索引 | `backend/alembic/versions/009_add_composite_indexes.py` | — |
