# 架構修補進度面板

> 配對稽核文件:[`architecture-audit-2026-07-19.md`](architecture-audit-2026-07-19.md)(完整證據與修法)
> 狀態:🔲 未動工 · 🔧 進行中 · ✅ 完成 · ⏸ 擱置(附原因)
> **2026-07-19 晚間:一次工作階段內完成 16/18 條**,每條獨立 commit、feature branch + merge,
> 全程 pytest 836 passed / tsc 0 error / vite build 綠燈。

| # | 條目 | 等級 | 狀態 | Commit / 備註 |
|---|------|------|------|----------------|
| A1 | wrapper 改指 serial sync script(launchd/admin 不再跑禁用舊版);舊 script 寫入模式硬停用;serial 版支援 `--state-file` | P0 | ✅ | `fix(his-sync): repoint all automated sync paths` |
| A2 | Dockerfile `&&`(migration 失敗即部署失敗)+ `/health` 真 ping DB(503 on degraded)+ `/health/live` | P0 | ✅ | `fix(ops): health endpoint pings DB`。**待使用者**:`ALERT_WEBHOOK_URL` 需在 Railway 填一個真實 webhook 才會告警 |
| B1 | pharmacy 5 頁 + dashboard + login + PAD 計算器全數遷移 react-query;刪 `patients-cache.ts`;bridge 改純 react-query | P1 | ✅ | `refactor(frontend): single patient-data layer`(淨 -204 行) |
| B2 | `CamelModel` 基底(schemas/base.py)+ vital-signs 轉換示範;刪 6 個 mw-2 死 schema。其餘 23 個 `*_to_dict` 依「改到哪遷到哪」分批 | P1 | ✅(基建+示範) | `refactor(serialization): CamelModel base` |
| B3 | authz 搬 `app/utils/patient_access.py`(11 個 router 改 import);clinical.py 7 個純 helper 下沉 `services/clinical_support.py`(858→558 行)。Depends 化與 SSE 下沉為後續(需動全部 handler 簽名) | P1 | ✅(主體) | `refactor(backend): patient authz to utils` |
| B4 | `app/db_engine.create_pooled_engine()` 統一 12 處 engine 建構;修 `seed_culture_results.py` 漏 connect_args | P1 | ✅ | `refactor(db): single create_pooled_engine factory` |
| B5 | 通知/團隊聊天 poller 收斂 react-query 共用 key;`/notifications/summary` 不再被雙打 | P1 | ✅ | `refactor(frontend): pollers on shared react-query keys` |
| C1 | 刪 `types.generated.ts`(4,249 行零引用) | P2 | ✅ | `chore(frontend): delete dead types.generated.ts` |
| C2 | sync heartbeat:每次 run(含全 unchanged)寫 `sync_status.details.last_run`,prod 可分辨「有跑沒變」vs「排程沒跑」;2 條回歸測試 | P2 | ✅ | `feat(his-sync): heartbeat on every sync run` |
| C3 | 慣例入 CLAUDE.md(根+backend):資料修補走 seed_repair,不再新增 data-seed migration。歷史 81 個 migration 不動(squash 風險大、無立即價值) | P2 | ✅(慣例) | `docs: codify post-audit conventions` |
| C4 | `scripts/ops/verify_vercel_routes.py`:真實 FastAPI route 表 vs vercel.json 對照,接進 CI backend job(現況 12/12 覆蓋) | P2 | ✅ | `feat(ci): vercel route-parity gate` |
| C5 | staging 環境 | P2 | ⏸ | 純基礎設施決策(需另開 Railway/Supabase 環境與費用決策),程式端無可代勞項 |
| C6 | 交易邊界慣例化:get_db auto-commit 是唯一預設邊界,顯式 commit 僅限 mid-request 持久化並附註解(backend/CLAUDE.md)。既有 26 處顯式 commit 未逐一改寫(多為 SSE 前落盤,語意正確) | P2 | ✅(慣例) | 同 C3 commit |
| D1 | 頁面行數 ratchet gate(`scripts/ops/check_page_sizes.sh` + CI):6 個超標頁凍結現值、其餘 900 行上限。實際拆頁為後續;AI streaming 編排維持既有「刻意 inline」決策(drift 資料點已記錄在稽核文件 D1) | P3 | ✅(gate) | `feat(ci): page-size ratchet gate` |
| D2 | working tree 清理:his_lab_mapping FDP、smoke_test 腳本、lexicomp .md 入庫(大 JSON 移 local/);空殼 service package 刪除;CLAUDE.md server/ 殭屍段落移除;runbook 復活並更新到 `docs/his-sync/` | P3 | ✅ | `chore: land stranded working-tree files` |
| D3 | 舊 sync script 硬停用(僅剩 --dry-run);`import_his_patients.py` 預設 dry-run、寫入需 `--execute` | P3 | ✅ | 併入 A1 commit |
| D4 | flake8 gate 擴及 `backend/scripts/` + `seeds/`(E9/F63/F7/F82,擴前驗證 0 error)。knip/ts-prune 未引入(C1 主死碼已刪,新增依賴留待需要時);前端 unit test 為獨立決策項 | P3 | ✅(主體) | 併入 D1 commit |

## 2026-07-19 深夜:全功能 UI 走測(本機拋棄式棧)

以 Playwright 對本機完整棧(pgvector 容器 + seeds + uvicorn + vite)逐頁走測全部頁面與按鈕互動:
登入、dashboard 編輯儲存、病人詳情 6 tab、團隊訊息發送、AI 串流、7 個藥事頁(含 PAD 計算數學驗證、IV 矩陣)、
3 個 admin 頁、出院頁、深色/英文切換、登出;稽核 log 記錄到每個操作。**抓到並修復 3 條**
(`fix/ui-walkthrough-hotfixes`):

1. **P0** `getAllPatients` limit=200 超過後端 le=100 → 422,B1 後病人列表全掛(既有地雷被 B1 引爆)→ 改真分頁
2. **P0** B5 迴歸:`refresh` closure 不穩定 → 開通知鈴鐺觸發無限 invalidate 風暴(數百請求直到瀏覽器資源耗盡)→ useCallback
3. cosmetic:IV 矩陣 legend div-in-p 巢狀警告 → span

## 2026-07-19 深夜(續):後端 API + AI 管線探測

同一本機棧以 httpx 逐端點探測(27 項核心 API + 3 發真實 LLM 呼叫)。**27/27 PASS**:
auth/health(DB ping)/patients(422 上限驗證)/bootstrap/vital-signs(B2 payload)/labs/meds
(interactionsError 欄位)/scores/通知/團隊訊息/sync-status/dashboard/admin×2/PAD 引擎
(rate=13.0 ml/hr 驗算正確)/重複用藥/藥物庫;AI:chat 串流(delta→done、B14 content+
explanation 分離、sessionId/citations/prefetchRefs、session 持久化、feedback 端點)、
臨床摘要 brief 串流(guardrail 高警訊藥警語、structured、dataFreshness)、polish
grammar_only(1.9s)。F02 Redis fail-closed 也順帶驗證(DEBUG=false 無 Redis 正確拒起)。

**抓到並修復 1 條真 bug**(`fix/audit-status-constraint-violation`):observability 的
citation-fabrication 與 user-assertion-conflict 稽核寫入用 `status='detected'`,違反
`ck_audit_logs_status_valid` → fire-and-forget 下**每一筆都被靜默丟棄**(llm-2 觀察期
至今無資料累積)。改 `degraded` + 新增靜態契約測試(掃全部 audit 呼叫點的 status 字面值
對照 model constraint)。live 驗證兩種稽核列都落地,且 svc-1 學名否定偵測實測命中
(「沒有在用 vancomycin」→ conflict row)。觀察期時鐘實質從 2026-07-19 重新起算。

## 遺留追蹤(不阻塞)

- **A2 待使用者**:Railway 環境變數 `ALERT_WEBHOOK_URL` 填入 Slack/Discord webhook,severe-error 告警才會真的送出(程式路徑已存在且可用)。
- **B2 批次**:✅ **實質完成(20/21)**。batch 4(2026-07-20)收掉 ai_chat session/message、administration、custom-tag、symptom、pharmacy 六件(advice/favorite/error/compat/interaction/soap)。**唯一刻意保留手刻**:`patient_to_dict`——計算欄最密(插管/氣切推導、vent days、hasDNR 非標準別名、參數化日期),schema 化收益薄風險高;新 endpoint 慣例照舊走 CamelModel。
- **B3 後續**:✅ **Depends 化完成(2026-07-20)**——`app/dependencies.py::get_accessible_patient` 取代 13 處手刻 fetch+404+verify(10 個 router);scores.py 的 layer2 fallback 為唯一documented例外;靜態守衛測試禁止 imperative 樣式回流。**SSE 下沉亦完成(2026-07-20)**:`stream_chat_events` → `services/ai_chat/stream_orchestrator.py`、summary/polish 生成器 → `services/clinical_stream.py`;ai_chat.py 1050→793 行、clinical.py 568→407 行,Request 僅作資料依賴。live eval 7/7 驗證。**B3 全部完成。**
- **D1 後續**:6 個凍結頁已拆 1(chat.tsx,2026-07-20 live 驗證發送流一致);**6 頁全部處理**(chat/interactions/workstation/patients/ai-chat 已降至 900 以下;patient-detail 1576→1359,抽 `patient-detail-types.ts` + `PatientDetailHeader` 元件並 live 冒煙驗證 header/tabs/AI 串流)。
  **patient-detail 刻意不強拆到 900**:剩餘 bulk 是 ~360 行 AI chat 串流狀態機(捕獲 ~20 個 state setter),即記憶 [[chat-hooks-retired]] 明示「刻意 inline、勿天真重抽」者;頁面已遠低於 ratchet 上限(現收緊 1600→1360 鎖住改善)。強拆風險 > 收益,依 keep-inline 決策不做。(附帶發現:tsconfig 無 noUnusedLocals + eslint no-unused-vars off,兩者都不抓孤兒 import——前三頁殘留已清並補進 gate。)
- **C5**:staging 決策。
