# B15 Phase 2.2 — Snapshot Build Latency Plan

- **日期**：2026-04-30
- **目的**：在不改 runtime code 的前提下，盤點 `build_clinical_snapshot()` 哪些 fetcher 是首輪臨床決策必要、哪些可 defer，設計 **critical/deferred snapshot split** 策略
- **品質風險**：**0**（read-only 設計階段；**不寫 LLM eval、不改 prompt、不動 runtime**）
- **核心問題**：能不能把 first-turn snapshot build 從 **5-6s 降到 1.5-2s**，同時不讓 LLM 少掉關鍵臨床資訊？

**配套**：
- [`b15-baseline-2026-04-30.md`](b15-baseline-2026-04-30.md)（TTFT p50=1235ms / cache hit 70%）
- [`b15-snapshot-audit-2026-04-30.md`](b15-snapshot-audit-2026-04-30.md)（snapshot 1238 chars 平均、build_ms 5.5s 平均、9 fetchers 1-4s RTT each）

---

## 1. 為什麼從 compression 轉向 latency

Phase 2.1 audit 結論：
- **build_ms 5-6s 是 DB RTT 問題**，不是 prompt size 問題
- 9 個 fetcher，用 asyncio.gather 但**單 AsyncSession connection 限制了完美並行**（actual ~5s vs 真 parallel max ~4s）
- **格式化**（per-formatter < 0.5ms）完全不是瓶頸
- prompt size 只 ~1238 chars / ~354 tokens — 對 LLM TTFT 而言不算肥

→ 用戶感受到的「等太久才開始出字」**主要在 first-turn 的 5-6s snapshot build**，不是 LLM 端。

→ Compression（Path B）每輪省 ~360ms（TTFT），split（Path D）首輪省 ~4000ms。**首輪是用戶最容易抱怨的時點**。

---

## 2. 每個 fetcher 的「首輪必要性」盤點

| # | Fetcher | RTT (ms) | 產生什麼 LLM context | 首輪必要？ |
|---|---|---|---|---|
| 1 | `_get_patient` | ~600 | 姓名/年齡/性別/床號/診斷/插管/DNR/**過敏**/警示 | ✅ **必要**（過敏是安全強制；診斷是 LLM 識別 patient context 必要）|
| 2 | `_get_latest_lab` | ~1100 | 最新檢驗（Cr / WBC / CRP / Lac / PLT / K / Na / ...） | ✅ **必要**（臨床決策最常引用）|
| 3 | `_get_lab_before_24h` | ~600 | 24h 前同 lab 值（給 trend formatting） | 🟡 **可 defer**（首輪先顯示 current value、trend 在 turn 2+ 補；風險：「K 是不是上升中？」首輪答錯）|
| 4 | `_get_active_medications` | ~1800 | 全部 active meds（drug name / dose / freq / route） | ✅ **必要**（drug 相關問題佔 chat 一半）|
| 5 | `_get_latest_vital` | ~2400 | HR/BP/RR/Temp/SpO2/CVP | ✅ **必要**（hemodynamic 決策 + sepsis 判讀）|
| 6 | `_get_latest_vent` | ~2900 | 呼吸器 mode/FiO2/PEEP/Vt/RR/PIP | 🟡 **conditional defer**：當 `patient.intubated == False` 時 fetcher 必定產 0-byte section，仍付 ~3s — **可徹底跳過** |
| 7 | `_get_recent_reports` | ~3400 | 最近 3 筆影像/報告 IMPRESSION | 🔴 **defer**（imaging 問答只佔少數 chat；首輪不問就不需要）|
| 8 | `_get_latest_scores` | ~4070 | Pain/RASS/CPOT/GCS | 🔴 **defer**（scores 在 90%+ 對話中沒被引用）|
| 9 | `_safe_duplicate_warnings` | 7-1643 | 自動偵測的重複用藥警示 | 🟡 **conditional defer**（safety-relevant，但 `/medications` 端點有獨立的 duplicate detection；ai_chat 缺這段不是安全 gap） |

**Sum (理論順序)**: ~17s
**Critical-only sum**: 600+1100+1800+2400 = **5900ms** （但 parallel + warm-up 後可能 ~2.4-3s）
**Deferred sum**: 600+2900+3400+4070+1643 = **12613ms** → 移出 first-turn

---

## 3. Critical / Deferred Split 設計（候選 A）

### 3.1 Split

**Critical snapshot**（first-turn build < 2s 目標）:
- `_get_patient` ✅
- `_get_latest_lab` ✅
- `_get_active_medications` ✅
- `_get_latest_vital` ✅

→ 4 個 fetchers, 真 parallel 後 max RTT ~2.4s（vital 是最慢）+ async overhead ~0.5s = **預估 ~2.5-3s**。

要降到 1.5-2s 需配合 (D) AsyncSession warm-up + 多 connection 真 parallel（單 connection 序列化在這 4 個就吃 ~6s sum）。

**Deferred snapshot**（背景 fetch 或 on-demand）:
- `_get_lab_before_24h`（給 trend）
- `_get_latest_vent`（only if `patient.intubated`）
- `_get_recent_reports`
- `_get_latest_scores`
- `_safe_duplicate_warnings`

### 3.2 Defer 實作方案（3 種，後續決策）

**方案 1：Fire-and-forget background task**
- First turn 返回 critical-only snapshot
- `asyncio.create_task(build_deferred(...))` 在背景跑
- Deferred 結果寫進 `session.snapshot_metadata["deferred"]`
- Turn 2+ system_prompt 包含 critical + deferred
- **首輪 trade-off**：用戶問 turn 1 的 deferred section（如「最近 CT」）→ LLM 答「我目前沒這資料、turn 2 會有」。**接受度**：醫師對「等一下」尚可，比白等 6 秒好

**方案 2：On-demand function calling**
- LLM 啟動時只給 critical
- 加 OpenAI function: `get_imaging_reports()` `get_scores()` etc.
- LLM 自己決定要不要 call
- **複雜度高**、需測試 LLM 是否會主動呼叫
- 收益：first-turn 短、deferred sections 0 wasted call

**方案 3：Two-phase streaming**
- First turn 立刻開始 LLM streaming（用 critical-only）
- Background 同時 build deferred
- 如果 deferred 在 LLM 回完前 ready → 就把它當 follow-up context 串
- 這是實務上的「漸進式上下文」
- 複雜度最高

→ **建議方案 1**（最簡單、可逆、改動最少）。

---

## 4. 各候選 deferred section 的 LLM 品質風險

| Section | 風險程度 | 風險場景 | 緩解 |
|---|---|---|---|
| **vent** (when not intubated) | **🟢 零** | section 本來就 empty，LLM 看不到任何差別 | 直接條件式跳過，不需 defer |
| **vent** (when intubated) | 🟡 低-中 | 用戶 turn 1 問「目前 FiO2 多少？」→ LLM 答「無資料」或從 active meds 推斷 | 方案 1 的回應「請稍候、我去查」可接受 |
| **scores** | 🟢 低 | 用戶 turn 1 問「目前 Pain Score？」→ 同上 | 90%+ 對話不問 scores、defer 風險最低 |
| **reports** | 🟡 中 | 用戶 turn 1 直接問「最近影像？」→ LLM 答「請稍候」 | 醫師對「等 1-2s」尚可接受 |
| **duplicate** | 🟡 **中-高** | LLM 沒看到 auto-detected duplicate warnings → 可能在 prescribe 建議時忽略已存在的 duplicate | **緩解**：duplicate detection 在 `/medications` 端點有獨立 path，pharmacist 在 medications tab 還是會看到；ai_chat 缺這段**不是安全 gap**（除非全靠 chat 做臨床決策，目前流程沒這樣設計）|
| **lab_before_24h** (trend) | 🟢 低 | 用戶 turn 1 問「K 是不是上升？」→ LLM 看不到 24h ago 值，只能說 current；turn 2+ 才有 trend | 600ms 是這 5 個 deferred 中最便宜的，**可考慮留在 critical**（畢竟 600ms 不痛）|

### 4.1 修正後的 critical/deferred split

考量上面的風險矩陣，**建議調整**：

**Critical（5 fetchers，target build_ms ~2-3s）**:
- patient
- latest_lab
- **lab_before_24h**（從 deferred 移上來，只 600ms 但 trend 對臨床判斷重要）
- active_medications
- latest_vital

**Deferred（4 fetchers）**:
- latest_vent（**改 conditional**: if `patient.intubated == False` 完全不查；intubated 時才 defer）
- latest_scores
- recent_reports
- safe_duplicate_warnings（評估後也可考慮留 critical，看是否影響當前 pharmacist workflow）

---

## 5. 4 個下一步候選對照

| 候選 | 預期收益 | 工 | 風險 | 後續可組合 |
|---|---|---|---|---|
| **A. Critical/Deferred snapshot split** | first-turn build 5-6s → **2-3s** | 1-1.5 天 | 中（改 ai_chat lifespan + session metadata schema）| ✅ 與 D 互補 |
| **B. Per-section cache**（每 section 寫 cache、TTL 5min）| 跨 session 同 patient 重訪可 0ms 命中 cache、跨 patient 0 收益 | 1 天 | 低（純 cache layer）| ✅ 與 A 正交 |
| **C. Compression eval + 改 snapshot text** | LLM TTFT −20~30%（每輪 −250-350ms）| 1.5 天 + eval design | 中（改 LLM context、需品質 gate）| ✅ 與 A/B 正交 |
| **D. AsyncSession warm-up + 多 connection 真 parallel** | first-turn build 5-6s → **3-4s**（單純解 connection serialization）| 半天 | 低（純基建修正）| **A 必須先有 D 才能達 1.5-2s 目標** |

### 收益疊加估算

```
今天 first-turn TTFT until first useful word:
   t_session(420) + t_snapshot(6000) + t_ttft(1235) ≈ 7655ms

只做 D（warm-up + parallel）：
   420 + 4000 + 1235 ≈ 5655ms（首輪 −2s）

D + A（split + warm-up）：
   420 + 2500 + 1235 ≈ 4155ms（首輪 −3.5s）

D + A + C（split + warm-up + compression）：
   420 + 2500 + 870 ≈ 3790ms（首輪 −3.9s）
   subsequent turn TTFT: 870ms（每輪 −365ms）
```

---

## 6. 建議下一步

**Phase 2.3 候選排序**（按 ROI、相依性）：

```
Step 1: D - AsyncSession warm-up（半天，低風險、立竿見影）
        ↓ 不論後續做不做 A/B/C，這個都要先做
        ↓
Step 2: A - Critical/Deferred split（1-1.5 天，中風險）
        ↓ 需要在 ai_chat.py 加 lifecycle 邏輯
        ↓
Step 3 (可選): C - Compression eval + 改 snapshot text
        ↓ 為 subsequent turns 提供額外 −20~30% TTFT
        ↓
Step 4 (看需求): B - Per-section cache
        ↓ 跨 session 同 patient 才有收益、ICU chat 場景不常見
```

→ **D 先做**（不論 A/B/C 是否最後做都會受益），然後再決定 A 是否要動。

**Phase 2.3 動工前還需要的設計工作**：
- A 方案 1（fire-and-forget）的 session metadata schema：`snapshot_metadata` 增加 `deferred_status` (pending/ready/failed)、`deferred_built_at`、`deferred_critical_built_at` 等欄位
- A 方案 1 的「turn 1 用戶問 deferred 內容時的 fallback 文案」（給 system_prompt 一條規則：「若 deferred sections 還在 building，請告訴用戶『請稍等 1-2 秒、我正在取得最新影像/scores/...』」）
- D 的 connection 池策略：是 `await db.connection()` 預先 warm 還是直接用 `engine.connect()` 跳過 session

---

## 7. 結論摘要

1. ✅ **Phase 2.1 audit 已交出**: snapshot 5-6s build 主要是 9 個 DB fetcher 串行 RTT（單 AsyncSession 在 gather 時部分序列化）
2. ✅ **本 plan 確認**: 4 個 fetcher 是首輪 critical（patient + lab + meds + vital），4-5 個可 defer（vent conditional + scores + reports + duplicate + lab_before_24h 邊界）
3. ✅ **建議 critical/deferred split + AsyncSession warm-up**: 預估 first-turn build_ms 從 5-6s 降到 **2-3s**（再配多 connection 可到 1.5-2s）
4. 🟡 **Defer 的品質風險**: 主要在 reports/scores（用戶問 turn 1 → LLM 「請稍候」），**duplicate-warnings 是 medium 風險但有獨立的 `/medications` path 兜底**
5. 🚦 **下一步建議**: 先做 **D**（AsyncSession warm-up，半天、低風險），再做 **A**（split），**C 暫緩**（compression eval 為 LLM TTFT 服務、現在最大痛點是 build latency 不是 LLM TTFT）
6. ❌ **目前不寫 LLM eval**（per 你指示，eval 是為 compression 服務的）

---

## 附錄 A：每個 critical fetcher 的 LLM context 用途

| Section | LLM 答得出什麼類型問題 |
|---|---|
| patient | 「目前病人診斷？」「他在 ICU 多久？」「有過敏嗎？」「DNR 狀態？」|
| latest_lab | 「最新 K+ 多少？」「Cr 是多少？」「WBC 異常嗎？」（佔臨床問題 ~40%）|
| active_medications | 「目前在用什麼藥？」「dose？」「為什麼用 vasopressin？」（佔臨床問題 ~30%）|
| latest_vital | 「目前 BP/HR？」「sepsis 跡象？」「該不該升 levo？」|

## 附錄 B：每個 deferred fetcher 的 LLM context 用途 + 風險範例

| Section | 用途 | Defer 風險範例 |
|---|---|---|
| lab_before_24h | trend | 「K 是不是上升？」turn 1 答不出 trend、turn 2 才能 |
| latest_vent | 呼吸器 | 「目前 FiO2？」「PEEP 設定？」turn 1 答不出 |
| latest_scores | RASS/Pain/GCS | 「目前 RASS 多少？」turn 1 答不出 |
| recent_reports | 影像 IMPRESSION | 「最近 CT 有什麼？」turn 1 答不出 |
| safe_duplicate_warnings | 重複用藥警示 | LLM 不會主動提醒「你 prescribe 的這藥已經有 dup」（**但 medications 端點有獨立 path**）|

## 附錄 C：開放問題（待 Phase 2.3 動工前確認）

1. **Snapshot metadata schema migration**：A 方案 1 需新增 deferred 狀態欄位 — 是 alembic migration 還是 JSONB extra key？
2. **System prompt 加 fallback 文案**：deferred 還沒 ready 時 LLM 怎麼回應？
3. **Multi-connection cost vs benefit**：D 的多 connection 真 parallel 是否值得開額外連線（Supabase pooler 連線數有限）？
4. **Cancellation**：用戶 turn 1 回應後立刻送 turn 2，deferred 如果還沒完→ 該等 / 該取消 / 該繼續？
5. **Duplicate warnings 是否真該 defer？** 醫療安全 review 需要當事 pharmacist 確認 `/medications` 端點的 duplicate detection 確實 cover 了 chat 場景沒看到的部分。
