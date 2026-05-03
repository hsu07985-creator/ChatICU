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

## Wave 2+ 後續

各 Wave 啟動時補進此表。建議優先校稿項目：
- 藥品劑型用語（tab/cap/inj/syr）
- ICU 專屬術語（vasopressor、sedation、weaning protocol 等）
- SOAP 段落名稱（Subjective / Objective / Assessment / Plan）
- 病人狀態（critical / stable / improving / deteriorating）

## 校稿流程

1. 校稿者在「最終版」欄填入確認的英文
2. 把狀態改為 🟢
3. 回填到 `src/i18n/locales/en-US/<namespace>.json`
4. PR 標題：`chore(i18n-glossary): 校稿 wave-N <namespace>`
