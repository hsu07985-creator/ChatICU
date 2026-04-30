# Roadmap Fast-lane Backlog — 2026-05-01

- **日期**：2026-05-01
- **建立背景**：B15 chat-latency 系列 2026-05-01 收線（[`b15-a1b-canary-2026-05-01.md`](b15-a1b-canary-2026-05-01.md)）。Phase 0–4 全部上線、Phase 5 dormant、Phase 6 觀察類無觸發。手上沒有「正在跑的大計劃」，這份 doc 把候選工作項按可動性盤點清楚。
- **本檔不改任何 runtime code**，僅做盤點與優先序建議
- **配套 doc**：
  - 前瞻 roadmap：[`optimization-roadmap-2026-04-29.md`](optimization-roadmap-2026-04-29.md)
  - 歷史 audit：[`system-audit-2026-04-28.md`](system-audit-2026-04-28.md)
  - B15 closeout：[`b15-a1b-canary-2026-05-01.md`](b15-a1b-canary-2026-05-01.md)
  - Phase 5 preflight：[`phase5-preflight-2026-04-29.md`](phase5-preflight-2026-04-29.md)
- **驗證指令**：寫完此 doc 後 `git diff --name-only` 應只看到 `docs/fastlane-backlog-2026-05-01.md`

---

## 0. TL;DR

| # | 候選 | 分類 | 建議 |
|---|---|---|---|
| 1 | pytest-cov coverage baseline 報告 | ✅ 立即可做 | **做**（30 min，純 read-only） |
| 2 | Phase 5 preflight 重新驗收 | 🟡 已完成、可選刷新 | doc 已存在，**不必重做**；除非要重啟 Phase 5 |
| 3 | Worktree noise cleanup | 🟡 review 後逐項處理 | **review，不直接 commit**；下面有逐項分類建議 |
| 4 | B15 dormant flag/code 拆除 | ❌ 暫不建議 | flag OFF + tests + 4 commits 留 prod；3 個月內無 user signal 才重評 |
| 5 | Phase 5 Vercel namespace / router merge | 🔮 高風險 dormant | 維持 dormant；無 user-facing 收益、blast radius 大 |

**核心建議**：只做 #1，#3 進 review 流程，其他維持 dormant。

---

## 1. 已完成、但 doc / remote 可能不同步

### 1.1 pytest-cov 基建
**狀態**：✅ 已建。Commit `323d61c6d` 加了 `[tool.coverage.*]` 到 `backend/pyproject.toml`，opt-in 模式 (`pytest --cov=app --cov-report=term-missing`)。

**Doc 不同步點**：
- `optimization-roadmap-2026-04-29.md:380` Phase 6「觀察類」欄位仍寫「pytest-cov 加進 CI」未觸發。其實基建早已落地、只是沒接 CI gate、沒紀錄 baseline 數字。
- 沒有任何 commit / doc 報告過「目前 coverage = X%」。

**真正缺的**：一份 baseline coverage report（不是基建）。詳 §2.1。

### 1.2 Phase 5 preflight
**狀態**：✅ doc 已存在 `docs/phase5-preflight-2026-04-29.md`（2026-04-29 由 agent 平行盤點 33 個 router + 18 個 vercel.json rewrite + 8 個 header gate）。

**Doc 不同步點**：無。Phase 5 在 roadmap 標記 dormant，與 preflight doc 一致。

**真正缺的**：除非要重啟 Phase 5，否則無動作。詳 §3.2。

### 1.3 B15 chat-latency 4 個 commit
**狀態**：✅ 全在 prod。`b27de7a9f` warm-up / `c97a5e5c5` split / `458a70260` A1.1 / `4919d4644` B / `85e240f2d` closeout doc。Flag `SNAPSHOT_DEFERRED_ENABLED=false` on Railway prod env，dormant。

**Doc 不同步點**：無。closeout doc 是最新真實態。

### 1.4 Vercel / Railway remote alignment
- `main` = `personal/main` = `85e240f2d` ✅
- `railway/main`（前端 / Vercel）= `92be6f25d`（落後 ~5 commit，全是 backend / docs only）
- 無前端變更、Vercel 無需 redeploy。**不需動作**。

---

## 2. 立即可做（low-risk、recommended）

### 2.1 pytest-cov baseline coverage report

| 屬性 | 值 |
|---|---|
| **預估工** | 30 min |
| **影響檔** | 0 runtime；新增 `docs/coverage-baseline-2026-05-01.md` |
| **Prod deploy** | 否（純 dev / doc） |
| **LLM 質量影響** | 0 |
| **Rollback 難度** | trivial（doc-only） |
| **建議順序** | **第 1 個做** |

**做什麼**：
1. `cd backend && python3 -m pytest --cov=app --cov-report=term-missing --cov-report=html`
2. 把 term-missing summary（top-level + per-file）整理成 `docs/coverage-baseline-2026-05-01.md`
3. 標記哪些 module ≥80%、50–80%、< 50%；標記哪些 module 是 critical-path（routers / snapshot_sync / patient_context_builder）
4. 不設 CI threshold、不裝 GitHub Action。只是「打 baseline 數字」，未來 PR 要不要對 coverage 才有依據

**為何先做**：B15 系列 9 個新 unit test 剛進 prod、整體 test 數穩定，這是抓 baseline 的好時機。RAG 整層刪除（Phase 1）後 coverage 結構變化大、舊數字不能用。

**何時不必做**：團隊沒人會看這份 baseline（一段時間後沒人引用就成廢 doc）。但工 30 min、產出 1 份 .md，沉沒成本極低。

**風險**：~0。`--cov` 是 opt-in、不影響 default test run。

---

## 3. 時間 / 訊號 gate（要等 signal 才做）

### 3.1 Worktree noise cleanup

| 屬性 | 值 |
|---|---|
| **預估工** | 1–2 hr（review）+ 不確定（依分類處置） |
| **影響檔** | `git status --short` 顯示 11 個 deleted + 16 個 untracked，下面分類 |
| **Prod deploy** | 否（不影響 prod） |
| **LLM 質量影響** | 0 |
| **Rollback 難度** | 分類後因項而異 |
| **建議順序** | **review 先做，commit 動作分批處理** |

#### 3.1.1 已 deleted 在 working tree 的 11 個檔案（review，不可直接 commit）

| 檔案 | 為什麼 deleted | 建議處置 |
|---|---|---|
| `datamock/drugInteractions.json` | json-mode 退役、source-of-truth 改 DB / vector store | **暫不 commit**，先確認 `backend/app/main.py` + `frontend src/` 真的零 reference 才能 stage |
| `datamock/labData.json` | 同上 | 同上 |
| `datamock/labTrends.json` | 同上 | 同上 |
| `datamock/medicationAdministrations.json` | 同上 | 同上 |
| `datamock/medications.json` | 同上 | 同上 |
| `datamock/messages.json` | 同上 | 同上 |
| `datamock/patients.json` | 同上 | 同上 |
| `datamock/users.json` | 同上 | 同上 |
| `datamock/ventilatorSettings.json` | 同上 | 同上 |
| `datamock/vitalSigns.json` | 同上 | 同上 |
| `docs/his-sync-schedule-and-manual-trigger.md` | 被 commit `8e7f61b8a` finalize HIS sync runbook 後內容轉到 CLAUDE.md / `docs/資料更新_0424.md` | 確認新 runbook 完整後 commit deletion |

**HARD CONSTRAINT**：這 10 個 datamock 已在 working tree 是「未提交的大規模刪除」，背後牽連到 json-mode 退役決策。**不要在沒有 architecture sign-off 的情況下打包進一個 commit**——刪錯一個 production fallback path 會讓 Railway boot 起不來。

**review 流程建議**：
1. 對每個 datamock 檔，跑 `grep -rn '<basename>.json' src/ backend/app/ scripts/` 確認 0 reference
2. 跑 `git log --all --oneline -- datamock/<file>.json` 看最後一次寫入是誰、commit message 有沒有提退役計劃
3. 全部驗證後再一個 `chore(datamock): retire json-mode static fixtures` commit 一次性刪 10 個

#### 3.1.2 untracked 16 個（待分類）

| 路徑 | 看起來像 | 建議 |
|---|---|---|
| `0_chatICU reference/` | 個人參考目錄 | **加 .gitignore**（local-only） |
| `1150429_2nd_2_patients_1141001_1150501/` | HIS snapshot 暫存 | **加 .gitignore**（patient/* 已 gitignore？要確認） |
| `backend/scripts/seed_demo_duplicates.py` | duplicate detection seed script | 若已驗證可用 → commit 進 repo |
| `backend/scripts/smoke_test_duplicates.py` | duplicate smoke test | 同上 |
| `docs/ai-context-architecture-plan.md` | 設計 doc | 確認是現役計劃 → commit；廢棄 → 刪 |
| `docs/資料更新_0424.md` | HIS 資料更新 runbook（CLAUDE.md 已 link） | **commit**（CLAUDE.md `8e7f61b8a` 已引用，repo 卻沒這檔，是 broken link） |
| `drug_api/` | 外部 drug data 暫存 | 加 .gitignore |
| `patient/` | HIS patient snapshot working dir | 加 .gitignore（CLAUDE.md 提到此路徑） |
| `reports/lexicomp_xd_candidates_*.{json,md}` 共 6 檔 | 一次性研究輸出 | 加 .gitignore（檔名帶日期戳記，疑為臨時產物） |
| `逆轉腎ai/` | 個人專案目錄 | 加 .gitignore（local-only） |
| `重複用藥＋交互作用/` | 同上 | 加 .gitignore |

**最小可行步驟（建議）**：
1. **第一刀**：補 `.gitignore`，蓋掉純 local 目錄（`0_chatICU reference/` / `逆轉腎ai/` / `重複用藥＋交互作用/` / `drug_api/` / `patient/` / `1150429_*/` / `reports/lexicomp_xd_*` ）
2. **第二刀**：commit 真有用的 4 檔（2 backend script + 2 doc）
3. **第三刀**：datamock 10 檔的退役 commit（**先做 §3.1.1 review**）

**何時不必做**：working tree 雜亂沒影響 prod、CI 也通過。優先級低於 §2.1。

#### 3.1.3 風險點

- 直接 `git add -A` 把 untracked patient HIS snapshot 不小心 stage 進去 → 上 GitHub 暴露 PHI（嚴重）
- 直接 commit datamock 刪除 → 萬一 backend `import datamock/...` fallback path 還活著 → Railway boot 失敗
- **務必逐項 review、不要 batch commit**

---

## 4. 不建議推進（dormant）

### 4.1 B15 dormant flag / code 拆除

| 屬性 | 值 |
|---|---|
| **預估工** | 2 hr（4 commit revert + 9 unit test 刪除） |
| **影響檔** | `app/services/patient_context_builder.py`、`app/routers/ai_chat.py`、`app/config.py`、`tests/test_api/test_chat_snapshot_deferred.py` |
| **Prod deploy** | 是（純後端、Railway 自動部署） |
| **LLM 質量影響** | 移除 warm-up（`b27de7a9f`）會讓首屏多 ~1s（DB connection 冷啟）。其他 dormant code 不影響行為（flag = false） |
| **Rollback 難度** | 中（可 revert，但 9 個 unit test 一起拔了未來重啟更費工） |
| **建議順序** | **不做** |

**為什麼不建議**：

1. **Optionality 還在**：closeout doc §7 列了 4 個重啟條件（user complaint / traffic 上升 / OpenAI cost 浮現 / HIS sync interval 縮短）。任何一個觸發都會直接從 D5（single-connection bulk SELECT）動工，**A1.1 + B 的 cache invariant + 多連線 pattern 仍是必要前置**。整套 revert 後重做要花 1.5 個 sprint。
2. **9 個 unit test 是真實 invariant 守護**：`test_chat_snapshot_deferred.py` 守 `system_prompt byte-stable across turns` 這條 OpenAI prompt cache 的核心契約。即使 flag OFF 也應該保留——未來任何人在 `_build_system_prompt` 動土時會被 test 擋住、不會偷偷打破 cache。
3. **Warm-up（`b27de7a9f`）跟 flag 解耦**：closeout doc §6.2 明確寫「flag = false 時 prod 走 legacy `build_clinical_snapshot`（B15-D 加的 warm-up 仍生效）」——拔了 warm-up 等於主動讓首屏變慢。
4. **零 user-facing 副作用維持現狀**：flag OFF + dormant code 不執行、不消耗 runtime，唯一成本是「~600 行多餘 code」，不是熱路徑。

**何時重評**：3 個月（≈ 2026-08-01）後若 §7 的 4 個重啟條件都未觸發、且 ICU AI chat 使用模式有結構性轉變（例：改 OpenAI Realtime / 換 LLM provider）讓 prompt cache 不再是 latency 主因 —— 那時可以重評是否清掉。**今天明確不動**。

### 4.2 Phase 5：Vercel `/api/*` namespace + router merge

| 屬性 | 值 |
|---|---|
| **預估工** | 5.1 namespace = 2–3 天；5.2 router merge = 1–2 天（preflight 已盤好） |
| **影響檔** | 33 個 backend router、18 條 vercel.json rewrite、24 個 frontend `lib/api/*.ts`、SPA route 表 |
| **Prod deploy** | 是（前後端 + Vercel rewrite 同步），blast radius 大 |
| **LLM 質量影響** | 0 |
| **Rollback 難度** | **高**（後端 router prefix 改了 → 前端 callsite 全改 → vercel.json rewrite 全改；revert 三邊都要對齊） |
| **建議順序** | **dormant，不主動推** |

**為什麼不建議**：

1. **0 user-facing 收益**：`phase5-preflight-2026-04-29.md` §1 明寫「沒有 user-facing 收益」，純整潔重構。
2. **Phase 4 + B15 已把 prod 推到穩態**：startup_migrations 退役、HIS sync 6× 提速、首屏 −32%、QueuePool/5xx 0 hit。再來改 namespace 是「動穩定的東西」而非「修問題」。
3. **隱性風險點多**：Vercel header gate（`x-request-id`）→ namespace 切換期間 1–2 個月需要保留 compatibility rewrite，期間若 rewrite 規則寫錯、prod 直接掛或回 SPA HTML（CLAUDE.md §5「常見陷阱」已列）。
4. **比 1.4 那種 silent-fail 更難察覺**：bug 不會在 health check 出現、要靠真實 user 操作才發現。

**何時重評**：
- Vercel 改 rewrite header gate 政策（極低機率但發生 → 強制做）
- 新 dev 上來踩 `x-request-id` 坑兩次以上（onboarding cost 訊號）
- 要新增第二組 SPA / API URL collision 衝突 path（自然觸發）

### 4.3 Phase 6 觀察類（不主動）

`optimization-roadmap-2026-04-29.md:373` 列的觀察項目在 2026-05-01 仍未觸發：

| 項目 | 觸發條件 | 2026-05-01 狀態 |
|---|---|---|
| Sentry / 錯誤追蹤 | prod 看到難排錯 exception | 未觸發（Railway log 持續乾淨） |
| Supabase RLS / index audit | 新增多寫入路徑 | 未觸發（HIS sync 是唯一寫入路徑） |
| pytest-cov **加進 CI** | CI 設定後 | 基建已存在（§1.1）、CI gate 未掛 |
| LLM cost / latency 監控 | AI chat 流量大時 | 未觸發（B15 closeout 確認 prod 0 organic /ai/chat/stream 流量） |
| HIS sync 排程化 | 自動化需求出現 | 未觸發（手動 + serial sync 工作良好） |

→ 全部維持 dormant。

---

## 5. 候選對照總表（依使用者指定順序）

| # | 候選 | 預估工 | 影響檔 | Prod deploy | LLM 質量影響 | Rollback 難度 | 建議 |
|---|---|---|---|---|---|---|---|
| 1 | pytest-cov baseline | 30 min | 1 doc | 否 | 0 | trivial | ✅ **做** |
| 2 | Phase 5 preflight | 0（已完成） | 0 | 否 | 0 | n/a | ⏸ **不重做** |
| 3 | Worktree noise cleanup | 1–2 hr review + 分批 | 11 deleted + 16 untracked | 否 | 0 | 中（依項） | 🟡 **review 先，不直接 commit** |
| 4 | B15 dormant 拆除 | 2 hr | 4 個 module + 9 tests | 是 | warm-up 移除 = 首屏 +1s | 中 | ❌ **暫不建議**（3 個月後重評） |
| 5 | Phase 5 namespace / router merge | 3–5 天 | 33 router + 18 rewrite + 24 lib/api | 是 | 0 | 高 | 🔮 **dormant，看 signal** |

---

## 6. 建議執行順序

1. **今天 / 本週**：§2.1 pytest-cov baseline（30 min，純 read-only）
2. **下週 / 有空檔時**：§3.1 worktree noise cleanup（**先 review**，分 3 批 commit；嚴禁 `git add -A` 一次性處理）
3. **不主動做**：§4.1 B15 dormant 拆除、§4.2 Phase 5、§4.3 Phase 6 觀察類

---

## 7. 結論

- ✅ Phase 0–4 + B15 都已收線、prod 穩態、無短期 gate
- ✅ Doc 與 remote 對齊度高（§1）
- ⏳ 只有 1 個低風險立即可做項（pytest-cov baseline）
- 🛑 worktree 雜訊大但**必須逐項 review**，不可批次 commit
- 🔒 B15 + Phase 5 + Phase 6 維持 dormant，等 signal

**沒有需要立刻動的 runtime code。** 維持 prod 不動是當前最佳行動。

---

## 附錄 A：本檔產出後的 git diff 驗證

```bash
git diff --name-only
# 預期僅一行：docs/fastlane-backlog-2026-05-01.md
```

任何其他改動 → **stop，不可 commit**。
