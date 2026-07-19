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

## 遺留追蹤(不阻塞)

- **A2 待使用者**:Railway 環境變數 `ALERT_WEBHOOK_URL` 填入 Slack/Discord webhook,severe-error 告警才會真的送出(程式路徑已存在且可用)。
- **B2 批次**:23 個 `*_to_dict` 依「改到哪遷到哪」逐批轉 CamelModel。
- **B3 後續**:authz Depends 化(動全部 patient-route 簽名)、ai_chat SSE 編排下沉。
- **D1 後續**:實際把 6 個凍結頁拆成 page package(拆一個就從 ratchet 表移除一個)。
- **C5**:staging 決策。
