# ChatICU 全 codebase 系統性 Review（2026-06-03）

> ## 🔧 Round 3 更新 — 再修 14 條（workflow 15 agent 並行，每檔一人）
>
> 用 workflow 派 15 個 Opus agent **一檔一人並行**（檔案互斥、無衝突；無 schema 回純文字摘要避免
> StructuredOutput 失敗），每個 agent 拿到我親自驗證後寫好的精確 spec（只「套用」不「重查」）。
> 全部套用後我以 `git diff` + 全套 `pytest`（809 pass / 9 pre-existing fail）+ 前端 `tsc`（0 error）驗證。
>
> **本輪修好（14）**：`micro-1`（`.some`→`.every`，病原不再被正常菌叢蓋掉）、`iv-1`+`pg-1`
> （IV 相容性 worst-case + matrix key 對齊）、`bsc-3`（`_infer_duplicate_context` 預設 `icu`，
> 出血紅旗會觸發）、`svc-4`（加中文過敏類別別名）、`svc-3`（未來 end_date 不再標停用）、`svc-1`
> （negation conflict 加 generic_name）、`clin-1`（AI summary 改用合併 lab）、`intx-1`（500 cap 前先
> 依 severity 排序）、`br-2`（HIS sync 補稽核 log）、`mw-1`（保留 task ref 防 GC）、`ac-4`（過期 A/P
> gate Save&Copy）、`llm-3`（CrCl 加體重基準 caveat）、`pg-2`+`pg-3`（team-chat 歷史 cache/poll）、
> `pg-4`（dashboard 不再假造 0）、`fl-1`（無 active 藥不再把停藥列為 current）。
>
> **本輪「修了又退回」**：`svc-2`（lab merge 加 12h window）—— 跑既有測試發現會**丟掉 29 小時前的
> CBC（PLT 61 異常低值）**，是比原問題更糟的 false-negative。merge 跨時間是**刻意且臨床正確**（要最新
> 可得的每項數值）。已 **revert** 並在 `repository.py` 註解說明：svc-2 真正該做的是「每項數值標註時效」，
> 不是丟資料。
>
> **狀態**：Round 2 修 5 + Round 3 修 14 = **共 19 條已修**，全數綠燈、未 commit。剩餘多為 low/cosmetic
> （`ac-5`/`fl-3`/`fl-4`/`pad-1`/`br-3`/`lab-2`/`util-1`/`clin-2`/`fhir-4`/`bsc-4`/`ddi-1`/`pg-7`/`pg-8`/`llm-2`）
> + svc-2 的「per-item 時效標註」較大改動待排。Fix workflow Run：`wf_f3298ac2-2fa`。
>
> ---

> ## 🔧 Round 2 更新（同日，修復 + 缺口收尾）
>
> 第一輪只是「找問題」。Round 2 做了四件事：**(1) 修掉 Top 5 最嚴重**、**(2) 補驗證被丟棄的發現**、
> **(3) 重審品質存疑的 `frontend/pages` 單元**、**(4) 為 5 個修復寫回歸測試**。
>
> ### ✅ 已修復並驗證的 5 條（都已寫回歸測試）
> | id | 修復 | 檔案 | 測試 |
> |----|------|------|------|
> | `meds-1` | DDI 查詢不再靜默吞例外：記 log + 回 `interactionsError`；前端風險卡顯示「檢查暫時無法使用」 | `medications.py` / `medications.ts` / `medication-risk-card.tsx` / i18n | `test_medications_payload_exposes_interactions_error_flag` |
> | `lab-1` | 檢驗校正改「重建 dict + 重新賦值」→ JSONB 變更被追蹤、不再靜默還原 | `lab_data.py` | `test_correct_lab_value_persists_after_refetch` |
> | `llm-1` | snapshot 存 `_active_med_keys`；每回合無門檻注入「[用藥已變動]」block 給 LLM | `builders.py` / `ai_chat.py` | 4× `build_med_change_delta` / `_active_med_keys` |
> | `br-1` | 改/重設/admin 設密碼後，`iat < password_changed_at` 的舊 token 一律失效（`get_current_user` + `/refresh`） | `middleware/auth.py` / `auth.py` | 5× `test_password_session_revocation.py` |
> | `ac-2` | refine 失敗還原先前已核可的 polished A/P（不再清空落回原始草稿寫進 HIS） | `pharmacist-soap-editor.tsx` | （前端無 test runner，手動驗證 + tsc） |
>
> **回歸測試**：新增 12 條 + 修 1 條既有契約測試（bootstrap 因 `interactionsError` 擴充）。
> 後端受影響檔全綠；**全套 809 passed / 9 failed（9 條皆為 pre-existing，位於我未動的 `app/llm`
> reasoning-effort 與 `app/fhir/allergy_parser` 真實病人資料測試）**。前端 tsc 0 error。
>
> ### 🔎 缺口收尾結果
> - **`frontend/pages` 重審**（原 reviewer 只回「test」、0 發現）→ 重審 29 檔，抓到 **`pg-1` HIGH**
>   （`pharmacy/compatibility.tsx` IV 矩陣只取 `rows[0]`，多溶液不相容被藏；與 `iv-1` 同類）+ 4 條 medium
>   + 3 條 low；對抗式驗證 7 confirmed、1 refuted（`pg-5` PAD en-dash 經查有處理）。見 §8。
> - **7 條臨床-AI false-negative 我親自讀碼驗證 → 全部 confirmed**（`micro-1` 病原被正常菌叢蓋掉、
>   `bsc-3` HIS 病人出血紅旗被降級、`clin-1`/`svc-4`/`ac-1`/`intx-1`/`fl-2`）。見 §3。
> - **14 條被丟棄的 medium/low**：工作流驗證 agent 仍大量無法吐結構化結果（基建問題），故我手動補完 →
>   `svc-3` medium confirmed（未來 end_date 的 active 藥被標停用）+ ~10 條 low confirmed + `clin-2`/`bsc-4`
>   部分成立。見 §6。
>
> ### ⚠️ 仍未動（待你決定）
> §3/§6 已驗證但**尚未修**的 confirmed 發現（`micro-1`、`bsc-3`、`svc-2`、`svc-3`、`pg-1`、CrCl 體重…）。
> 9 條 pre-existing 測試失敗（`app/llm` reasoning-effort、`allergy_parser`）非本輪造成，可另開工。
>
> Run IDs：第一輪 `wf_b0a98b24-53f`；pages 重審 `wf_fd8a94b2-e70`；dropped 驗證 `wf_cd084f0a-89a`。
>
> ---

> **方法**：12 個 Opus reviewer 各審一個子系統（backend 159 py + frontend 214 tsx），每條
> 正確性 / 臨床-AI 發現再交給獨立的「對抗式驗證」agent（預設立場是「反駁」）。三個面向：
> **正確性 bug**、**架構 / 技術債**、**臨床 AI 安全**。
>
> **執行警示（務必先讀）**：工作流尾段觸發帳號 session/rate limit（synthesis agent 直接回
> 「session limit · resets 1:40am」），導致 **約 32 個驗證 agent 沒吐出結構化結果**，而 pipeline
> 對「驗證失敗」的處理是**直接丟棄該發現**。原始 reviewer 共產出 **46 條**發現，工作流自動保留只剩
> 14 條 —— 被丟棄的恰恰多是 **HIGH 等級**。
>
> 我（主 agent）已從 workflow journal 還原全部 46 條原始發現，並**親自閱讀程式碼重新驗證了 9 條被丟棄的
> HIGH**。本文件 = 14 條工作流已驗證 + 9 條我手動驗證 + 其餘 reviewer 回報但尚未對抗式驗證者（明確標示）。
>
> 原始 46 條完整 JSON：`/tmp/chaticu_raw_findings.json`。Run ID：`wf_b0a98b24-53f`。

---

## 總覽

整體而言 codebase 體質**偏健康**：資料層（models/schemas）紀律良好（CheckConstraint、一致的 FK
ondelete、tz-aware 正規化）；重複用藥偵測器與 patient_context_builder 的設計刻意「寧可誤報、不漏報」，
方向正確；HIS serial sync 在 silent-fail 軸上已修好。沒有發現任何被反駁（refuted）的假陽性 —— reviewer
品質高。

但有一組**反覆出現的系統性風險**值得最優先處理：**「臨床資料/AI 輸出在出錯或邊界情況時靜默退化，
卻對臨床端表現得像正常」**。最具代表性的是 `meds-1`（藥物交互作用查詢一旦丟例外就回傳「0 筆交互作用」
且不記 log——看起來最安全，其實是檢查掛了）與 `lab-1`（醫師校正檢驗值，API 回傳成功、畫面顯示新值，
但因 JSONB in-place 變更未被追蹤，重整後悄悄還原）。

**確認發現統計（含我手動驗證）**：確認 **23 條**（HIGH 7、MEDIUM 9、LOW 7）+ 架構 3 條 +
**尚待人工/對抗式驗證 約 20 條**（其中含數條臨床-AI false-negative，見 §6，建議 1:40am 限額重置後補跑）。

**單一最該先修**：`meds-1`（藥物交互作用靜默回傳 0 筆）+ `lab-1`（檢驗校正靜默還原）——兩者都是
「臨床端以為安全/已存，實際沒有」的資料完整性 / 安全 false-negative，且改動極小。

---

## 1. 優先處理清單（依真實優先序：病安/資料完整性 > 每日踩到機率 > severity 標籤）

| # | 嚴重度 | 面向 | 標題 | 檔案:行 | 為何優先 | 建議修法 |
|---|--------|------|------|---------|----------|----------|
| 1 | HIGH ✅ | clinical-ai | 藥物交互作用查詢吞掉所有例外 → 靜默回 0 筆、無 log | `backend/app/routers/medications.py:282-283` | 任何 DB/查詢例外都讓臨床端看到「無交互作用」＝看似安全的 false-negative | 把 `except Exception: interactions=[]` 改成 `logger.exception(...)` 並回傳「檢查失敗」狀態而非空陣列 |
| 2 | HIGH ✅ | correctness | 檢驗值校正靜默還原（JSONB in-place 未追蹤、無 commit）| `backend/app/routers/lab_data.py:441-455` | 醫師校正後 API 回成功、畫面顯示新值，重整後復原；**兩個 reviewer 獨立發現** | 對 category JSONB 欄位用 reassignment（`new=dict(category_data); new[item]=...; setattr(lab,_col,new)`）或 `flag_modified(lab,_col)`；確認走 commit-on-exit |
| 3 | HIGH ✅ | clinical-ai | 後續回合 LLM 看到**過期用藥** snapshot，但 conflict/citation 用**最新**用藥清單 | `backend/app/routers/ai_chat.py:464-499,521-542` | session 中途加/停藥對模型隱形，模型可能自信討論已停藥或漏掉新上的高警訊藥 | `build_delta` 加入用藥清單 diff，或每回合用 fresh 清單重建 [用藥] 段注入 user_message |
| 4 | HIGH ✅ | correctness | pharmacist SOAP refine 失敗會**清掉先前已 polish 的 A/P**（落回原始草稿）| `src/components/pharmacist-soap-editor.tsx:237-284` | refine 網路失敗 → 已核可的 polished A/P 變空 → composed 落回 raw 草稿並存進 DB + 複製進 HIS | refine 不要在 line 238 預清空；失敗時 catch 還原 `prior = polishedSoap[key]` |
| 5 | HIGH ✅ | correctness(sec) | 改密碼 / 重設密碼 / admin 設密碼**不撤銷既有 session** | `backend/app/routers/auth.py:304-357,402-469` | `password_changed_at` 只用於密碼到期，未與 token `iat` 比對；既有 token 仍有效（帳號被盜重設密碼後攻擊者 session 不死） | 改密碼時把舊 token 的 jti 加入既有撤銷清單（`middleware/auth.py:144` 已有機制），或在 auth middleware 比對 `token.iat < password_changed_at` 即拒 |
| 6 | MEDIUM ✅ | clinical-ai | snapshot CrCl 用實際體重做 Cockcroft-Gault，未標示體重基準（肥胖/水腫高估→腎臟用藥不足）| `backend/app/services/patient_context_builder/formatters.py:219-302` | LLM 被要求依腎功能調劑，vanco/mero 就列在 CrCl 旁，高估 CrCl → 劑量偏高 | 有身高時用調整/理想體重；或在 CrCl 行加註「以實際體重估算，肥胖/水腫可能高估」；有 eGFR 時優先呈現 |
| 7 | MEDIUM ✅ | clinical-ai | IV 相容性**矩陣格**因後端回正規化藥名而漏顯 Incompatible | `src/components/patient/iv-compatibility-checker.tsx:219 vs 312` | 矩陣以後端正規化名為 key 寫入、以 HIS 輸入名為 key 讀取→格子落回 `-`（紅色摘要 Alert 仍會跳，故非全漏）| 寫入矩陣時用輸入名 `[a,b]` 當 key（保留 pair→status 對應），或統一 key 正規化 |
| 8 | MEDIUM ✅ | clinical-ai | 已停藥但 `end_date` 在**未來**者…→ 見 §3；多條臨床-AI false-negative 集中區 | （見 §3 各條）| 安全檢查在 HIS 資料邊界靜默不觸發 | 見 §3 |
| 9 | HIGH ✅ | correctness | SOAP 複製到 HIS 用**過期** polished A/P，僅軟性視覺 badge 不強制 | `src/components/pharmacist-soap-editor.tsx:325-375,620-632` | 編輯來源 A/P 後未重 polish 就 Save&Copy → 舊 polished 寫入病歷+HIS | stale 時 disable Save&Copy 或加確認對話框（codebase 已有 template-apply 確認 modal 可參照）|

> 表中 ✅ = 已驗證（工作流對抗式驗證或我手動讀碼確認）。`#8` 為一組臨床-AI false-negative 指標，細節在 §3。

---

## 2. 臨床 AI 安全（confirmed）

決策依據：凡「錯誤/缺漏輸出可能誤導臨床對真實病人的判斷」，且 false-negative（漏掉真實訊號）優先於 false-positive。

- **`meds-1` ✅ HIGH** — 藥物交互作用 router `except Exception: interactions=[]`（medications.py:282）吞掉所有例外，無 log。任何查詢失敗 → 臨床端看到「無交互作用」。**最高優先**。
- **`llm-1` ✅ HIGH** — 後續回合 system_prompt 由 session 建立時凍結的 snapshot 重建（ai_chat.py:474）；`build_delta` 只比 6 個數值 lab、且 >30 分鐘才觸發，**完全不 diff 用藥清單**；同回合 conflict/citation 卻用 fresh 用藥。中途加/停藥對模型隱形。
- **`fhir-1` ✅ MEDIUM**（storage 確認）— comparator 檢驗值（PCT `>100`、TSH `<0.005`、D-dimer）`float()` 失敗存成字串（converter.py:499-503）；下游 `_get_lab_val`（lab_values.py:82）`float(raw)` 例外即 `return None` → 這些值對數值/門檻/delta 機制隱形（PCT>100 敗血訊號不會被標異常）。（需再確認顯示文字段是否也丟棄。）
- **`svc-2` ✅ MEDIUM** — `_merge_lab_rows`（repository.py:46-95）保留最新列 timestamp，但各項目從最多 50 列中最近一筆填入，**無絕對時間上限、無 per-item「as of」**。數天前的值可能掛在今天的時間戳呈現給 LLM。
- **`svc-1` ✅ MEDIUM** — 使用者「否定用藥」衝突偵測只用 `m.name`（observability.py:242），citation alias 卻用 name+generic_name。臨床用學名否定（snapshot 顯示的就是學名）可繞過此安全偵測。
- **`bsc-2` ✅ MEDIUM** — 重複用藥 L4 子集抑制（detector.py:390-413）**純依成員集合、且在 `_l4_level` 算 severity 之前執行**，severity-blind：critical 子集警示可能被較低 severity 的超集吃掉。部分為刻意設計（超集承載訊號），但 severity 盲性是真實漏洞 → 抑制時應保留最高 severity。
- **`scores-1` ✅ MEDIUM**（降自 high）— 分數趨勢 `.order_by(timestamp.asc()).limit(hours*4)`（scores.py:198）：截斷時回**最舊**列，且 `hours` 只當筆數上限、非時間視窗。pain/RASS 量通常不會超過上限，故實務有限。
- **`ac-3` / `fl-1` ✅ LOW**（降自 medium）— 無 active 藥時 `formatMedicationsForPaste` 回退列出**所有** status 的藥卻仍掛標題「Current meds:」（format-for-paste.ts:104）。需「零 active 藥但有停用/historical 藥」才觸發（ICU 少見）。
- **`llm-2` ✅ LOW**（降自 medium）— citation 稽核只嚴格驗 [用藥]，[關鍵檢驗]/[生命徵象]/[影像報告] 的引用只計數不驗值（citation_audit.py:140-142）；稽核僅記 log 不阻擋，prompt 本身有禁造假規則 → 觀測覆蓋缺口而非即時安全控制。

---

## 3. 正確性 Bug（confirmed）

- **`lab-1` / `bsc-1` ✅ HIGH** — 見 §1 #2（兩 reviewer 獨立發現）。
- **`br-1` ✅ HIGH** — 見 §1 #5（密碼變更不撤 session）。
- **`ac-2` ✅ HIGH** — 見 §1 #4（refine 失敗清掉 polished A/P）。
- **`hf-1` ✅ MEDIUM** — HIS sync delta-toast：首輪遇空 ring buffer 時 cursor 設 null 卻標記 initialized，之後有 delta 那輪 `previousDeltaAt? filter : recentDeltas` 走 falsy 分支→**整個 backlog（至多 50 筆）一次全 toast**（use-external-sync-polling.ts:74-95）。修：`else if` 加 `previousDeltaAt != null` 守衛，否則靜默推進 cursor。
- **`llm-4` ✅ LOW** — `m.unit` 為空時用藥劑量渲染成無單位數字（formatters.py:574-585）；HIS `DOSE_UNIT` 缺漏時觸發。
- **`fhir-3` ✅ LOW** — `_extract_dept_doctor` fallback 用 `ipd_rows[0]`（最舊）而 diagnosis/admission 用 `ipd_rows[-1]`（最新）→ 病人多筆住院時 header 主治/科別與診斷/日期不一致（converter.py:243-248；僅無住院醫囑時觸發）。
- **`hf-2` ✅ LOW**（降自 medium）— `useTrendChart` fetch 無 cancellation guard（use-trend-chart.ts:71-113），快速切換指標時舊回應可覆蓋新指標資料 → 標題與曲線不符。低機率、可自我修正。
- **`hf-3` ✅ LOW** — 臨床分數記錄 fire-and-forget，失敗時成功 toast/趨勢不開（use-patient-scores.ts），但全域 axios interceptor 仍會跳通用錯誤 toast，故已部分緩解。

---

## 4. 架構 / 技術債（passthrough，未對抗式驗證）

- **`fhir-2` MEDIUM** — 兩條 HIS 匯入路徑分歧：手動 `import_his_patients.py` 用 upsert（**不刪除消失的舊列**），production serial sync 用 replace（DELETE+INSERT）+ reconcile_medications。用錯腳本 → 殘留過期 lab/culture/report、且無 delta/sync_status 更新。CLAUDE.md 兩者皆列為可用 → 建議手動腳本改呼叫 `sync_snapshot_into_session` 或降級為 dry-run。
- **`mw-2` LOW** — 多個 `*Response` schema 宣告 `from_attributes=True` 但欄位是 camelCase、無 alias，ORM（snake_case）→ 若未來接 `response_model` 會靜默把臨床欄位序列化成 null。目前是 dead code（皆手刻 dict）→ 刪除或補 alias_generator。
- **`br-4` LOW** — team-chat `mark_read` 的 recipient gate 註解聲稱守護全域 `is_read` 副作用，但已無查詢讀取 `TeamChatMessage.is_read`（皆改 per-user `read_by`）→ 註解過時 + dead write。

---

## 5. 已驗證但降級 / 低風險（摘要）

`llm-3`(medium, CrCl 體重基準, §2 #6)、`ac-4`(medium, 過期 SOAP, §1 #9)、`iv-1`(medium, IV 矩陣, §1 #7) 已列前段。其餘低風險見 §2/§3 標 LOW 者。

---

## 6. 待人工 / 補驗證（reviewer 回報，因 rate limit 未完成對抗式驗證）

> 這些是被丟棄、我尚未逐條讀碼確認的 reviewer 發現。建議 **1:40am 限額重置後** 用 `resumeFromRunId`
> 補跑驗證（review 階段已 cache、瞬回，只重跑 verify+synthesis）。其中數條是臨床-AI false-negative，
> 值得優先人工確認：

**臨床-AI false-negative（高度建議人工確認）**
- **`ac-1` (high)** — 獨立 `/ai-chat` 頁面**漏掉** patient-detail chat tab 會顯示的資料新鮮度 / 退化回覆警示（chat-message-thread.tsx:139-250）。
- **`micro-1` (medium)** — 培養報告同時有真實病原 + 正常菌叢時被歸類為「normal flora」，**壓掉病原**（patient-microbiology-card.tsx:11-25,467-476）。
- **`bsc-3` (medium)** — ICU 出血紅旗（治療劑量 heparin + 預防 LMWH → critical）因 HIS 病人 `patient.unit` 為空而**永不觸發**（safety.py:305-317）。
- **`svc-4` / `bsc-4` (medium/low)** — 過敏↔用藥比對只用英文關鍵字、跳過 <3 字 needle → 漏中文過敏詞與短藥名；cephalosporin 關鍵字群組不可達（safety.py:169-202）。
- **`fl-2` (medium)** — 頁內重複用藥偵測丟棄 name/genericName 無拉丁字母者（純中文藥名）→ false-negative（duplicate-overlap.ts:18-64）。
- **`clin-1` (medium)** — AI clinical-summary snapshot 只用單一最新 lab record，丟掉其他近期抽血 + 計算 Clcr（clinical.py:168-224）。
- **`intx-1` (medium)** — DB-fallback 交互作用查詢在 relevance filter **前**截斷 500 筆無排序列 → 可能漏高 severity pair（interactions.py:178-191）。

**稽核完整性 / 正確性**
- **`br-2` (medium)** — HIS sync 觸發端點變更全部病人臨床資料卻**不寫稽核 log**（admin_his_sync.py:99-182）。
- **`mw-1` (medium)** — `schedule_audit_log` 用 `asyncio.create_task` 但未保留 task ref → 稽核列可能被 GC 靜默丟棄（audit_async.py:26-58）。
- **`svc-3` (medium)** — 72h 用藥變動 prefetch 把 `end_date` 在未來的 active 藥誤標「停用/結束」呈現給 LLM（ai_question_prefetch.py:571-583）。
- **`lab-2` (low)** — `correct_lab_data` 未以 path `patient_id` 限縮 lab 列 → 稽核可能記錯病人（lab_data.py:412-453）。
- **`br-3` (low)** — patient-board `mark_message_read` 忽略 `patient_id` path 參數，無 scope 檢查（messages.py:629-655）。
- **`ddi-1` (low)** — DDI 品牌名比對在唯一呼叫點是 dead → 每個藥都顯示「不在病人清單」（drug-interaction-badges.tsx:204-318）。
- **`pad-1` (low)** — PAD 計算器靜默 clamp 超範圍劑量並用 clamped 值算速率（pad-dosage-calculator.tsx:261-289）。
- **`util-1` (low)** — `format_duplicate_metadata` docstring 與程式矛盾（moderate 現已保留，P1-D6）（duplicate_check.py:55-86）。
- **`clin-2` (low)** — `_pair_on_different_sides` 假設 `interacting_members` 只會是 list，dict 格式會 raise（clinical.py:862-883）。
- **`ac-5` (low)** — `getDisplayFreshnessHints` 在任一 section hint 觸發時連帶壓掉後端 hint（含 missing_fields）（patient-detail-utils.ts:51-83）。
- **`fhir-4` (low)** — ventilator-days 用 `_load`（單院區）而其他轉換器用 `_load_all` → 跨院區 D3 醫囑漏掉（converter.py:915-917）。
- **`fl-3` (low)** — lab 貼上新鮮度 gate 只看 snapshot 層級時間戳、非 per-item（format-for-paste.ts:57-82）。
- **`fl-4` (low)** — advice accept-rate 分子計入分母已知類別外的紀錄（advice-stats.ts:59-81）。

---

## 7. 覆蓋率與盲區

| 子系統 | 讀檔數 | 備註 / 盲區 |
|--------|--------|------------|
| backend/routers · clinical | 16 | 未深入 DuplicateDetector 內部（屬另一單元）；未讀 TASK_PROMPTS |
| backend/routers · platform | 13 | 逐 route 驗 authz；out-of-scope router 僅確認邊界 |
| backend/services · clinical | 15 | detector/matching/stacking 全讀；未跑測試套件 |
| backend/services · platform | 24 | ai_chat / citation / conflict / context_builder / detector 全讀 |
| backend/llm（AI 核心）| 16 | llm 套件 + prompt_assembly + snapshot + citation 全讀；duplicate 內容保真屬另一單元 |
| backend/fhir（HIS sync）| 13 | 對照真實 HIS reference JSON；未讀 rxnorm/bundle_builder/資源 CSV |
| backend/models+schemas+mw+utils | 40 | **全讀**；資料層紀律佳 |
| frontend/pages | 22 | ⚠️ coverageNote 僅回「test」，且 findingCount=0 —— **此單元品質存疑，建議重審** |
| frontend · ai-chat + records | 12 | 核心檔全讀；patient-detail.tsx chat 編排未深讀（屬 pages） |
| frontend · clinical UI | 19 | 高臨床風險檔聚焦；shadcn primitives 僅確認無臨床邏輯 |
| frontend/lib | 38 | 主要 client + cache + clinical 全讀；數個 thin CRUD client 未開 |
| frontend · hooks+features+i18n | 18 | hooks 全讀；i18n 用程式化 flatten+diff 比對，parity 乾淨 |

**已知盲區 / 後續建議**
1. ~~`frontend/pages` 單元 coverageNote = 「test」~~ → **Round 2 已重審**（§8）。
2. ~~約 20 條 reviewer 發現未對抗式驗證~~ → **Round 2 已補完**（§3 + §6）。
3. DuplicateDetector ATC 分群的 false-negative 未由獨立單元交叉驗證（各單元都標為「out of scope」）。
4. comparator-lab（`fhir-1`）的**顯示文字段**是否也丟棄字串值，尚未逐行確認（數值/門檻路徑已確認丟棄）。

---

## 8. frontend/pages 重審（Round 2，取代原「test」垃圾結果）

重審 29 檔（pages + pharmacy/ + admin/ + workstation/），對抗式驗證 7 confirmed、1 refuted：

| # | 嚴重度 | 面向 | 標題 | 檔案:行 | 驗證 |
|---|--------|------|------|---------|------|
| `pg-1` | HIGH | clinical-ai | IV 相容性矩陣只取 `rows[0]`，多溶液（NS 相容/D5W 不相容）的不相容結果被藏 | `src/pages/pharmacy/compatibility.tsx:287-308` | ✅ confirmed（降 medium）|
| `pg-6` | MEDIUM | correctness | 交互作用摘要對「目前（可能已編輯）藥單」重算，與已顯示結果脫鉤 | `src/pages/pharmacy/interactions.tsx:391-497` | ✅ confirmed |
| `pg-2` | MEDIUM | correctness | team-chat cache-hit 分支未設 `hasMore` → 無法載入更舊訊息 | `src/pages/chat.tsx:110-136` | ✅ confirmed |
| `pg-3` | MEDIUM | correctness | team-chat 30s 輪詢用最新 50 筆整碗覆蓋，已載入的舊歷史被丟 | `src/pages/chat.tsx:121-129,213-237` | ✅ confirmed |
| `pg-4` | MEDIUM→low | clinical-ai | dashboard fallback 真實算 intubation/SAN 但把用藥指標硬寫 0（目前未渲染，latent） | `src/pages/dashboard.tsx:134-150` | ✅ confirmed |
| `pg-7` | LOW | correctness | patient-detail regenerate 略過 adviceRefs、不刷新 graphMeta | `src/pages/patient-detail.tsx:1169-1195` | ✅ confirmed |
| `pg-8` | LOW | correctness | discharged-patients 分頁是 server-side 但 search/date/physician filter 只作用於當頁 | `src/pages/discharged-patients.tsx:148-160,428-440` | ✅ confirmed |
| `pg-5` | ~~medium~~ | — | PAD dose-range 只 split en-dash | `src/pages/pharmacy/workstation.tsx:568-588` | ❌ **refuted**（經查有處理）|

> `pg-1` 與 §1 的 `iv-1` 是**同一類** IV 相容性 false-negative（一個在 patient 元件、一個在 pharmacy page）——
> 修 IV 相容性時兩處一起改（worst-case：任一溶液不相容 → 整格標不相容）。

---

*產出：DRUGPilot/ChatICU 全 codebase review · 2026-06-03 · Round 1 `wf_b0a98b24-53f`（56 agents, 1.74M tok）
+ Round 2 修復/驗證/回歸測試（pages `wf_fd8a94b2-e70`、dropped `wf_cd084f0a-89a`）*
