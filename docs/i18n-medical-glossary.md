# 醫療術語中英對照表（i18n 校稿表）

> **配對計畫**：[`i18n-rollout-plan-2026-05-04.md`](i18n-rollout-plan-2026-05-04.md)
> **配對進度**：[`i18n-rollout-progress.md`](i18n-rollout-progress.md)
> **建立日**：2026-05-04（Wave 1）
>
> 此文件用於收錄需要醫療人員校稿的中英對照詞。Claude 給的初譯填在「Claude 初譯」欄，
> 由真實藥師/醫師確認後填到「最終版」欄並回填字典。

## 校稿狀態

- ⬜ 未校稿（用 Claude 初譯）
- 🟡 校稿中
- 🟢 已校稿（最終版已回填字典）

## Wave 1 — 角色與基本介面

### 角色（roles.json）

| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 醫師 | Physician | — | ⬜ | Doctor / Physician 都通用，醫療正式文件偏好 Physician |
| 專科護理師 | Nurse Practitioner | — | ⬜ | 台灣 NP（特殊執業範圍） |
| 護理師 | Nurse | — | ⬜ | RN 是否要區分？ |
| 藥師 | Pharmacist | — | ⬜ | Clinical Pharmacist？ |
| 管理者 | Administrator | — | ⬜ | System Admin / Administrator |

### 側邊欄（sidebar.json）

| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 病人照護 | Patient Care | — | ⬜ | |
| 藥事評估 | Pharmacy Review | — | ⬜ | Pharmaceutical Care？ |
| 藥事工具 | Pharmacy Tools | — | ⬜ | |
| 溝通 | Communication | — | ⬜ | |
| 系統管理 | Administration | — | ⬜ | |
| 總覽 | Overview | — | ⬜ | Dashboard 也可 |
| 住院病人 | Inpatients | — | ⬜ | Admitted Patients |
| 出院病人 | Discharged | — | ⬜ | Discharged Patients |
| 智藥輔助 | Pharmacist Workstation | — | ⬜ | 名稱含品牌意涵，可能 AI Pharmacy Assistant 更貼切 |
| 劑量計算 | Dosage Calculator | — | ⬜ | |
| 用藥交互 | Drug Interactions | — | ⬜ | |
| 重複用藥 | Duplicate Therapy | — | ⬜ | Therapeutic Duplication |
| 用藥相容 | IV Compatibility | — | ⬜ | 注射藥物相容性 |
| 藥物管理 | Drug Library | — | ⬜ | Drug Database？ |
| 藥物統計 | Advice Statistics | — | ⬜ | Pharmacy Advice Statistics |
| AI 問答 | AI Assistant | — | ⬜ | AI Chat / AI Q&A |
| 團隊訊息 | Team Messages | — | ⬜ | |
| 稽核紀錄 | Audit Log | — | ⬜ | |
| 帳號權限 | Users & Roles | — | ⬜ | User Management |

## Wave 2 — 入口頁（auth + dashboard）

### Auth（auth.json）
| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 智慧型加護病房照護系統 | Intelligent ICU Care System | — | ⬜ | tagline，可考慮 Smart ICU Care Platform |
| 帳號 | Username | — | ⬜ | Account / User ID 可選 |
| 密碼 | Password | — | ⬜ | |
| 變更密碼 | Change Password | — | ⬜ | |
| 您的密碼已過期或需要更新，請設定新密碼 | Your password has expired or requires an update. Please set a new password. | — | ⬜ | |
| 至少 12 字元，含大小寫字母、數字及特殊字元 | At least 12 characters, including upper/lowercase letters, numbers, and special characters | — | ⬜ | |
| 密碼已變更，請重新登入 | Password changed. Please log in again. | — | ⬜ | |

### Dashboard（dashboard.json）
| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 加護病房總覽 | ICU Overview | — | ⬜ | ICU Dashboard 也可 |
| 即時病床與病患狀態監控 | Real-time bed and patient status monitoring | — | ⬜ | |
| 模擬資料 | Demo Data | — | ⬜ | Mock Data / Sample Data |
| 病患總數 | Total Patients | — | ⬜ | Census 也常用 |
| 插管人數 | Intubated | — | ⬜ | Intubated Count |
| S 鎮靜 | Sedation | — | ⬜ | 是否保留 S 縮寫？S/A/N 是 ICU 約定俗成 |
| A 止痛 | Analgesia | — | ⬜ | |
| N 阻斷 | NMB | — | ⬜ | Neuromuscular Blockade |
| 偵測新更新 | Detect Updates | — | ⬜ | Check for Updates |
| 全部重抓 | Force Resync | — | ⬜ | Full Resync |
| 病患卡片清單 | Patient Cards | — | ⬜ | Patient List |
| 全部病患 / 插管中 / 使用 S/A/N / 有警示 | All / Intubated / On S/A/N / Has Alerts | — | ⬜ | |
| 依床號 / 依入住時間 | By Bed / By Admission Date | — | ⬜ | |
| 入院診斷 | Admission Diagnosis | — | ⬜ | Chief Complaint? Primary Dx? |
| 主治醫師 | Attending Physician | — | ⬜ | Attending |
| 呼吸道支持 / 侵入性呼吸道支持 / 已氣切 | Airway Support / Invasive airway support / Tracheostomy | — | ⬜ | Trach 縮寫常見 |
| 重複用藥警示 | Duplicate medication alert | — | ⬜ | Therapeutic Duplication Alert |

## Wave 3a — 病人列表 / 出院 / 編輯封存對話框

### 列表 / 表格欄位（patients.json）
| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 住院病人 | Inpatients | — | ⬜ | Admitted Patients 也可 |
| 病例號碼 | MRN | — | ⬜ | Medical Record Number |
| 入ICU日期 | ICU Admit | — | ⬜ | ICU Admission Date 較完整 |
| 呼吸器天數 | Vent Days | — | ⬜ | Ventilator Days |
| 隔離 | Isolation | — | ⬜ | |
| 插管 / 未插管 | Airway / No | — | ⬜ | 表頭僅一格、避免太長 |
| 辦理出院（保留病歷） | Discharge (keep records) | — | ⬜ | |

### 新增/編輯/封存
| zh-TW | Claude 初譯（en-US） | 最終版 | 狀態 | 備註 |
|-------|---------------------|--------|------|------|
| 新增病患 | Add Patient | — | ⬜ | New Patient |
| 編輯病人資料 | Edit Patient | — | ⬜ | |
| 同意書狀態 | Consent Status | — | ⬜ | |
| 已同意 / 已過期 / 未簽署 | Signed / Expired / Not signed | — | ⬜ | |
| 神經肌肉阻斷 / 肌肉鬆弛劑 | Neuromuscular Blocker | — | ⬜ | NMB；列表用 Sedation/Analgesia/NMB 三縮寫 |
| 氣管切開術 | Tracheostomy | — | ⬜ | Trach 為常用縮寫 |
| 侵入性呼吸道支持 | Invasive airway support | — | ⬜ | |
| 辦理出院（封存病患） | Discharge (archive patient) | — | ⬜ | Soft Discharge |
| 一般出院 / 轉院 / 死亡 / 其他 | Discharge / Transfer / Death / Other | — | ⬜ | |
| 永久刪除（admin） | Permanent delete (admin) | — | ⬜ | hard delete |
| 對選取病人 AI 問答 | AI Chat about selected | — | ⬜ | |

## Wave 3b+ 後續

各 Wave 啟動時補進此表。建議優先校稿項目：
- 藥品劑型用語（tab/cap/inj/syr）
- ICU 專屬術語（vasopressor、weaning protocol 等）
- SOAP 段落名稱（Subjective / Objective / Assessment / Plan）
- 病人狀態（critical / stable / improving / deteriorating）

## 校稿流程

1. 校稿者在「最終版」欄填入確認的英文
2. 把狀態改為 🟢
3. 回填到 `src/i18n/locales/en-US/<namespace>.json`
4. PR 標題：`chore(i18n-glossary): 校稿 wave-N <namespace>`
