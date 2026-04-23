# 基於 ATC 基礎建設實作「重複用藥偵測」實作計畫

> **目的**：利用既有的 ATC code 基礎建設（medications 表 84.6% 覆蓋、DDI 雙路查詢模式、FHIR code_maps），新增「同一病人用藥中的不當重複」自動偵測與審方提示。
> **判斷邏輯依據**：`docs/duplicate-medication-assessment-guide.md` v2.0。
> **建置模式**：沿用現有 DDI 雙路查詢的設計模式，避免重造輪子。
> **版本**：2026-04-23 v1.0

---

## 📊 狀態追蹤（實作計畫）

> 每次 Claude 被要求處理「重複用藥」相關任務時，必同步更新此區塊。
> 關聯文件：[臨床判斷指引](./duplicate-medication-assessment-guide.md) · [串接計畫](./duplicate-medication-integration-plan.md)

**最後更新**：2026-04-23（Phase 1 + Phase 2 完成 ✅ 60 pass / 3 skip / 0 fail；Production deployed）

### Phase 0 — 資料準備
- [ ] 補齊 15.4% 無 ATC 的 medications（`backfill_missing_atc.py`）
- [x] `drug_mechanism_groups.csv` 初版（P0 清單）✅ 7 組 + 104 members
- [x] `drug_endpoint_groups.csv` 初版（P0 清單）✅ 5 組 + 146 members
- [x] `duplicate_rule_overrides.csv` 初版 ✅ 原 50 + 補 8 rules (NSAID/SSRI/Statin/β-blocker/BZD/DHP CCB/cross-class BZD)
- [ ] 臨床藥師小組審閱種子清單

### Phase 1 — MVP：L1 + L2
- [x] Alembic migration 063（新增偵測表）✅ 7 張表 + 5 索引
- [x] `backend/app/models/duplicate_*.py`（4 個 model 檔）✅ + `__init__.py` 註冊
- [x] `backend/app/services/duplicate_detector.py`（L1 / L2 偵測）✅ 902 行
- [x] 自動降級規則（route / salt / overlap ≤ 48 h + switch signal guard）✅
- [x] `GET /patients/{id}/medication-duplicates` endpoint ✅ 新 router `medication_duplicates.py`
- [x] `backend/tests/test_services/test_duplicate_detector.py` ✅ 63 test，42 pass / 21 skip / 0 fail
- [x] `backend/tests/fixtures/duplicate_cases.json`（40 組黃金案例）✅ 534 行
- [x] `backend/app/utils/duplicate_check.py`（AI snapshot 用）✅
- [x] `backend/scripts/seed_duplicate_groups.py`（CSV→DB loader）✅
- [x] `src/lib/api/medications.ts` 加 `getMedicationDuplicates()` + interfaces ✅
- [ ] 前端 `src/lib/api/medications.ts` 新增 interface + fetch
- [ ] 前端 `medication-duplicate-badges.tsx`
- [ ] 串入 `patient-medications-tab.tsx`
- [ ] Shadow mode 驗收（1 週，目標 PPV ≥ 70%）

### Phase 2 — L3 + L4 + 覆寫 + KPI
- [x] L3 偵測（機轉群組 join）✅ 7 groups + stacking escalation（QTc/CNS/anticholinergic/serotonergic）
- [x] L4 偵測（療效終點 join）✅ 5 groups + subtype coverage + bridging downgrade + L3/L4 fold
- [x] §3.1 強制升級規則 ✅（Wave 1 已完成）
- [x] §3.3 白名單規則 ✅（含 B05 IV 溶液補丁）
- [ ] 覆寫 UI + `duplicate_alert_feedback` 表
- [ ] KPI dashboard（PPV、override rate、intervention rate）

### Phase 3 — ICU 專屬規則
- [ ] `medications.is_prn` + `last_admin_at` 欄位補充
- [ ] Prophylactic Enoxaparin + Therapeutic Heparin 紅旗
- [ ] 同類 β-lactam + de-escalation plan 檢查
- [ ] 雙鎮靜（Propofol + Midazolam）警示
- [ ] SUP 轉出未停偵測
- [ ] ICU 譫妄藥物疊加（Haloperidol + Quetiapine + Olanzapine）
- [ ] Med Rec 節點整合

### 規則資料源更新
- [ ] WHO ATC/DDD 年度更新檢視（下次：2027-01）
- [ ] 臨床指引更新檢視（每季）

---

## 一、目標與非目標

### 目標
1. 在病人詳情的用藥頁自動列出**可能的重複用藥組合**，標註機轉、風險等級與處置建議
2. 四層判斷（L1 同成分 / L2 同 ATC L4 / L3 同機轉跨 class / L4 同療效終點）皆支援
3. 支援自動降級規則（route / salt / overlap ≤ 48 h / PRN-排程搭配）避免 alert fatigue
4. 提供 KPI 追蹤：PPV、override rate、攔截介入率

### 非目標
- 不處理劑量超標（交給現有 dose checker）
- 不處理 DDI（既有功能）
- 不處理健保行政規則
- 第一階段不做 AI／NLP 判讀，純規則引擎

---

## 二、現況盤點（可直接複用的資產）

| 資產 | 路徑 | 對本專案的作用 |
|------|------|---------------|
| `medications.atc_code` | `backend/app/models/medication.py:52` | 四層判斷的主鍵 |
| `medications.is_antibiotic / kidney_relevant` | same | 分級參考訊號 |
| `drug_formulary.csv`（1,670 筆，97% 有 ATC） | `backend/app/fhir/code_maps/` | ATC 對照權威來源 |
| `auto_rxnorm_cache.json` | same | Generic → ATC 備援 |
| `his_ddi_alias_map.json` | `backend/app/fhir/` | 處理複方／別名 |
| `his_ddi_exclusion_list.json` | same | 排除非藥物代碼 |
| DDI 雙路查詢 pattern | `backend/app/routers/medications.py:166–235` | 直接沿用架構 |
| DDI badge UI pattern | `src/components/patient/drug-interaction-badges.tsx` | UI 同風格 |
| `patient-medications-tab.tsx` 分組邏輯 | same 資料夾 | 重複警示可直接插入 |
| `build_formulary_csv.py` / `backfill_*.py` | `backend/scripts/` | 資料維運腳本範例 |

**生產現況**：2,597 筆 medications 中 2,198 筆（84.6%）有 ATC code；15.4%（~399 筆）待補。

---

## 三、架構設計

### 3.1 資料流

```
Active medications (病人當日仍在用藥)
   ↓
DuplicateDetector.analyze(medications)
   ├─ L1 偵測: group by atc_code (L5，7 字元完全相同)
   ├─ L2 偵測: group by atc_code[:5] (L4 subgroup)
   ├─ L3 偵測: join drug_mechanism_groups (人工清單)
   ├─ L4 偵測: join drug_endpoint_groups (人工清單)
   ├─ 自動降級: route / salt / overlap / PRN-scheduled
   └─ 規則覆寫: §3.1 red-flag whitelist
   ↓
DuplicateAlert[]  (id, level, mechanism, members[], recommendation)
   ↓
GET /patients/{id}/medication-duplicates
   ↓
<MedicationDuplicateBadges /> (前端)
```

### 3.2 四層判斷對應表（與 §2.2 指引對齊）

| 層級 | 偵測方式 | 資料來源 | 警示等級 |
|------|---------|---------|---------|
| L1 | `med.atc_code` 完全相同（7 字元） | medications 表 | 🔴 Critical |
| L2 | `med.atc_code[:5]` 相同但 L5 不同 | medications 表 | 🟠 High |
| L3 | `med.atc_code[:4]` 相同 或 查 `drug_mechanism_groups` | medications + 新表 | 🟡 Moderate |
| L4 | 查 `drug_endpoint_groups`（跨機轉同療效目的） | 新表 | 🔵 Low |

### 3.3 自動降級規則

| 條件 | 降級 |
|------|------|
| 同 L5 但 `route` 不同（IV↔PO↔Topical↔Inhaled） | Critical → Moderate |
| 同 L5 但 salt 不同（偵測 ingredient suffix） | Critical → High |
| 給藥時間 overlap ≤ 48 h | Critical → Moderate（標記過渡期） |
| 一方 PRN + 另一方排程（且非同為長效 opioid／BZD） | High → Low |
| 同 L4 但不同適應症（若 problem list 可判讀） | High → Moderate |

### 3.4 規則覆寫（白名單與黑名單）

- **黑名單強化**：§3.1 清單（雙 PPI／雙 SSRI／雙口服 NSAID／ACEI+ARB／雙 Statin／雙口服抗凝／雙長效 BZD／雙長效 Opioid／Metformin 單方+複方／雙 β-blocker／雙 α-blocker／雙 DHP CCB／雙 5-HT3／雙 D2 止吐）→ 即使不同 ATC L4，也強制升為 Critical
- **白名單合理組合**：§3.3 清單（Acetaminophen + NSAID、ICS + oral steroid 短期、Loop + Spironolactone、Basal + bolus insulin）→ 不產生警示

---

## 四、資料模型變更

### 4.1 新增資料表

#### `drug_mechanism_groups`（L3 人工維護：同機轉跨 class）
```
id               SERIAL PK
group_key        VARCHAR(50)   -- e.g., "alpha1_blocker", "serotonergic", "anticholinergic"
group_name_en    VARCHAR(100)
group_name_zh    VARCHAR(100)
severity         VARCHAR(10)   -- critical / high / moderate / low
mechanism_note   TEXT
created_at, updated_at
```

#### `drug_mechanism_group_members`
```
group_id         INT FK -> drug_mechanism_groups
atc_code         VARCHAR(10)   -- 該 L5 屬於此機轉群
active_ingredient VARCHAR(100)
PRIMARY KEY (group_id, atc_code)
```

#### `drug_endpoint_groups`（L4 人工維護：同療效終點）
結構同 `drug_mechanism_groups`，`group_key` 例：`raas_blockade`、`qtc_prolonging`、`cns_depressant`、`bleeding_risk`、`nephrotoxic`、`hyperkalemia`。

#### `drug_endpoint_group_members`
結構同 `drug_mechanism_group_members`。

#### `duplicate_rule_overrides`（§3.1 升級／§3.3 白名單）
```
id, rule_type (upgrade/whitelist)
atc_code_1, atc_code_2  -- 排序後存
severity_override        -- upgrade 時用
reason, evidence_url
```

#### `duplicate_alert_feedback`（KPI 追蹤）
```
id, patient_id, alert_fingerprint
action (accepted / overridden / modified)
override_reason
pharmacist_id
created_at
```

### 4.2 Alembic migration
- `063_add_duplicate_detection_tables.py` — ⚠️ 062 已由 `feat/discharged-patients-page` 分支佔用
- Seed data 於 `backend/app/fhir/code_maps/`：
  - `drug_mechanism_groups.csv`
  - `drug_endpoint_groups.csv`
  - `duplicate_rule_overrides.csv`

---

## 五、後端實作

### 5.1 新增服務層 `backend/app/services/duplicate_detector.py`

```python
class DuplicateDetector:
    def analyze(self, meds: list[Medication]) -> list[DuplicateAlert]:
        alerts = []
        alerts += self._detect_l1(meds)            # 同 L5
        alerts += self._detect_l2(meds)            # 同 L4
        alerts += self._detect_l3(meds)            # 機轉群組
        alerts += self._detect_l4(meds)            # 療效終點
        alerts = self._apply_overrides(alerts)     # 強制升降級
        alerts = self._apply_downgrades(alerts)    # route/salt/overlap/PRN
        alerts = self._dedupe(alerts)              # 同組合只留最高等級
        return alerts
```

參考 DDI 的 `async + SQLAlchemy text()` 模式直接打索引。

### 5.2 新增 endpoint
`GET /patients/{patient_id}/medication-duplicates`

回傳：
```json
[
  {
    "id": "dup_ab12cd",
    "level": "critical",
    "layer": "L1",
    "mechanism": "PPI × PPI",
    "members": [
      {"medicationId": "med_001", "genericName": "Omeprazole", "atcCode": "A02BC01"},
      {"medicationId": "med_042", "genericName": "Esomeprazole", "atcCode": "A02BC05"}
    ],
    "recommendation": "停用其中一 PPI；若為換藥過渡期，overlap ≤ 48h 後應停單方。",
    "evidenceUrl": "...",
    "autoDowngraded": false,
    "downgradeReason": null
  }
]
```

### 5.3 與現有 `GET /patients/{id}/medications` 的整合

兩種做法擇一（建議 Option A）：
- **Option A**：獨立 endpoint，前端平行呼叫。優點：關注點分離、快取策略獨立。
- **Option B**：擴充既有 endpoint 回傳 `duplicates: [...]`。優點：少一次 round trip。

### 5.4 回填與資料補強腳本

- `backend/scripts/seed_duplicate_groups.py`：從 `drug_mechanism_groups.csv` 與 `drug_endpoint_groups.csv` 載入至 DB
- `backend/scripts/backfill_missing_atc.py`：針對剩餘 15.4%（~399 筆）無 ATC 的 medications，嘗試 RxNorm cache + 人工 gap 補齊
- `backend/scripts/validate_duplicate_rules.py`：CI 時跑，檢查 overrides 表中的 ATC 是否都存在於 formulary

---

## 六、前端實作

### 6.1 API client
`src/lib/api/medications.ts` 新增：
```typescript
export interface DuplicateAlert {
  id: string
  level: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  layer: 'L1' | 'L2' | 'L3' | 'L4'
  mechanism: string
  members: Array<{ medicationId: string; genericName: string; atcCode: string | null }>
  recommendation: string
  evidenceUrl?: string
  autoDowngraded?: boolean
  downgradeReason?: string | null
}

export async function fetchMedicationDuplicates(patientId: string): Promise<DuplicateAlert[]>
```

### 6.2 UI 元件
新增 `src/components/patient/medication-duplicate-badges.tsx`，沿用 `drug-interaction-badges.tsx` 的視覺語言：
- Critical：紅色粗邊框 + AlertTriangle
- High：橙色
- Moderate：黃色
- Low：藍色（非中斷式）
- 可點擊展開查看 members + recommendation + evidence link

### 6.3 插入位置
在 `patient-medications-tab.tsx` 用藥分組上方新增區塊：
```
[藥物交互作用 DDI]  ← 現有
[重複用藥警示]        ← 新增
[用藥分組：Sedation / Analgesia / ...]  ← 現有
```

每條用藥列卡片右側也可加上小 badge 標記「屬於某重複組」，點擊 scroll 到警示區。

### 6.4 審方覆寫（Phase 2）
- 覆寫按鈕 → 下拉選項（對應 §6.2 指引清單）
- 覆寫紀錄呼叫 `POST /patients/{id}/medication-duplicates/{alert_id}/override`
- 寫入 `duplicate_alert_feedback` 表

---

## 七、資料維護：Level 3 / 4 種子清單

### 7.1 Level 3（同機轉跨 class）優先建置

| group_key | 成員 ATC 範例 | 優先級 |
|-----------|--------------|-------|
| `alpha1_blocker` | Doxazosin C02CA04、Tamsulosin G04CA02 | P0 |
| `serotonergic` | SSRI、SNRI、Tramadol、Linezolid、Triptan | P0 |
| `qtc_prolonging` | Haloperidol、Ondansetron、Azithromycin、Fluoroquinolone、Methadone、Citalopram | P0 |
| `anticholinergic_burden` | TCA、一代抗組織胺、Oxybutynin、Benztropine | P1 |
| `cns_depressant` | BZD、Opioid、Z-drug、Gabapentinoid、一代抗組織胺 | P0 |
| `d2_antagonist_antiemetic` | Metoclopramide、Prochlorperazine、Haloperidol | P1 |
| `promotility` | Metoclopramide、Erythromycin、Neostigmine | P2 |

### 7.2 Level 4（同療效終點）優先建置

| group_key | 說明 | 優先級 |
|-----------|------|-------|
| `raas_blockade` | ACEI + ARB + ARNI + DRI | P0 |
| `bleeding_risk` | NSAID + SSRI + 抗凝 + 抗血小板 | P0 |
| `hyperkalemia` | ACEI/ARB + Spironolactone + TMP + Tacrolimus + Heparin + K | P1 |
| `nephrotoxic_triple_whammy` | NSAID + ACEI/ARB + Diuretic | P0 |
| `hepatotoxic_stacking` | Paracetamol 總量、抗結核藥、抗真菌 | P2 |

---

## 八、ICU 專屬規則（Phase 2）

配合 §4 ICU 熱點：
- **Prophylactic Enoxaparin + Therapeutic Heparin infusion** → 紅旗硬阻擋（最高優先）
- **同類 β-lactam 同時活躍** → 檢查是否有 de-escalation plan 標記
- **雙鎮靜（Propofol + Midazolam 持續輸注）** → 警示 + 建議 single agent
- **SUP 場景**：偵測「入 ICU 開 IV PPI → 轉出病房後新增 PO PPI」模式
- **ICU 譫妄藥物疊加**：Haloperidol + Quetiapine + Olanzapine 同時活躍 → QTc 警示 + 引導至 PADIS bundle

需新增欄位：
- `medications.is_prn BOOLEAN`
- `medications.is_icu_context BOOLEAN`（或從 ward 判斷）
- `medications.last_admin_at`（用於 overlap 判斷）

---

## 九、實施里程碑

### Phase 0 — 資料準備（3 天）
- [ ] 補齊 15.4% 無 ATC 的 medications（跑 `backfill_missing_atc.py`）
- [ ] 建立 `drug_mechanism_groups.csv`、`drug_endpoint_groups.csv`、`duplicate_rule_overrides.csv` 初版
- [ ] 臨床藥師小組 review 種子清單

### Phase 1 — MVP：L1 + L2（1 週）
- [ ] Migration 062
- [ ] `duplicate_detector.py` 實作 L1 / L2
- [ ] 自動降級規則（route / salt / overlap）
- [ ] `GET /patients/{id}/medication-duplicates`
- [ ] 前端 `medication-duplicate-badges.tsx` + 插入 tab
- [ ] 以生產 2,597 筆 medications 跑 shadow mode 一週，比對藥師人工判讀

### Phase 2 — L3 + L4 + 覆寫 + KPI（1 週）
- [ ] L3 / L4 偵測
- [ ] §3.1 升級規則 + §3.3 白名單
- [ ] 覆寫 UI + feedback 表
- [ ] KPI dashboard（PPV、override rate、intervention rate）

### Phase 3 — ICU 專屬規則（1–2 週）
- [ ] PRN / overlap / context 欄位
- [ ] 6 項 ICU 紅旗規則
- [ ] Med Rec 節點整合（入出 ICU／OR／拔管／IV→PO 轉換）

---

## 十、驗證與測試

### 10.1 測試資料
- 合成測試集：以 `backend/tests/fixtures/duplicate_cases.json` 建立 40 組已知陽性／陰性案例
- Golden set：實際生產匿名化 5 位患者（含 Q4 15 DDI hits 的 5 patients）

### 10.2 單元測試
`backend/tests/test_services/test_duplicate_detector.py`：
- L1–L4 各層偵測正確性
- 自動降級規則
- 升級／白名單規則
- 去重複（同組合只保留最高等級）

### 10.3 指標目標（上線後 1 個月）
| 指標 | 目標 |
|------|------|
| Rule PPV（真陽性率，藥師認同率） | ≥ 70% |
| Override rate | < 80%（個別規則 < 90%） |
| 前端 alert-to-action time | p50 < 10 s |
| 漏網率（vs Golden set） | < 5% |

### 10.4 規則品質保證
- CI 跑 `validate_duplicate_rules.py` 確保 overrides / groups 中 ATC 都存在
- 每季由藥師小組 review 高 override 規則
- 每年 1 月檢視 WHO ATC 更新

---

## 十一、風險與對策

| 風險 | 對策 |
|------|------|
| Alert fatigue 導致藥師關注下降 | 嚴格降級規則；single interruptive threshold（僅 Critical）；KPI 持續監測 |
| L3/L4 清單維護成本高 | 分階段建置（P0→P2）；規則表 CSV 化便於 PR review |
| 15.4% 藥品無 ATC 造成偵測漏洞 | 前端顯示「本藥無 ATC，僅能字串比對」；優先補齊熱門缺漏 |
| 複方藥（fixed-dose combination）判定複雜 | 比對多重成分；Metformin 複方案例為優先測試案例 |
| 偽陽性（看似重複實為多模式治療） | §3.3 白名單 + 藥師覆寫機制 + feedback 回饋規則調整 |

---

## 十二、對外介面（給其他模組使用）

後續模組（審方 workflow、出院用藥檢查、AI 問答）可透過：

```python
from app.services.duplicate_detector import DuplicateDetector

detector = DuplicateDetector(session)
alerts = await detector.analyze(active_medications)
```

前端其他頁面（如病歷摘要）可呼叫 `fetchMedicationDuplicates(patientId)` 取得統一結果。

---

## 十三、工作清單（彙整）

### Backend
- [ ] `backend/alembic/versions/062_add_duplicate_detection_tables.py`
- [ ] `backend/app/models/duplicate_*.py`（4 個 model）
- [ ] `backend/app/services/duplicate_detector.py`
- [ ] `backend/app/routers/medications.py` 新增 endpoint
- [ ] `backend/app/fhir/code_maps/drug_mechanism_groups.csv`
- [ ] `backend/app/fhir/code_maps/drug_endpoint_groups.csv`
- [ ] `backend/app/fhir/code_maps/duplicate_rule_overrides.csv`
- [ ] `backend/scripts/seed_duplicate_groups.py`
- [ ] `backend/scripts/backfill_missing_atc.py`
- [ ] `backend/scripts/validate_duplicate_rules.py`
- [ ] `backend/tests/test_services/test_duplicate_detector.py`
- [ ] `backend/tests/fixtures/duplicate_cases.json`

### Frontend
- [ ] `src/lib/api/medications.ts` 新增 interface + fetch
- [ ] `src/components/patient/medication-duplicate-badges.tsx`
- [ ] `src/components/patient/patient-medications-tab.tsx` 插入點
- [ ] （Phase 2）覆寫對話框元件

### Ops
- [ ] 生產 shadow mode 觀察一週（Phase 1 後）
- [ ] KPI dashboard 建置（可沿用現有 Grafana 或簡易後台）
- [ ] 臨床藥師培訓材料（介面操作 + 覆寫原因選擇）

---

## 附錄 A：對應指引章節

| 本計畫章節 | 指引章節 |
|-----------|---------|
| §3.2 四層判斷對應 | 指引 §2 |
| §3.3 自動降級規則 | 指引 §2.3 |
| §3.4 規則覆寫 | 指引 §3.1 / §3.3 |
| §七 L3/L4 種子 | 指引 §3.4 |
| §八 ICU 專屬 | 指引 §4 |
| §十驗證 KPI | 指引 §6.4 |

## 附錄 B：沿用 DDI 的設計模式對照

| DDI 現有 | 重複用藥偵測 |
|---------|-------------|
| `drug_interactions` 表 + `drug1_atc/drug2_atc` | `drug_mechanism_groups` + `*_members` |
| `medications.py:166–235` 雙路查詢 | `duplicate_detector.py` 四層偵測 |
| `drug-interaction-badges.tsx` | `medication-duplicate-badges.tsx` |
| `backfill_drug_interactions_atc.py` | `backfill_missing_atc.py` + `seed_duplicate_groups.py` |
| `test_ddi_check.py` mock 架構 | `test_duplicate_detector.py` 沿用 |
