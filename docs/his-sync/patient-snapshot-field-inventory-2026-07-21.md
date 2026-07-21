# HIS 病人快照 — 資料欄位盤點 + 重複／異常對照

> 對象：`patient/{MRN}/20260721_161451/ALL_MERGED.json`（10 位 ICU 病人，各 1 個 snapshot，同一時戳）
> 方法：確定性全掃（全 10 病人 × 全來源 × 全列）+ 5 域獨立 agent 對抗式驗證（24 CONFIRMED / 1 PARTIAL / 0 REFUTED）
> 產出日：2026-07-21。與 [`patient/資料使用手冊.md`](../../patient/資料使用手冊.md) 第 6 節「資料項目完整清單」互補（本文加上「真 key」與「異常/坑」層）。

---

## 0. 規模

| 項目 | 數字 |
|---|---|
| 病人 / snapshot | 10 / 各 1（時戳 `20260721_161451`） |
| ALL_MERGED 大小 | 300 KB – 2.4 MB（因病史長度差 8 倍） |
| 頂層 key | 32–38（因病人事件不同而異） |
| 主要來源 | **25 個**（+ 4 組 `ExtraFactories_Factory_{F,G,H,Q}_*` 冗餘/跨院區） |
| 核心量體 | lab 7,604 列、醫囑 3,678、藥囑 1,721 |
| 編碼 | UTF-8（無 BOM）；日期一律**民國7碼**（`1150126`=2026-01-26） |

**健全性底線（確定性證明）**：0 筆整列 exact-duplicate、0 筆欄位型別衝突、子檔與 ALL_MERGED 逐值一致（僅 `getIpd_2.json→getIpd` 命名差）、10 位 PAT_NO 全對得上資料夾、0 筆 END<START、0 筆負劑量。

---

## 1. 完整欄位清單（25 個主要來源）

存在率 = 出現在幾 / 10 位病人（缺席多半是「該病人沒這類事件」，非資料遺失，見 §5）。

### 病人 / 人口學
| 來源 | 存在 | 欄位 |
|---|---|---|
| **getPatient** | 10/10 | PAT_NO, PAT_ID*, PAT_NAME, SEX, BIRTHDAY, ADDRESS1, ADDRESS2, CELLPHONE, PHONE_NO_H, BLOODTYPE_LAB, BLOODTYPE_LAB_RH, DEAD_DATE, DNR_CONSENT, DNR_IC_FLAG |
| **sbBasic** | 10/10 | PAT_NAME, SEX, BIRTHDAY, BLOODTYPE_LAB(_RH), IPD_DATE/TIME, DR_CODE/NAME, NURSE_ID/NAME, MAINCARE(_NONE/_OTHER), LANGUAGE, DNR_FLAG, DNR_DATE, SHIFT_SW, PAT_SEQ |

`*PAT_ID` = 身分證號（`U100244260`…），與 PAT_NO 是**不同識別碼**，非錯誤。

### 檢驗 Lab（真 key 是 `LAB_CODE`，不是 `ITEM_CODE` — 見 §2/§4-L）
| 來源 | 存在 | 欄位 |
|---|---|---|
| **getLabResult** | 10/10 | ITEM_CODE, ITEM_NAME, **LAB_CODE, LAB_NAME**, RESULT, UNIT, LOW_LIMIT, HIGH_LIMIT, RES_SW, RES_COMMENT, REPORT_DATE/TIME, SIGN_DATE/TIME, SEQ_CODE, SHEET_NO, REP_TYPE_CODE/NAME, HDEPT_CODE/NAME, ODR_CODE, PAT_NO |

### 藥囑 / 醫囑 / 手術
| 來源 | 存在 | 欄位 |
|---|---|---|
| **getAllMedicine** | 10/10 | DRUG_NAME, ATC_CODE, NHI_CODE, ODR_CODE/NAME/SEQ, DOSE, DOSE_UNIT, FREQ_CODE, ROUTE_CODE, DAYS, TOTAL_QTY, EPO_QTY, START_DATE, END_DATE/TIME, CREATE_DATE/TIME, DC_FLAG, LONG_TYPE, OPD_SW, NOTES, HDEPT_CODE/NAME, USER_NAME, PAT_NO, PAT_SEQ |
| **getAllOrder** | 10/10 | ODR_CODE/NAME/SEQ, MAJOR_CLASS, ISEXECUTE, DC_FLAG, URGENT_FLAG, START_DATE/TIME, CREATE_DATE/TIME, PRE_EXEC_DATE, TOTAL_QTY, PRICE_UNIT, NOTES, SHEET_NO, OPD_SW, USER_NAME, PAT_NO, PAT_SEQ |
| **getSurgery** | 2/10 | **OP_ODR_CODE1**（5碼NHI術式碼，非ICD）, ODR_NAME, IN_OR_DATE, DR_CODE/NAME, HDEPT_CODE/NAME, CONTENT_TEXT, PAT_NO |

### 住院 / 門診 / 診斷（`getIPD` ≠ `getIpd`，只差大小寫，兩個不同來源 — 見 §4-D）
| 來源 | 存在 | 欄位 |
|---|---|---|
| **getIpd**（本次住院, ICD 內嵌中文） | 10/10 | ICD_CODE1..10, IPD_DATE, REAL_OUT_DATE, REG_SEQ, SECT_NO, NOON_CODE, DR_NAME, HDEPT_CODE/NAME, OPD_SW, PAT_NO, PAT_SEQ |
| **getIPD**（出院病摘, 純碼, **僅5格**） | 5/10 | CONTENT_TEXT, OUT_ICD_CODE1..5, IPD_DATE, REAL_OUT_DATE, DR_CODE/NAME, HDEPT_CODE/NAME, PAT_NO, PAT_SEQ |
| **getOpd**（門診, ICD 內嵌中文） | 7/10 | ICD_CODE1..10, REG_SEQ, SECT_NO, NOON_CODE, DR_NAME, HDEPT_CODE/NAME, OPD_SW, PAT_NO, PAT_SEQ |
| **getAIResult**（AI 報告） | 9/10 | REPORT_CONTENT, REPORT_DATE/TIME, SHEET_NO, SHEET_ITEM_SEQ, PAT_NO, PAT_SEQ |
| **getSO_AllPatientSeq**（本人多次就診序列） | 7/10 | Tool, PatientId, HospId, PatientSeqList, IncludedPatientSeqList, Responses |

### 床位 / 排程
| 來源 | 存在 | 欄位 | 注意 |
|---|---|---|---|
| **getICUbed** | 10/10 | BED_CODE, PAT_NO, PAT_SEQ | **含全 10 位 cohort 病人 MRN**（§6） |
| **GetNurseGroup** | 10/10 | GROUP_CODE, NSW_CODE/NAME, USER_NAME, S_DATE, E_DATE | |

### 護理紀錄 sb*（多為 `M01100` 病房碼巢狀）
| 表單 | 存在 | 欄位 |
|---|---|---|
| **sbNurse** | 10/10 | SHIFT_SW, USER_ID, USER_NAME |
| **sbDisease**（過敏/病史） | 10/10 | FOOD_ALLERGY(_NONE/_OTHER), PAST_HISTORY(_NONE/_OTHER), SURGERY_HISTORY_NONE/_OTHER, TUMOR_HISTORY |
| **sbNutrition** | 10/10 | BODY_HEIGHT, BODY_WEIGHT, BMI, MUST, INTAKE_HABIT(_OTHER), KND1_CODE, KND_NAME, BEG_DATE, END_DATE |
| **sbFall** | 10/10 | TOTAL_SCORE（**非 Morse**，§4-N）, CREATE_DATE/TIME |
| **sbPain** | 10/10 | PAIN_NUMBER, CREATE_DATE/TIME |
| **sbIO** | 10/10 | AMOUNT, IO_DATE, STATUS_SW(_NAME) |
| **sbLimit**（約束） | 10/10 | FMS_ORD_SW, FMS_ORD_DATE/TIME, FMS_ORD_TXT |
| **sbTube**（管路） | 10/10 | PIPELINE_CODE, PART_SUB_CODE/NAME, PIPE_ALIASES, PIPE_SIZE, PIPE_DEPTH, PIPE_MATERIAL_SW(_OTH), CUFF_PRESSURE, BALLOON, PUT_DATE/TIME, END_DATE |
| **sbWound** | 6/10 | MULTI_KEY(_NAME), MULTI_VALUE, PART_PRI_NAME, PART_SUB_NAME, SEQ_CODE, CREATE_DATE/TIME |
| **sbDischargeEval** | 6/10 | TOTAL_SCORE, LEVEL_SW, CREATE_DATE/TIME |
| **sbExam** | 3/10 | FORM_NAME, ODR_CODE/NAME/SEQ, ODR_NOTES, PRE_EXEC_TIME |
| **sbConsult** | 1/10 | CONS_DEPT_CODE, HDEPT_NAME, CREATE_DATE/TIME, REPLY_DATE/TIME, REPLY_DR_CODE, USER_NAME |

---

## 2. 正確的識別鍵（誤用 = 資料錯亂）

| 資料 | ✅ 正確 key | ❌ 常見誤用 |
|---|---|---|
| 檢驗分析物 | **LAB_CODE**（299 個，1:1 對 LAB_NAME） | `ITEM_CODE`（僅 48 個，是**檢體/套組群組**，一個混 23 種分析物）；`ITEM_NAME`（只是"Blood"/"Sputum"檢體別） |
| 檢驗顯示名 | LAB_CODE | `LAB_NAME`（39 個名對到 >1 code，如 RBC=血液/尿液/體液 3 種不同單位） |
| 藥物 | **ODR_CODE** 或 ATC_CODE(.strip()) | `NHI_CODE`（15 列為 null）；`ATC_CODE` 原值（27 列類階、22 列尾空白） |
| 一列檢驗結果 | 需 (SHEET_NO, LAB_CODE, **列位置/菌株**) | `SHEET_NO+LAB_CODE`（**42 組碰撞**，多菌株 sheet） |

---

## 3. 重複性分析

| 型態 | 結論 |
|---|---|
| 整列 exact-duplicate | **0**（全來源、全病人） |
| `ExtraFactories_*_getPatient` | **Data 逐位元 = primary getPatient**（純冗餘）；僅外層 response DateTime 每院區不同 → 物件級 hash dedup 會誤存 5 份，要對 Data 去重 |
| `ExtraFactories_*_getLabResult` | 多為 2–3 列 `{"message":...}` **空殼**（非重複、非資料） |
| `ExtraFactories_*_getICUbed` | **其他病房**的床位圖（14–19 床，非本 cohort 病人）— 不是重複，是別床名單 |
| 同 DRUG_NAME 多筆 active | ICU 連續開立正常（NaCl×28=連續點滴），每筆 SEQ/日期不同，非重複錯誤 |
| `(SHEET_NO, LAB_CODE)` 碰撞 | **42 組、值全不同**（多菌株抗藥性）— 不是重複，是同 sheet 多菌株，見 §4-L1 |

---

## 4. 異常 / 陷阱對照（依嚴重度，全部已對抗式驗證）

### Lab
- **【高·臨床安全】L1 多菌株抗藥性無菌株連結**：同一 sheet 培養 ≥2 菌株時，同一抗生素出現衝突的 S 與 R，且抗生素列**沒有任何欄位指回它的菌株**（菌株只以 pseudo 列 `LAB_CODE=XORG1/XORG2` 標記，RES_COMMENT 全 null，SEQ_CODE 相同，區塊交錯）。全 cohort 20 張 sheet ≥2 菌株，**617 筆 S/I/R 中 308 筆（50%）落在這種模糊 sheet**。以 `LAB_CODE→RESULT` 建抗藥表 = last-write-wins，可能把某菌報成對某藥「感受性」而其實「抗藥」。例：50080536 sheet M11506L023229（Serratia + Chryseobacterium）AN/CAZ/FEP/GM/IPM 全同時 R 又 S。
- **【高】L-key `(SHEET_NO,LAB_CODE)` 非唯一**：42 組碰撞、值全不同（如 30546132 Levofloxacin 同時 S/R）。用此 key upsert 會**靜默丟掉一菌的抗藥結果**。
- **【高】L2 分析物粒度**：真 key 是 LAB_CODE(299)，非 ITEM_CODE(48)。ITEM_CODE `BD03` 混了 Hb/RBC/WBC/PLT/MCV… 23 種分析物 → 對 ITEM_CODE 做 float/參考值 = 拿 Hb 比 WBC 的區間。**所有 lab 分析必須改 key 到 LAB_CODE**。
- **【中】L3 RESULT 是混型欄位**：數值 + 設限(`<3`) + 半定量(`4+`/`Trace`) + 微生物文字(`No growth`/`S`/`I`/`R`/`痰液`) + 培養代碼(`13010`) + 鏡檢範圍(`0-5 /HPF`)。`RES_SW` **不是**乾淨的數值開關（`SP` 只 44% 數值、`N` 86%、`A`/`X` 0%，僅 H/L/LL/HH 100% 數值）。**永遠逐列試 float parse 再分流**。
- **【中】偽分析物污染 RESULT**：18 個 `3xxx/Xxxx` 前綴 pseudo 列（`3BIL1`帳務→吐 13009/13010/13023、`3SAM1`檢體別→痰液、`XORG1/2`菌株、`3COL`菌落、`XPERT`GeneXpert…）。做數值統計前**先濾掉 3xxx/Xxxx 前綴**，否則 max/min 被帳務碼污染。
- **【中】LAB_NAME 合併陷阱**：39 名對多 code（RBC/WBC 各對 3 種檢體、eGFR 4 種性別變異、Na=`9021/9021E`）。用 LAB_NAME 合併會把血球 RBC(10⁶/µl) 混進尿沉渣 RBC(/HPF)。
- 參考區間：以 LAB_CODE 為 key 後，只有 18/299(6%) 有 >1 區間，且全是合法**性別參考值**（Hb 女10.8-14.9/男13.2-17.2 等）— 逐列讀區間僅性別分析物需要，非全面漂移。

### 藥物 / 醫囑
- **【高】DC_FLAG 是三態**（getAllMedicine：`N`918/`Y`642/**null 161**）：null 列必同時 END_DATE=null，是**居家/長期用藥核對列**，非缺漏。用 `DC!='Y'` 篩 active 會混入 161 列；用 `DC=='N'` 會丟掉 161 列 — **兩者都錯**。逐病人 null 數 0–48。
- **【中】DC_FLAG 跨來源不一致**：getAllOrder 是兩態（`N`3373/`Y`305，**無 null**），getAllMedicine 三態。共用 DC 處理碼不能假設同一 vocab。
- **【中】LONG_TYPE = {0,2,3}（無 1）**：值 2/3（共46列）**只**出現在 DC=null+END=null 的居家/長期藥（如 Spiolto、Glucophage）。當布林旗標會多算 active。
- **【中】NHI_CODE 15 列 null**（Lidocaine/Rocuronium/Sugammadex 等處置用藥/OTC）— 全有合法 ATC。**別用 NHI_CODE 當 join key**，改 ODR_CODE/ATC_CODE。
- **【中】ATC_CODE 未正規化**：27 列類階（5碼非葉，如 `D06AX`）、22 列尾空白（`D06AX  `）。精確比對前先 `.strip()` 且容忍 5 碼。
- **【低】route `XX`**（2列）= Heparin 導管封管的良性 sentinel，非壞資料（要 special-case，非投藥途徑）。
- **【低】EPO_QTY 全 corpus 100% null** = 死欄位（無害，別在上面建邏輯）。
- **【資訊】TOTAL_QTY 不可當發藥量**：藥 27 null+111 zero、醫囑 651 null。別盲加總。

### 診斷 / ICD
- **【高】雙格式是「由來源決定」**：`getIPD` = 純碼（38/38）、`getIpd`+`getOpd` = **碼+中文名**（如 `C20` vs `C20直腸惡性腫瘤`），零例外。**跨來源字串比對（住院↔出院 dx）會 0 命中** → 需先切碼。實際只 **77 個 ICD 碼**（`資料使用手冊`的「102」是含中文的原始字串數）。
- **【高】切碼 regex 必須 start-anchored**：中文名內嵌 ASCII（`I21.4非ST段上升…（NSTEMI）` 內含 ST/NSTEMI、`I10本態性(原發性)…` 內含括號）。`re.findall('[A-Z0-9.]+')` 會吐假碼。正解 `^([A-Z][0-9]{2}(?:\.[0-9A-Z]+)?)`，其後首個 CJK 起為名。
- **【中】傷害碼有 `X` 佔位在中段**（`S06.0X0A`/`S80.02XA`/`S00.03XA`）+ 7碼尾 `A`。純數字 subclass 驗證器會誤退；subclass 要容 `[0-9A-Z]`。
- **【中】getIPD 診斷結構性上限 5 格** vs getIpd 10 格 → 出院 dx 清單可能比住院短（如 30546132 住院7 vs 出院5）。要完整 dx 用 getIpd。
- **【中】術式在 getSurgery.OP_ODR_CODE1**（5碼純數字 NHI，如 `64029`），**未混入 ICD 欄**；但別餵給 ICD 驗證器（無字母前綴會被判 malformed）。
- **【低】Z/R 碼可為唯一診斷**：50669055 只有 `Z99.11呼吸器依賴`、61203771 只有 `I63.9腦梗塞`。濾掉 Z/R 會讓這兩位 dx 清單變空。

### 人口學 / 護理 / DNR
- **【高】DNR_FLAG 是死欄位**：`sbBasic.DNR_FLAG` 與 `getPatient.DNR_IC_FLAG` 全 10 位皆空，**包含 5 位有簽署 DNR 的病人**。唯一可靠 DNR 訊號 = `DNR_DATE` 非空 **或** `DNR_CONSENT` 非 null。誤讀 DNR_FLAG 會把 5/10 已簽 DNR 病人全判為非 DNR。
- **【中】DNR_CONSENT 是 5-tuple 且含兩個日期**：`type,consentDate(民國7),staffCode,entryTS(民國13),itemFlags`。**只有 field[1]** 對得上 `sbBasic.DNR_DATE`；抓 field[3] 時間戳當 DNR 日會差 1 天～9 個月。
- **【中】sbFall.TOTAL_SCORE 非 Morse**（全 10 位為 4–6，是風險因子計數）。套 Morse 門檻(≥45 高風險)會把全部臥床多管 ICU 病人判成低跌倒風險 = 反了。
- **【中】`SURGERY_HISTORY_NONE` 名實相反**：值為 `有`(6/10，代表**有**手術史)/`無`(3)/None(1)。當「is-none」布林讀會把 6 位有手術史判成無。
- **【中】三個 `*_NONE` 三種編碼**：`PAST_HISTORY_NONE`=全 None（沒用）、`SURGERY_HISTORY_NONE`=有/無/None（中文字面）、`FOOD_ALLERGY_NONE`=''/None（空字串勾選）。無單一解析規則。
- **【中】FOOD_ALLERGY「無過敏」= 空字串 `''`（falsy）**：truthiness 判斷會把「確認無食物過敏」翻成「未記錄」。且 **sbDisease 完全沒有藥物過敏欄** — 藥物過敏在此域完全缺席。
- **【低】50669055 民國年跨年 + 手填 typo**：IPD_DATE=`1140924`（2025-09-24，~10 個月長住），`SURGERY_HISTORY_OTHER='2525/8/29氣切'`（不可能的 2525 年，應為 2025）。

---

## 5. 覆蓋差異 = 事件差異，非資料遺失

`getIPD 5/10`、`getOpd 7/10`、`getAIResult 9/10`、`getSurgery 2/10`、`sbConsult 1/10`、`sbWound 6/10`、`sbExam 3/10` 的缺席經三來源交叉佐證為「該病人沒此事件」：{30894771, 50669055, 61203771} 同缺 getOpd+getSO+getIPD，且其 getIpd PAT_SEQ = M01001/M01002/M01001（該院區首/次就診）→ 一致的「首次入院」訊號。**注意**：`getIPD 5/10` 不代表 5 位缺住院紀錄 —— 本次住院碼在 `getIpd`（10/10 皆有），getIPD 是「先前出院病摘」。

---

## 6. 跨院區資料 & 隱私 scope（load-bearing）

- **【高·資料完整性】跨院區資料是 2 位首入院病人的唯一病史**：30894771 primary 只有本次 4 天（seq M01001），但 `Factory_Q` 有 48 藥/147 lab/86 醫囑/15 門診、跨 ~6 個月、**PAT_SEQ 零重疊**；61203771 primary 只有 5 天，`Factory_H` 有 31 藥/97 lab、跨 ~4 個月。**只讀 primary key 的消費端會把這兩位當全新入院、丟掉 4–6 個月自己的病史。**（第 3 位 68073820 的 Factory_H 是 stub：0 藥/5 lab，可忽略 → 風險非三位均等，只 2 位嚴重。）
- ExtraFactories = 同院**分院**（PAT_SEQ 前綴 M/Q/H/F/G、床位 MICU/FICU/GICU/HICU/Q03I），共用一個院級 MRN，非不同醫院。
- **【中·隱私】`getICUbed` 每份單人 snapshot 都含全 10 位 cohort 病人的 MRN+PAT_SEQ**（同一份 MICU 10 床圖）。只洗掉資料夾 MRN 的去識別會留下另外 9 個活 MRN。
- **【中·隱私】`ExtraFactories_*_getICUbed` 另外洩漏 67 個非 cohort 病人 MRN**（4 個別病房床位圖）。以 cohort 10 碼為範圍的隱私掃描抓不到這 67 個。
- **【資訊·澄清】`getSO_AllPatientSeq` 不洩漏他人**（名字誤導）：是**本人**多次就診 SOAP 序列，7/7 present 的 PAT_NO 全 = 資料夾 MRN。（`PatientSeqList` ⊃ `IncludedPatientSeqList`：前者列全部就診序、後者只列真有抓到 SOAP 的。）

---

## 附：日期編碼

全臨床日期 = 民國 7 碼 `YYYMMDD`（`1150126` → 民115=2026 → 2026-01-26）；BIRTHDAY/DNR_DATE 同。DNR_CONSENT 內含民國 13 碼時間戳。**87 筆「未來日期」= 計畫性醫囑 END_DATE / 隔日 PRE_EXEC，非錯誤**（snapshot 07-21，藥囑排到 07-24）。年齡分布 68–98 歲（全高齡 ICU）；61203771 98 歲、BMI 11.3（惡病質，dx `R64` 相符，內部自洽）。
