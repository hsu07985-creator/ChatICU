# B15 Phase 2.1 — Snapshot Audit

- **日期**：2026-04-30
- **目的**：在不改 runtime code 的前提下，量測 `build_clinical_snapshot()` 的 size / build time / section 占比，判定 Path B（snapshot compression）是否值得做、優先壓哪段
- **品質風險**：**0**（read-only — 不寫 DB、不創 ai_session、不打 OpenAI、不改 patient_context_builder.py / ai_chat.py / 任何 prompt）
- **配套文件**：[`b15-baseline-2026-04-30.md`](b15-baseline-2026-04-30.md)（Phase 0 baseline，TTFT p50=1235ms, cache_hit_ratio p50=70%）

---

## 1. 方法

新增 `backend/scripts/b15_snapshot_audit.py`：
- Monkey-patch（**僅 audit 進程內、不改檔案**）`patient_context_builder.py` 的 9 個 `_get_*` fetchers + 8 個 `_fmt_*_section` formatters，加 timing/capture wrapper
- SQLAlchemy `before_cursor_execute` event 計 SELECT 數
- 每位 patient 跑兩次 build_clinical_snapshot，比對 hash 驗 byte-stability
- 同 baseline 用相同 2 個 prod patient

執行（read-only，無副作用）：
```bash
cd backend
python3 -m scripts.b15_snapshot_audit --patients pat_5219befc pat_b00e859b
```

---

## 2. 量測結果

### 2.1 Total size + build time

| Patient | total_chars | est. tokens | build_ms | SELECT 數 |
|---|---|---|---|---|
| `pat_5219befc`（廖○賢 I-01）| **1064** | ~304 | **4718** | 8 |
| `pat_b00e859b`（周○鄉 I-17）| **1411** | ~403 | **6324** | 11 |
| 平均 | 1238 | ~354 | 5521 | 9.5 |

**對照 baseline** (`b15-baseline-2026-04-30.md` §4.1)：
- baseline `snapshot_ms` p95 = 6030ms ↔ audit build_ms 4718-6324ms ✅ 一致
- baseline `sys_prompt_chars` p50 = 1838 ↔ snapshot ~1064-1411 chars
- 推 `TASK_PROMPTS["icu_chat"]` 約 **427-774 chars**（system_prompt 中非 snapshot 的固定 base 區）

### 2.2 Section breakdown（chars / percent / est. tokens）

#### pat_5219befc（chars=1064）
| Section | chars | % | est. tok |
|---|---|---|---|
| **med** | **777** | **73.0%** | ~222 |
| patient | 109 | 10.2% | ~31 |
| reports | 69 | 6.5% | ~20 |
| (header/glue) | 64 | 6.0% | ~18 |
| lab | 36 | 3.4% | ~10 |
| vital | 9 | 0.8% | ~3 |
| vent | 0 | 0.0% | 0 |
| duplicate | 0 | 0.0% | 0 |
| scores | 0 | 0.0% | 0 |

#### pat_b00e859b（chars=1411）
| Section | chars | % | est. tok |
|---|---|---|---|
| **med** | **697** | **49.4%** | ~199 |
| **reports** | **329** | **23.3%** | ~94 |
| patient | 128 | 9.1% | ~37 |
| duplicate | 118 | 8.4% | ~34 |
| (header/glue) | 68 | 4.8% | ~19 |
| lab | 36 | 2.6% | ~10 |
| scores | 26 | 1.8% | ~7 |
| vital | 9 | 0.6% | ~3 |
| vent | 0 | 0.0% | 0 |

### 2.3 Per-fetcher time（ms，n=2 patient）

| Fetcher | pat_5219befc | pat_b00e859b |
|---|---|---|
| `_get_latest_scores` | 4071 | 4062 |
| `_get_recent_reports` | 3446 | 3437 |
| `_get_latest_vent` | 2967 | 2732 |
| `_get_latest_vital` | 2424 | 2223 |
| `_get_active_medications` | 1814 | 1576 |
| `_safe_duplicate_warnings` | 7 | 1643 |
| `_get_latest_lab` | 1199 | 1096 |
| `_get_lab_before_24h` | 604 | 614 |
| `_get_patient` | 599 | 584 |
| **Sum**（理論順序）| **~17131** | **~15967** |
| **Actual build_ms** | 4718 | 6324 |
| **平行化 ratio** | ~27% | ~40% |

→ `asyncio.gather` 確實有平行化效果（actual << sum）但**沒到完美 parallel**（max(individual) ≈ 4s vs actual 5-6s）。SQLAlchemy AsyncSession 單 connection 在 gather 時部分串行。

### 2.4 Per-formatter time

全部 < 0.5ms。formatter 純字串組裝，**完全不是瓶頸**。

### 2.5 Stability check ✅

```
pat_5219befc：兩次 hash 同 (5f85befa909636af)
pat_b00e859b：兩次 hash 同 (8a4b6a7b0d351f8d)
```

**注意**：build_clinical_snapshot 內 line 669 有 `now_str = datetime.now(...).strftime("%Y-%m-%d %H:%M")` —— 解析度為「分鐘」。**跨分鐘的兩次 build 會有不同 hash**（差 1 個字串）。但同 session 的 snapshot 只 build 一次（首輪後存 `session.snapshot_metadata` reuse），所以 prod 流程下不會破 cache。

---

## 3. 對「品質風險」的硬限制驗收

| 限制 | 驗收 |
|---|---|
| 不改 `patient_context_builder.py` | ✅ `git status` 顯示 0 modification |
| 不改 `ai_chat.py` | ✅ 同上 |
| 不改 prompt / model / runtime path | ✅ 全部 monkey-patch 在 audit script 進程內，不寫進檔案 |
| 不寫 DB、不新增 ai_session | ✅ 9 個 SELECT 全部 read-only；warm-up `SELECT 1` 不寫資料 |
| 不打 OpenAI API | ✅ build_clinical_snapshot 純 DB 查詢，不呼叫 LLM |
| 跑兩次比 hash | ✅ 兩 patient 都 byte-stable |

---

## 4. Doc 必須回答的 4 個問題

### Q1：哪些 section 最肥？Phase 2.2 eval 要優先覆蓋？

**主要壓縮目標**（80/20 原則）：

| 排名 | Section | 平均占比 | 說明 |
|---|---|---|---|
| 1 | **med** | **49-73%** | 最大槓桿。當前格式應為「每 active med 一行 raw dump」。壓縮空間最大 |
| 2 | **reports** | 6-23% | 第二槓桿。圖檢/手術報告的 IMPRESSION + body_text 都印 → 壓成 IMPRESSION-only |
| 3 | patient | ~10% | 不大、語意重要（demographics、DNR、allergies）— 不建議壓 |
| 4 | duplicate | 0-8% | 自動偵測警示，已是壓縮過的精煉訊號 — 不壓 |
| 5 | (header/glue) | ~5% | timestamp + 分隔行 — 不壓 |
| 6+ | lab/vital/vent/scores | 各 0-3% | 全部加起來 < 10%，壓不出多少 — 不壓 |

→ **Phase 2.2 eval 必須優先覆蓋 med 與 reports 兩個 section 的 LLM 答題能力**。其他 section 的 eval 是次要。

### Q2：哪些 section 最可能拖慢 first-turn snapshot build？

**Per-fetcher RTT 分布**（兩 patient 一致）：

| 慢 → 快 | Fetcher | RTT (ms) | 是否能省 |
|---|---|---|---|
| 1 | `_get_latest_scores` | ~4070 | 必查（scores 很重要時）|
| 2 | `_get_recent_reports` | ~3440 | 必查 |
| 3 | `_get_latest_vent` | ~2730-2967 | 即使 vent_section=0 chars 還是查（無 vent 病人浪費 ~3s）|
| 4 | `_get_latest_vital` | ~2220-2420 | 必查 |
| 5 | `_get_active_medications` | ~1576-1814 | 必查 |
| 6 | `_get_latest_lab` | ~1100-1200 | 必查 |
| 7 | `_get_lab_before_24h` | ~600-615 | conditionally 查（trend 用）|
| 8 | `_get_patient` | ~580-600 | 必查 |
| 9 | `_safe_duplicate_warnings` | 7-1643 | conditionally |

**核心觀察**：
- 9 個 fetcher 即使透過 `asyncio.gather` 平行，**單 AsyncSession connection 在 gather 時序列化**，造成 actual build_ms ≈ 4-6s
- **真正的瓶頸不是任何單一 fetcher，而是 `asyncio.gather` 在共享 session 上的部分串行行為**
- 即使 vent/vital/lab/scores 等 section 寫到 snapshot 是 0-9 chars，fetcher 還是付了 1-4s RTT

→ **Path B 改 trend-summary 的 snapshot 結構，本身不會直接讓 fetcher 變快**（fetcher 跟資料量無關）。如果要真的壓 first-turn build_ms，要：
- (a) 減少 fetcher 數（移除明顯沒用的 fetch）
- (b) 多開 connection 真正 parallel（架構改動，超出 Path B）
- (c) 預先 cache（架構改動）

→ **first-turn snapshot_ms 的 6s 主要是 DB RTT，不是 prompt size 問題。Path B 主要解決的是 prompt size → LLM TTFT，不是 DB build time。**

### Q3：sys_prompt_chars p50=1838 對照實際 snapshot chars，cache prefix 主要來自哪？

| 段 | chars | est. tok | 性質 |
|---|---|---|---|
| `TASK_PROMPTS["icu_chat"]`（base prompt）| ~427-774 | ~120-220 | **靜態常數**，跨 session 完全相同 |
| Snapshot 文本 | 1064-1411 | 304-403 | 每 session 一份；session 內 byte-stable |
| **system_prompt 總 chars** | ~1500-2200 | ~430-630 | 與 baseline p50=1838 對齊 ✅ |

**OpenAI prompt cache 機制**：
- 要 cache hit，prefix 必須 byte-identical 且 ≥ 1024 token threshold
- baseline `prompt_tokens` p50=1810 → 整 prompt（system + history + user）滿足 ≥ 1024 token threshold
- baseline `cached_tokens` p50=1280 token → 平均有 1280 token 命中 cache
- 1280 / 1810 ≈ **70.7%** ↔ 對齊 hit_ratio_p50=70%

**推測 cache prefix 組成**：
- TASK_PROMPTS（120-220 tok，跨所有 session 相同）→ cross-session cache
- snapshot（304-403 tok，session 內穩定、跨 session 不同）→ per-session cache
- 過去 turn 的 user/assistant content（變動最大段）→ 累積 cache

→ cache 有效（70%）說明大部分時候命中的是 **TASK_PROMPTS + 同 session 過去 turns**。Path B 壓 snapshot **不會傷 cache**（snapshot 在 prefix 中段，壓掉的部分本來就會在第一輪後被重新寫進 cache）。

### Q4：Path B 是否值得做？下一步是什麼？

**Path B 值得做**——但**收益不在 first-turn build_ms**（那是 DB RTT 問題），**而在 LLM TTFT**（prompt size 直接影響）：

| 預估收益 | 計算 |
|---|---|
| 壓 med section 50% | total chars 1238 → ~890（−28%）|
| 壓 reports section 50% | 額外 ~−5%（pat_b00e859b 受益更多）|
| 預估 prompt size 整體 | **−30~35%** |
| 預估 LLM TTFT 改善 | OpenAI TTFT 大致與 prompt size 線性相關 → **−20~30%** |
| baseline TTFT p50=1235ms | → **目標 850-985ms** |

**但 Phase 2.1 不直接動 compression**（per 你的指示）。下一步是 Phase 2.2：

> **Phase 2.2 — 設計 LLM eval gate**（目標：守門 LLM 品質、為後續 compression PR 提供 gating 機制）
>
> 1. 寫 10-15 個臨床問答 case，**優先覆蓋 med 和 reports**（這兩段是 Path B 主要目標）
> 2. 對 OLD（現行 snapshot）跑每 case 取 LLM 回答 → 黃金 baseline
> 3. 設計判分機制：LLM-as-judge 還是 keyword matching（先選 keyword 簡單可靠）
> 4. **Phase 2.2 ship 條件**：所有 case 在 OLD snapshot 下 ≥90% pass，這代表 OLD baseline 是可信的；任何 NEW snapshot 在 PR 時跑同樣 eval ≥這個 baseline 才能 ship
> 5. 寫進 `tests/evals/test_icu_chat_snapshot_eval.py`
>
> **Phase 2.2 仍是 read-only against runtime code**（只新增 test 檔，不改 prompt/snapshot）。

只有 Phase 2.2 eval gate 完成 + 黃金 baseline 取得後，才該動 Phase 2.3（snapshot compression 實作）。

---

## 5. 結論摘要

1. ✅ **Snapshot byte-stable per session**（同分鐘內），cache 行為符合預期
2. ✅ **Med 是壓縮第一槓桿**（49-73%），reports 是第二（最高 23%）
3. ⚠️ **first-turn build_ms (~5-6s) 是 DB RTT 問題不是 prompt 問題**——Path B 不會直接救它
4. ✅ **Path B 對 LLM TTFT 預估省 20-30%**（從 1235ms → 850-985ms）
5. 🚦 **下一步是 Phase 2.2**（寫 eval test cases），**不是直接動 compression**
6. 📊 樣本只 n=2 patient — 結論泛化性受限，但兩患者趨勢一致（med 都最大、其他都<25%），足以指導 Phase 2.2 優先順序

---

## 附錄 A：Audit script 設計細節

- **Warm-up SELECT**：發現 prod `_get_or_create_session()` 在 build_clinical_snapshot 之前先 query 一次，間接 warm up AsyncSession connection。沒這 warm-up，gather 的 9 個 fetcher 會在連線爭用上 race 並 raise `InvalidRequestError: This session is provisioning a new connection; concurrent operations are not permitted`。Audit script 加了 `await db.execute(text("SELECT 1"))` 模擬同樣 warm-up（這個 SELECT 不算進 select_count）
- **Monkey-patch 範圍**：所有 patch 都用 `setattr(module, name, wrapped)` 做在 audit 進程內，純記憶體；不寫回檔案
- **Token 估算**：CJK ~2 chars/token + EN ~4 chars/token → 混合用 3.5 估算。實際 tokenizer 結果可能差 ±10%

## 附錄 B：原始輸出片段

```
=== Patient pat_5219befc ===
  total_chars:         1064
  estimated_tokens:     304
  build_ms:            4718
  select_count:      8
  snapshot_hash:     5f85befa909636af

  Section breakdown (chars / percent / est. tokens):
    med               777   73.0%  ~  222 tok
    patient           109   10.2%  ~   31 tok
    reports            69    6.5%  ~   20 tok
    lab                36    3.4%  ~   10 tok
    ...

=== Patient pat_b00e859b ===
  total_chars:         1411
  estimated_tokens:     403
  build_ms:            6324
  select_count:      11
  snapshot_hash:     8a4b6a7b0d351f8d

  Section breakdown (chars / percent / est. tokens):
    med               697   49.4%  ~  199 tok
    reports           329   23.3%  ~   94 tok
    patient           128    9.1%  ~   37 tok
    ...
```

完整 raw output 可從 `python3 -m scripts.b15_snapshot_audit --patients ... --show-snapshot` 重產。
