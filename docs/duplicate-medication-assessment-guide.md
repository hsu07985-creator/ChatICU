# 重複用藥精準判斷指引（資深臨床藥師版）

> **用途**：建立「同一病人的處方／醫囑中是否存在臨床上不當的重複用藥」的精準判斷邏輯，供 ChatICU 審方模組、AI 規則引擎與臨床藥師審方使用。
> **焦點**：**臨床判斷邏輯**，不涉及健保行政規範。
> **撰寫依據**：WHO ATC/DDD 方法學、UpToDate、Lexicomp、ACC/AHA/ESC 2024–2025、GOLD 2025、GINA 2025、KDIGO 2024、ADA、APA、SCCM PADIS 2018、CDC Opioid Guideline 2022、FDA labeling、PubMed 實證文獻。
> **版本**：2026-04-23 v2.0（聚焦臨床判斷）

---

## 📊 狀態追蹤（臨床判斷指引）

> 每次 Claude 被要求處理「重複用藥」相關任務時，必同步更新此區塊。
> 關聯文件：[實作計畫](./duplicate-medication-detection-implementation-plan.md) · [串接計畫](./duplicate-medication-integration-plan.md)

**最後更新**：2026-04-23

### 指引內容 Review 狀態
- [ ] §3.1 絕對不應重複清單 — 臨床藥師最終審核
- [ ] §3.2 相對重複清單 — 臨床藥師最終審核
- [ ] §3.3 合理 multimodal 清單 — 臨床藥師最終審核
- [ ] §3.4 Level 3/4 機轉清單（P0）— 臨床藥師最終審核
- [ ] §3.4 Level 3/4 機轉清單（P1/P2）— 擴充完成
- [ ] §4 ICU 熱點 — ICU 臨床藥師最終審核
- [ ] 參考資料連結全數補齊 URL

### 版本歷程
| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-04-23 | v1.0 | 初版（含健保規範） |
| 2026-04-23 | v2.0 | 移除健保行政內容；修正 4 位 agent 指出的 14 項臨床錯誤（ATC 術語、SSRI washout、Metformin 風險、Paracetamol 上限、ICU 譫妄 PADIS、SUP REVISE/PEPTIC 等） |

---

## 一、核心定義

**重複用藥（Therapeutic Duplication）**：病人同時（或給藥區間重疊地）使用兩種以上藥品，**具有相同或相似的藥理作用、或被用於相同的治療目的**，導致**無附加療效、卻增加毒性或副作用風險**。

判定本質不是字串比對，而是回答三個臨床問題：
1. 這兩個藥的**作用標的（molecular target）** 是否重疊？
2. 合併後是否帶來**超越單用的效益**（加成、協同、覆蓋不同時段）？
3. 毒性／副作用是否**疊加**？

若 (1) 重疊、(2) 無額外效益、(3) 毒性疊加 → 屬不當重複用藥。

---

## 二、四層精準判斷框架

```
L1. 同活性成分（含不同 salt／劑型／途徑）    —— 最嚴
L2. 同 ATC 第 4 層（同 chemical/pharmacological subgroup）
L3. 同藥理機轉但 ATC 不同（例：α-blocker doxazosin + tamsulosin）
L4. 不同機轉但同生理終點（例：ACEI + ARB 均抑制 RAAS）
```

> ⚠️ **L3、L4 最常被電腦漏判，是資深與新手藥師的分水嶺**。必須靠機轉知識 + 臨床 context 捕捉。

### 2.1 ATC 結構速查（WHO 官方）

ATC 為 **5 層結構、最多 7 字元**：

| 層級 | 字元數 | 類別 | 範例 |
|------|--------|------|------|
| L1 | 1 | Anatomical main group | `A`（消化道與代謝） |
| L2 | 3 | Therapeutic subgroup | `A02`（酸相關疾病用藥） |
| L3 | 4 | Pharmacological subgroup | `A02B`（消化性潰瘍／GERD 用藥） |
| L4 | 5 | Chemical/pharm./therap. subgroup | `A02BC`（PPI） |
| L5 | 7 | Chemical substance | `A02BC01`（Omeprazole） |

### 2.2 比對與警示規則

| 比對條件 | 警示等級 | 預設行為 |
|---------|---------|---------|
| ATC L5（7 字元）完全相同 | 🔴 Critical | **Interruptive soft-stop**（強制覆寫理由，可覆寫） |
| ATC L4（前 5 字元）相同但 L5 不同 | 🟠 High | 強制藥師覆核 |
| ATC L3（前 4 字元）相同但 L4 不同 | 🟡 Moderate | 軟警示，記錄覆寫 |
| L4 不同但屬**人工維護的同機轉清單**（§3.3） | 🟡 Moderate | 軟警示 |
| L3 不同但屬**人工維護的同療效終點清單**（§3.4） | 🔵 Low | 資訊性提示 |

### 2.3 自動降級規則（避免 alert fatigue）

即使同 ATC L5，下列情境自動降級為 Moderate 並標記「可能合理」：

- **給藥途徑切換**（IV ↔ PO／PR／Topical／Inhaled）
- **Salt form 切換**（e.g., Esomeprazole sodium IV → Esomeprazole magnesium PO）
- **Overlap 時間 ≤ 48 h**（換藥過渡期）
- **一方標記為 PRN + 另一方為排程用藥**（且非同為長效）

---

## 三、藥物類別判斷表

### 3.1 幾乎必然為不當重複（🔴 Critical）

| 組合 | 機轉重疊點 | 主要風險 | 判斷要點 |
|------|------------|---------|---------|
| **PPI × PPI**（Omeprazole / Esomeprazole / Pantoprazole / Lansoprazole / Rabeprazole） | H⁺/K⁺-ATPase 不可逆抑制 | 長期併用與骨折、低鎂血症、C. diff、社區型肺炎**相關性升高**（觀察性證據，絕對風險小） | 無加成療效；換藥過渡 overlap ≤ 48 h |
| **SSRI × SSRI** | 5-HT reuptake inhibition | 血清素症候群 | 換藥原則：SSRI→SSRI 通常 cross-taper 4–7 天；**5 週 washout 僅適用於 Fluoxetine → MAOI** |
| **兩種口服 NSAID** | COX-1/2 抑制 | GI 出血、AKI、心血管事件倍增；**無加成止痛** | 局部 NSAID（生體可用率 1–7%）+ 口服 NSAID：FDA 標籤警告增加 AE 且無額外療效，視為不當 |
| **ACEI × ARB**（或加 DRI） | RAAS 雙重阻斷 | 高血鉀、AKI、低血壓（ONTARGET 2008、VA-NEPHRON-D 2013） | KDIGO 2024：**任何組合皆不建議**（蛋白尿 CKD 亦同）；HFrEF 已由 ARNI 取代此組合 |
| **Statin × Statin** | HMG-CoA reductase 抑制 | 肌病／橫紋肌溶解、肝酵素升高；**無加成 LDL 降幅** | 合併 CYP3A4 抑制劑時風險更高 |
| **口服抗凝 × 口服抗凝**（Warfarin + DOAC／兩種 DOAC） | 凝血瀑布多點抑制 | 致命性出血 | 橋接換藥需依指引（Warfarin→DOAC 需 INR gated；DOAC→Warfarin 需重疊至 INR 達標） |
| **雙長效 BZD**（Diazepam + Clonazepam） | GABA_A 正向調節 | 呼吸抑制、跌倒、譫妄 | **Beers 2023：老人所有 BZD 避免**；非老人之長效+短效 PRN 僅在短期明確必要時審慎接受 |
| **雙長效 Opioid**（MS Contin + Oxycodone CR + Fentanyl patch 同時） | µ-opioid receptor | 呼吸抑制、死亡 | **長效+短效 breakthrough 為標準照護，非重複**；須核 Morphine Equivalent（CDC 2022：>50 MME/d 謹慎、≥90 MME/d 高風險） |
| **Metformin 單方 + Metformin 複方**（e.g., + Janumet） | 同成分疊加 | **首要：GI 不良反應加劇、總日劑量超標**；乳酸中毒僅在腎不全／低灌流顯著 | 開立複方時**必須停單方**；max 2,000–2,550 mg/d |
| **雙 β-blocker** | β1（± β2）阻斷 | 心搏過緩、AV block、HF 惡化 | 換藥需 taper |
| **雙 α1-blocker**（BPH：Doxazosin + Tamsulosin） | α1 受體阻斷 | 直立性低血壓、暈厥（Doxazosin 血管作用更強） | AUA／EAU 皆不建議併用 |
| **雙 DHP CCB**（Amlodipine + Nifedipine） | L-type Ca²⁺ channel（血管） | 反射性心搏過速、水腫 | DHP + non-DHP 可合用，但 **HFrEF 禁 non-DHP（verapamil／diltiazem）**；HFrEF 僅 Amlodipine／Felodipine 可用 |
| **雙 5-HT3 止吐**（Ondansetron + Granisetron） | 5-HT3 受體阻斷 | QTc 延長 | 無加成止吐效益 |
| **雙 D2 antagonist 止吐**（Metoclopramide + Prochlorperazine / Haloperidol） | D2 阻斷 | EPS、tardive dyskinesia、NMS、QTc 延長 | — |

### 3.2 視臨床情境判斷（🟠 High — 需藥師覆核）

| 組合 | 可接受情境（需客觀條件） | 不可接受 |
|------|--------------------------|----------|
| **長效 + 短效 Opioid** | 慢性疼痛控制 + breakthrough pain（Fentanyl patch 停藥後仍釋放 17–24 h，交接必核對） | 兩種長效並用 |
| **ICS/LABA + SABA** | 控制藥 + 急救藥（GINA／GOLD 標準治療） | 兩種 SABA 長期併用 |
| **H2RA + PPI** | 客觀證實 nocturnal acid breakthrough 之病人，**PRN 睡前 H2RA**（ACG 2022 條件性建議）；規則併用 1–4 週後 60% 出現 tachyphylaxis | 常規併用 > 1–2 週、無 NAB 證據 |
| **DAPT（Aspirin + P2Y12i）** | ACS／PCI 後預設 **12 個月**（2025 ACC/AHA）；低缺血可縮短至 3–6 個月後單藥（IIa）；HBR 可 1 個月（IIb，ULTIMATE-DAPT 2024） | 超過指引期限仍雙抗 |
| **Triple inhaler（ICS + LABA + LAMA）** | GOLD 2025 Group E 且 **BEC ≥ 300 cells/μL**；或 LABA+LAMA 下仍頻繁惡化者升階 | 輕中度 COPD 常規使用 |
| **Triple antithrombotic（DAPT + OAC）** | AF + 近期 PCI，短期（1–3 個月依風險） | 長期並用 |
| **兩類抗憂鬱劑** | Treatment-resistant depression（SSRI + Mirtazapine 為最常見增強組合） | 兩 SSRI 或兩 SNRI |
| **多種 Insulin** | Basal-bolus（長效 + 餐前速效） | 兩種長效並用、兩種預混 |
| **Loop + Thiazide（sequential nephron blockade）** | 失代償 HF 短期加強利尿 | 長期併用（低鉀、低鈉、脫水） |
| **多機轉降血糖合併** | Metformin + SGLT2i + GLP-1（不同機轉、實證支持） | 兩 SU 或 SU + glinide |
| **Loop + K-sparing（Spironolactone）** | HFrEF 生存獲益 | 腎衰竭、高血鉀不監測 |

### 3.3 看似重複但屬合理 multimodal（常被誤判）

| 組合 | 為何不算重複 | 注意事項 |
|------|-------------|---------|
| 同成分不同途徑（IV → PO） | 給藥途徑切換過渡 | overlap ≤ 48 h |
| **Acetaminophen + NSAID** | 中樞 vs 周邊 COX 抑制，機轉不同；ERAS／多模式鎮痛 foundation | — |
| Paracetamol 複方（含 tramadol）+ 單方 Paracetamol | 機轉不同 | ⚠️ **必算總日劑量**：成人 FDA 上限 **4 g/d**（McNeil 自主降 3 g）；慢性肝病／飲酒者 **≤ 2 g/d** |
| 吸入 ICS + 全身 corticosteroid（急性發作短期） | 局部 vs 全身，急性 exacerbation 標準 | 脫離期限縮 |
| Loop diuretic + Spironolactone（HFrEF） | Spironolactone 為 mortality benefit，非單純利尿 | 監測 K、Cr |
| Heparin SC prophylaxis + IV Heparin bolus 於 PCI 時 | 預防性停用後改治療劑量 | 不得兩條同時輸注 |

### 3.4 系統易漏的 Level 3／Level 4 清單（需人工維護）

這些組合 ATC 不同但藥效重疊，電腦不會自動抓到：

- **α-blocker**：Doxazosin（C02CA04, HTN）+ Tamsulosin（G04CA02, BPH）→ 同 α1 阻斷
- **RAAS**：ACEI + ARB + ARNI + Aliskiren + Spironolactone（後兩者非 RAAS 主軸但影響 K/腎）
- **QTc 延長**：Haloperidol + Ondansetron + Azithromycin + Fluoroquinolone + Methadone + Citalopram ≥ 40 mg + Amiodarone（stacking risk，任兩者以上需警示）
- **血清素**：SSRI + SNRI + Tramadol + Linezolid + Methylene blue + Triptan + MAOI + Ondansetron（高劑量）→ 血清素症候群
- **抗膽鹼負荷（anticholinergic burden）**：TCA + 一代抗組織胺 + Oxybutynin + Benztropine + Quetiapine → 認知惡化、譫妄、尿滯留
- **CNS 抑制疊加**：BZD + Opioid + Z-drug + 一代抗組織胺 + Gabapentinoid + Alcohol → 呼吸抑制
- **出血風險疊加**：NSAID + SSRI + 抗凝 + 抗血小板 → GI 出血倍增
- **腎毒性疊加**：NSAID + ACEI/ARB + 利尿劑（"triple whammy"）、Vancomycin + Piperacillin/tazobactam、Aminoglycoside 組合
- **雙 promotility**：Metoclopramide + Erythromycin + Neostigmine
- **多重瀉劑**：Senna + Bisacodyl + PEG + Lactulose
- **多重 steroid**：Hydrocortisone（septic shock）+ Dexamethasone（COVID）+ Methylprednisolone（asthma）
- **升 K 疊加**：ACEI/ARB + Spironolactone + Trimethoprim + Tacrolimus + Heparin + K 補充

---

## 四、ICU／住院情境的精準判斷

ICU 常見「表面重複但臨床合理」與「跨團隊接棒遺漏停藥」兩類陷阱。

### 4.1 ICU 熱點清單

| 場景 | 重複判斷重點 |
|------|-------------|
| **鎮靜銜接** | 標準方向為 BZD → Propofol／Dexmedetomidine（SCCM PADIS 2018：避免 BZD 為 first-line sedation，IIA）；需明確記錄停用時間；注意 Propofol Infusion Syndrome（PRIS） |
| **止痛疊加** | 判斷是 multimodal（不同機轉，opioid-sparing）還是 opioid stacking；Fentanyl patch 穩態 12–24 h、停藥後仍釋放 17–24 h，交接必核 |
| **SUP**（壓力性潰瘍預防） | 僅用於高風險（MV > 48 h、凝血異常）（ASHP／REVISE 2024／PEPTIC 2020）；低風險應避免；**入 ICU 開 IV PPI，出 ICU 未停、病房又開 PO PPI** 是最常見雙 PPI 情境 |
| **ICU 譫妄** | **SCCM PADIS 2018 不建議常規以 haloperidol／抗精神病藥治療或預防譫妄**（MIND-USA NEJM 2018 證實無效）；首選 non-pharmacologic（ABCDEF bundle）；若必須藥物介入，避免 Haloperidol + Quetiapine + Olanzapine 疊加（QTc） |
| **升壓劑重複** | Norepinephrine + Vasopressin：SSC 2021 在 NE ≥ 0.25–0.5 µg/kg/min 未達標時加 Vasopressin（合理）；**NE + Phenylephrine 長期併用通常不當**（Phenylephrine 多為暫時 bridge） |
| **神經肌肉阻斷劑** | Cisatracurium infusion + Rocuronium bolus 疊加需警示；ROSE trial 顯示 ARDS 常規 NMBA 非必要 |
| **抗生素重複** | Empirical → definitive de-escalation 容許短暫 overlap（通常 ≤ 24 h）；**同類 β-lactam 交替（Cefazolin + Ceftriaxone）須有 de-escalation plan** |
| **抗凝重複** | **Prophylactic Enoxaparin + Therapeutic Heparin infusion 為常見交接錯誤**，列紅旗；DOAC → parenteral 需等上次 DOAC 劑量後 12–24 h（依腎功能）；Heparin 橋接 Warfarin 依指引 |
| **K 補充** | KCl IV + PO + Spironolactone + ACEI/ARB + Trimethoprim 多來源須整合監測（Q6–12 h during repletion） |
| **止吐疊加** | 雙 D2（Metoclopramide + Haloperidol）、雙 5-HT3（Ondansetron + Granisetron）、5-HT3 + Haloperidol + Methadone（QTc stacking） |
| **腸道蠕動** | 雙 promotility 或多重瀉劑疊加 |
| **Insulin** | ICU GI 中斷後未對應調整 basal + correction + infusion |

### 4.2 Medication Reconciliation 節點

每次 level-of-care 轉換都需對帳（Joint Commission NPSG.03.06.01）：

- 入 ICU／出 ICU／出院
- **轉入／轉出 OR**
- **呼吸器脫離後**
- **AKI／CRRT 啟停時**
- **Enteral 恢復時（IV → PO 轉換）**
- **每日 ICU round**（重評當日所有用藥必要性）

---

## 五、審方 SOP（資深藥師 8 步驟）

面對系統跳出的重複用藥警示或審方時：

1. **排除假陽性**：劑型／途徑／salt 切換？overlap 是否在換藥窗內（≤ 48 h）？
2. **確認機轉重疊層級**：L1 同成分？L2 同 ATC L4？L3 同機轉不同 class？L4 同療效終點？
3. **讀適應症**：同成分用於不同適應症是否合理？（Spironolactone 用於 HF vs 利尿 vs 肝腹水）
4. **核劑量與療程**：
   - 是否超過 max daily dose？
   - PRN 與排程加總後是否仍安全？
   - 總 Morphine Equivalent／總 Paracetamol／總 K／總 anticholinergic burden？
5. **評估效益**：有實證（指引／RCT）支持此合併策略嗎？還是慣性疊加？
6. **評估風險**：毒性疊加？交互作用？特殊族群（老人、肝腎不全、孕哺、QTc 延長基礎）？
7. **介入**：
   - 明確重複：建議停一藥或改單方
   - 情境合理：請醫師於病歷註記原因
   - 不確定：查最新指引或會診專科
8. **紀錄與追蹤**：寫入審方意見；追蹤後續處方是否修正；若同規則 override 率 > 90% 需回頭檢討規則設計

---

## 六、系統設計建議（ChatICU 規則引擎）

### 6.1 警示分級（對應業界 DDI severity）

| 本系統 | Lexicomp | First Databank / Micromedex | 預設行為 |
|--------|----------|------------------------------|---------|
| 🔴 Critical | X (Avoid) | Contraindicated | Interruptive soft-stop（強制覆寫理由，非硬阻擋） |
| 🟠 High | D (Modify) | Severe | 強制藥師覆核 |
| 🟡 Moderate | C (Monitor) | Moderate | 軟警示可覆寫 |
| 🔵 Low | B | Minor | 非中斷式提示 |
| ⚪ Info | A | — | 僅於審方清單列出 |

建議同時引入 **documentation axis**（Established／Probable／Suspected／Theoretical），避免 theoretical-only 規則也觸發高警示。

### 6.2 覆寫原因下拉選項

- [ ] 給藥途徑切換（IV ↔ PO／Topical／Inhaled）
- [ ] Salt form 切換
- [ ] 換藥過渡期（overlap ≤ 48 h）
- [ ] 不同機轉、實證支持的 multimodal 治療
- [ ] 長效 + 短效 breakthrough／PRN 合理搭配
- [ ] Treatment-resistant（指引支持併用）
- [ ] 急性惡化期短期加藥
- [ ] 不同適應症
- [ ] 其他（自由輸入，必填）

### 6.3 自動降級規則

| 條件 | 行為 |
|------|------|
| 同 L5 + route 不同 | Critical → Moderate |
| 同 L5 + salt 不同 | Critical → High |
| 同 L5 + overlap ≤ 48 h | Critical → Moderate + 標記過渡期 |
| 一方為 PRN + 另一方為排程（且非同為長效 opioid／BZD） | High → Low |
| 同 L4 但不同適應症（由病歷 problem list 判斷） | High → Moderate |

### 6.4 KPI

| 指標 | 目標 | 處置 |
|------|------|------|
| Rule PPV（真陽性率） | > 50% 可接受、> 70% 良好 | < 50% 檢討 specificity |
| Override rate | — | **> 90% 檢討規則、> 95% 考慮停用或降為 non-interruptive** |
| Pharmacist-intervention rate | 作為 rule value 指標 | 追蹤攔截造成的 harm prevention |
| Alert-to-action time | 越短越好 | UI／規則設計優化 |

### 6.5 資料源優先序

1. **WHO ATC/DDD Index**（年度更新）— 分類基礎
2. **本院臨床共識清單**（§3.4 Level 3/4、§4.1 ICU 熱點）— 人工維護
3. **UpToDate / Lexicomp / Micromedex**— 個案判斷引用
4. **最新指引**（ACC/AHA/ESC、GOLD、GINA、KDIGO、ADA、SCCM、IDSA）— 每季檢視更新

---

## 七、快速檢查清單（Pocket Card）

審方時逐題自問：

- [ ] ATC L5 是否相同？若同，是否為 route／salt／overlap 合理例外？
- [ ] ATC L4 相同 → 查 §3.1／§3.2 分類表
- [ ] ATC 不同但機轉重疊 → 查 §3.4 人工清單
- [ ] 總日劑量（MME／總 Paracetamol／總 K／抗膽鹼負荷）是否超標？
- [ ] PRN + 排程合併後最大日劑量是否仍安全？
- [ ] 是否屬合理 multimodal（機轉不同 + 實證支持）？
- [ ] 病人族群（老人／肝腎不全／QTc 基線／孕哺）是否需更嚴格？
- [ ] 若屬合理，病歷是否已註記原因？
- [ ] 若屬錯誤，是否已與開立醫師溝通並紀錄？

---

## 參考資料

- WHO Collaborating Centre for Drug Statistics Methodology — ATC/DDD Index & Structure (atcddd.fhi.no)
- KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of CKD
- 2025 ACC/AHA/ACEP/NAEMSP/SCAI ACS Guideline
- ULTIMATE-DAPT Trial (ACC 2024)
- GOLD 2025 Report
- GINA 2025 Report
- ACG 2022 GERD Clinical Guideline
- ADA Standards of Care in Diabetes (latest)
- APA Practice Guideline for MDD
- AUA / EAU BPH Guidelines
- SCCM PADIS Guidelines 2018（Pain, Agitation/Sedation, Delirium, Immobility, Sleep）
- MIND-USA Trial（NEJM 2018）
- REVISE Trial（NEJM 2024）／PEPTIC Trial（JAMA 2020）— SUP
- SSC 2021 Surviving Sepsis Campaign Guidelines
- CHEST 2021 Antithrombotic Therapy Guideline
- CDC Clinical Practice Guideline for Prescribing Opioids 2022
- Beers Criteria 2023（AGS）
- FDA Drug Labels（PENNSAID, Tylenol, Metformin 等）
- Lexicomp Interact Severity Definitions
- JMIR MedInform 2020 — Appropriateness of CPOE Alert Overrides (Systematic Review)
- Felisberto et al. 2024 — CDSS Alert Override Meta-analysis
