# 重複用藥偵測：資料流串接計畫

> **目的**：規劃「重複用藥偵測」如何嵌入現有 ChatICU 資料流，讓任何一個消費藥物資料的位置（用藥頁、AI 問答、藥師審方、出院檢查、Dashboard）都能用**同一套判斷結果**。
> **基礎**：`docs/duplicate-medication-assessment-guide.md` v2.0 + `docs/duplicate-medication-detection-implementation-plan.md`。
> **核心原則**：Service layer as **single source of truth**，一次計算、多處消費。
> **版本**：2026-04-23 v1.0

---

## 📊 狀態追蹤（串接計畫）

> 每次 Claude 被要求處理「重複用藥」相關任務時，必同步更新此區塊。
> 關聯文件：[臨床判斷指引](./duplicate-medication-assessment-guide.md) · [實作計畫](./duplicate-medication-detection-implementation-plan.md)

**最後更新**：2026-04-24（藥師中心重複用藥頁拿掉「情境」選項，統一以 `selectPharmacyReviewMeds()` 過濾「住院 + 自備/院外」）

### Wave 1 — 核心管線 ✅ 完成
- [x] Migration 063（detection tables + `medication_duplicate_cache`）✅ 7 張表
- [x] `app/services/duplicate_detector.py` + 單元測試 ✅ 42 pass / 21 skip / 0 fail
- [x] Seed P0 機轉群組 ✅（alpha1_blocker、serotonergic、qtc_prolonging、anticholinergic_burden、cns_depressant、d2_antagonist_antiemetic、promotility、raas_blockade、bleeding_risk、hyperkalemia、nephrotoxic_triple_whammy、qtc_stacking）
- [x] `GET /patients/{id}/medication-duplicates` ✅ 新 router

### Wave 2 — 用藥 Tab 串接（3 天）
- [x] `medication-duplicate-badges.tsx` ✅ 240 行，5 級配色對齊 DDI 樣式
- [x] 串入 `patient-medications-tab.tsx` ✅ 用 @tanstack/react-query + useApiQuery
- [x] SWR key + mutation invalidation ✅ queryKey: ['medication-duplicates', patientId, context]
- [x] Playwright UI 驗證 ✅ pat_001 demo 雙 PPI + ACEI+ARB 正確顯示 Critical
- [ ] Shadow mode 1 週（藥師人工對比）

### Wave 3 — AI 問答串接（3 天）
- [x] `app/utils/duplicate_check.py` + `format_duplicate_metadata()` ✅ Wave 1 時已完成
- [x] 串入 `build_clinical_snapshot()` ✅ patient_context_builder.py 內；context 由 patient.unit 自動判 icu/inpatient
- [x] System prompt template 更新 ✅ 透過 snapshot string 自動注入

### Wave 4 — 快取與 HIS sync hook（3 天）
- [x] `medication_duplicate_cache` 表 + `medications_hash` SHA-256 邏輯 ✅
- [x] `post_sync_refresh_duplicates` hook 插入 `sync_his_snapshots.py` ✅（加 `--skip-duplicate-refresh` CLI flag）
- [x] Hook 失敗隔離（try/except per-patient + stats tracking）✅

### Wave 5 — 藥師中心與審方（4 天）
- [x] `POST /pharmacy/duplicate-summary` 批次 endpoint ✅（含 BackgroundTasks warmup）
- [x] `pharmacy/interactions.tsx` 新增「重複用藥」Tab ✅
- [x] `pharmacy/workstation.tsx` 清單 badge ✅（dropdown + summary card 皆插入）

### Wave 6 — 出院與 Dashboard ✅ 完成
- [x] `GET /patients/{id}/discharge-check` ✅ 新 router + 4 分類（sup_ppi / empirical_antibiotic / prn_only / other）
- [x] `discharged-patients.tsx` 出院 checklist panel ✅（每 row 加 button → shadcn Dialog）
- [x] `patient-summary-tab.tsx` 風險卡片 ✅（DDI + 重複用藥 counts + 過敏；critical 時紅色邊框 + 警示 chip）
- [x] `dashboard.tsx` 病人風險 badge ✅（批次 API + 60s staleTime + 10s 一次性 retry for pending cache warmup）

### Wave 7 — Phase 2 擴充（後續 iteration）
- [ ] L3 / L4 清單擴充至 P1 / P2
- [ ] ICU 專屬規則
- [ ] 覆寫 UI + `duplicate_alert_feedback` 表
- [ ] KPI dashboard

### 整合測試
- [ ] 合約測試 `test_duplicate_consumers.py`
- [ ] E2E 測試 `duplicate-medication.spec.ts`
- [ ] Shadow mode PPV ≥ 70%、漏網率 < 5% 達標

### 消費點上線狀態
| 消費點 | Wave | 狀態 |
|--------|------|------|
| 病人用藥 Tab | 2 | 🟢 已上線（Playwright 驗證通過） |
| AI 問答 | 3 | 🟢 已上線（snapshot 自動注入重複用藥警示） |
| HIS sync 自動預算 | 4 | 🟢 已上線（--skip-duplicate-refresh CLI flag 可停用） |
| 藥師中心 DDI 頁 | 5 | 🟢 已上線（新增「重複用藥」Tab，病患選擇器共用） |
| 藥師中心 重複用藥頁 | 5 | 🟢 已上線（2026-04-24：拿掉 context 選項，改走 `selectPharmacyReviewMeds()` 過濾「住院 + 自備/院外」，後端 context default=inpatient） |
| 藥師審方工作站 | 5 | 🟢 已上線（dropdown + summary card 有 counts badge） |
| 出院管理 | 6 | 🟢 已上線（出院用藥檢查 Dialog，sup_ppi / empirical_antibiotic 等分類） |
| 病人摘要 Tab | 6 | 🟢 已上線（用藥風險卡 + 導航至用藥頁） |
| Dashboard | 6 | 🟢 已上線（每病人卡片 🔴/🟠/🟡/🔵 counts badge） |

> 圖例：⬜ 未開始 · 🟡 開發中 · 🟢 已上線 · 🔒 shadow mode

---

## 一、串接全景圖

### 1.1 現狀資料流（既有）

```
 HIS (陽明 JSON)
    │ launchd 06:00 / 18:00
    ↓
 sync_his_snapshots.py
    └─ HISConverter
         ├─ drug_formulary.csv → 註記 atc_code
         └─ upsert medications 表
    ↓
 Supabase: medications (atc_code, is_antibiotic, kidney_relevant)
    ↓
┌───────────────────────────────────────────────────────────┐
│  FastAPI 消費層（現狀）                                    │
│  ├─ GET /patients/{id}/medications (含 DDI 雙路查詢)       │
│  ├─ POST /ai-chat (組 snapshot + ddi_warnings 注入 prompt)│
│  ├─ GET /pharmacy/interactions (藥師 DDI 查詢)            │
│  └─ /clinical/summary (病人摘要聚合)                      │
└───────────────────────────────────────────────────────────┘
    ↓
 前端消費點（8 個，見 §3）
```

### 1.2 串接後資料流（目標）

```
 HIS (陽明 JSON)
    │
    ↓
 sync_his_snapshots.py
    └─ HISConverter → medications
    └─ [NEW] post_sync_hook
         └─ DuplicateDetector.precompute(patient_id)
              └─ upsert medication_duplicate_cache
    ↓
 Supabase: medications + [NEW] medication_duplicate_cache
    ↓
┌─────────────────────────────────────────────────────────────┐
│  Service 層（核心）                                          │
│  DuplicateDetector.analyze(meds) -> DuplicateAlert[]        │
│    - 一支服務，所有消費者共用                                │
│    - 純函數：接收 meds list，回傳 alerts                      │
└─────────────────────────────────────────────────────────────┘
    ↓ 被下列 5 個消費位置共用
    │
    ├─ GET /patients/{id}/medication-duplicates     [NEW]
    ├─ AI chat snapshot + duplicate_warnings        [擴充]
    ├─ GET /pharmacy/interactions                    [擴充]
    ├─ GET /patients/{id}/discharge-check           [NEW]
    └─ GET /dashboard/patient-risk-summary          [擴充]
```

---

## 二、核心服務契約（Single Source of Truth）

### 2.1 位置
`backend/app/services/duplicate_detector.py`

### 2.2 介面

```python
from dataclasses import dataclass
from typing import Literal

Level = Literal["critical", "high", "moderate", "low", "info"]
Layer = Literal["L1", "L2", "L3", "L4"]

@dataclass
class DuplicateMember:
    medication_id: str
    generic_name: str
    atc_code: str | None
    route: str | None
    is_prn: bool
    last_admin_at: datetime | None

@dataclass
class DuplicateAlert:
    fingerprint: str           # 去重用 hash(sorted(medication_ids))
    level: Level
    layer: Layer
    mechanism: str             # "PPI × PPI"
    members: list[DuplicateMember]
    recommendation: str
    evidence_url: str | None
    auto_downgraded: bool
    downgrade_reason: str | None

class DuplicateDetector:
    """Pure service — no I/O side effects except reading seed tables."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self._mechanism_groups = None  # lazy load
        self._endpoint_groups = None

    async def analyze(
        self,
        medications: list[Medication],
        *,
        context: Literal["inpatient", "outpatient", "icu", "discharge"] = "inpatient",
        reference_time: datetime | None = None,
    ) -> list[DuplicateAlert]:
        """核心進入點 —— 任何消費者都從這裡呼叫."""
```

### 2.3 設計要點
- **純函數**：輸入 `medications`（已經是 ORM 物件或 dict），輸出 alerts。**不寫任何 DB**
- **Context-aware**：ICU 情境開啟 §4 專屬規則；出院情境過濾 PRN／暫時性藥物
- **Reference time**：給「回溯某時點」的能力（例如：出院時，檢查出院用藥單 vs 住院用藥的遺漏停藥）
- **快取獨立**：快取由 Router 層或 sync hook 負責，service 不管

### 2.4 單元測試策略
`backend/tests/test_services/test_duplicate_detector.py`

- Fixture: `backend/tests/fixtures/duplicate_cases.json`（40 組黃金案例）
- 每個 test 直接 new `DuplicateDetector()` 餵入 dict list → assert alerts
- Mock `_load_mechanism_groups()` / `_load_endpoint_groups()`，不碰 DB

---

## 三、藥物資料消費者清單與串接策略

目前系統有 **8 個藥物消費點**，重複用藥判斷要串接其中 **5 個**：

| # | 消費點 | 路徑 | 串接方式 | 優先級 |
|---|--------|------|---------|--------|
| 1 | 病人用藥 Tab | `src/components/patient/patient-medications-tab.tsx` | 插入 `<MedicationDuplicateBadges />` 區塊 | **P0** |
| 2 | AI 問答 | `src/pages/ai-chat.tsx` + `app/utils/*snapshot*` | 後端 snapshot 注入 `duplicate_warnings` | **P0** |
| 3 | 藥師中心 DDI | `src/pages/pharmacy/interactions.tsx` | Tab 新增「重複用藥」子頁 | **P1** |
| 4 | 藥師審方工作站 | `src/pages/pharmacy/workstation.tsx` | 審方清單欄位新增警示 | **P1** |
| 5 | 出院用藥 | `src/pages/discharged-patients.tsx` | 出院檢查 panel 加警示 | **P1** |
| 6 | 病人摘要 Tab | `src/components/patient/patient-summary-tab.tsx` | 風險指標卡片 | **P2** |
| 7 | Dashboard | `src/pages/dashboard.tsx` | 病人風險總數 badge | **P2** |
| 8 | DDI Badge 元件 | `drug-interaction-badges.tsx` | 獨立平行元件，不共用 | — |

---

## 四、逐消費點串接細節

### 4.1 病人用藥 Tab（P0）

**資料流**：
```
[Frontend]
patient-medications-tab.tsx
  ├─ fetchPatientMedications(patientId)           [既有]
  └─ fetchMedicationDuplicates(patientId)         [NEW]
        ↓
[Backend]
routers/medications.py
  └─ GET /patients/{id}/medication-duplicates     [NEW endpoint]
      └─ load_active_medications(patient_id)
      └─ DuplicateDetector(session).analyze(meds, context="inpatient")
      └─ merge cache if exists (fall back to on-demand)
```

**UI 插入位置**：
```
<PatientMedicationsTab>
  [DDI 警示區]                  ← 既有
  [重複用藥警示區]  ← NEW: <MedicationDuplicateBadges alerts={duplicates} />
  [用藥分組清單]               ← 既有
    每個 med card 右上角小 badge → 點擊 scroll 到警示區
</PatientMedicationsTab>
```

**何時觸發重算**：
- 病人切換時（SWR key 變動）
- 有藥物新增／停用時（mutation 後 invalidate）
- SWR 的 staleTime: 30 秒

### 4.2 AI 問答（P0 — 最關鍵）

這是**把重複用藥判斷推進到 AI 決策**的關鍵串接點。

**現有流程**（已探查）：
```
ai_chat.py: _get_or_create_session()
  └─ build_clinical_snapshot()
       ├─ _get_active_medications()
       ├─ _get_latest_lab() / _get_latest_vital() / ...
       └─ extract_snapshot_key_values() → format_ddi_metadata()
  └─ system_prompt += snapshot + ddi_warnings
```

**串接方式**：在 `build_clinical_snapshot()` 新增一步。

```python
# app/utils/clinical_snapshot_builder.py
async def build_clinical_snapshot(db, patient_id):
    meds = await _get_active_medications(db, patient_id)
    snapshot = {
        "medications": ...,
        "labs": ...,
        "ddi_warnings": await format_ddi_metadata(db, meds),     # 既有
        "duplicate_warnings": await format_duplicate_metadata(    # NEW
            db, meds, context="inpatient"
        ),
    }
    return snapshot
```

**新增**：`app/utils/duplicate_check.py`
```python
async def format_duplicate_metadata(
    db, meds: list[Medication], context: str
) -> list[dict]:
    """鏡像 ddi_check.py:extract_ddi_warnings() 的結構."""
    detector = DuplicateDetector(db)
    alerts = await detector.analyze(meds, context=context)
    # 只保留 critical / high 給 LLM（避免 prompt 太長）
    return [
        {
            "level": a.level,
            "mechanism": a.mechanism,
            "members": [m.generic_name for m in a.members],
            "recommendation": a.recommendation,
        }
        for a in alerts if a.level in ("critical", "high")
    ]
```

**System prompt 注入片段範例**：
```
[重複用藥警示（自動偵測）]
- 🔴 Critical — PPI × PPI：Omeprazole + Esomeprazole
  建議：停用其中一 PPI；若為換藥過渡期，overlap ≤ 48 h 後停單方
- 🟠 High — 血清素綜合症風險：Sertraline + Tramadol
  建議：...
```

這樣 AI 被問「此病人可以加開 Nexium 嗎?」時，會自動看到已有 Omeprazole，回答會提示重複用藥。

### 4.3 藥師中心 — 藥物交互作用頁（P1）

`src/pages/pharmacy/interactions.tsx` 現在只查 DDI。擴充為雙 Tab：
```
[Tab: 交互作用]      ← 既有
[Tab: 重複用藥]      ← NEW
```

同一個病人 API 呼叫兩個 endpoint：`/medications`（已含 DDI）+ `/medication-duplicates`（新）。

### 4.4 藥師審方工作站（P1）

`src/pages/pharmacy/workstation.tsx` 通常顯示多位病人審方清單。

**UI 改動**：每位病人一列，新增「🔴×2 🟠×1」小標籤（Critical 2 條、High 1 條重複用藥）。點擊展開看詳情。

**後端 API**：需要**批次查詢**端點（避免 N+1）：
```
POST /pharmacy/duplicate-summary
body: { patient_ids: [id1, id2, ...] }
→ { id1: {critical: 2, high: 1}, id2: {...} }
```

### 4.5 出院管理（P1）

`src/pages/discharged-patients.tsx`（最近新增的分支功能）。

**關鍵場景**：出院用藥與住院用藥比對，抓「出院忘記停掉的重複」。

**串接**：
```
GET /patients/{id}/discharge-check
 └─ load inpatient_medications (as of discharge_date)
 └─ load discharge_medications
 └─ DuplicateDetector.analyze(discharge_medications, context="discharge")
 └─ 額外比對：inpatient 有但 discharge 沒有的「應停藥物」（PPI for SUP 的經典陷阱）
```

**上層視圖**：出院 checklist 上顯示「🔴 SUP PPI 未停：入院時開立 IV Pantoprazole（SUP），出院單未註記停藥，出院又開 PO Omeprazole」。

### 4.6 病人摘要 Tab（P2）

`patient-summary-tab.tsx` 加一張風險卡片：
```
[用藥風險]
  DDI:            Critical 1 / High 2
  重複用藥:        Critical 0 / High 1   ← NEW
  過敏衝突:        —
```

### 4.7 Dashboard（P2）

`dashboard.tsx` 病人列加一個 🔴 small badge，點擊直接跳到藥物 tab。

---

## 五、快取策略

生產 2,597 筆 medications，單一病人通常 10–30 筆。DuplicateDetector 單次 < 100 ms 應可接受。但 Dashboard／審方清單的批次查詢需要快取。

### 5.1 新增快取表

```sql
CREATE TABLE medication_duplicate_cache (
  patient_id         VARCHAR PRIMARY KEY,
  computed_at        TIMESTAMP NOT NULL,
  medications_hash   VARCHAR(64),   -- SHA256(sorted medication_ids + atc_codes + last_updated)
  alerts_json        JSONB NOT NULL,
  context            VARCHAR(20),
  counts             JSONB          -- {critical: 2, high: 1, ...} 給 dashboard 快速讀
);

CREATE INDEX idx_mdc_computed_at ON medication_duplicate_cache(computed_at);
```

### 5.2 快取策略

| 時機 | 行為 |
|------|------|
| HIS sync 完成（post_sync_hook） | 逐病人 precompute，寫入 cache |
| 使用者手動新增／停用藥物 | 該病人 cache invalidate + 立即重算 |
| Router 命中時 | 先讀 cache；`computed_at > meds.updated_at` 且 `medications_hash` 相符 → 直接回；否則重算並寫回 |
| 定期 TTL | 無 TTL（靠 hash 比對），避免定時 job |

### 5.3 批次查詢最佳化

Dashboard / Workstation 的批次呼叫直接讀 `medication_duplicate_cache.counts`，不重算。Miss 的病人排入 background job。

---

## 六、HIS Sync Post-processing Hook

`backend/scripts/sync_his_snapshots.py` 目前結構：
```python
async def sync_snapshot_into_session():
    # upsert medications, labs, cultures...
    ...

async def upsert_global_sync_status():
    ...
```

**新增 hook**：
```python
# 在 sync_snapshot_into_session 完成後、upsert_global_sync_status 之前
from app.services.duplicate_detector import DuplicateDetector
from app.services.duplicate_cache import refresh_patient_cache

async def post_sync_refresh_duplicates(session, affected_patient_ids):
    """只重算有藥物異動的病人."""
    detector = DuplicateDetector(session)
    for pid in affected_patient_ids:
        meds = await load_active_medications(session, pid)
        alerts = await detector.analyze(meds, context="inpatient")
        await refresh_patient_cache(session, pid, alerts, meds)
```

**失敗隔離**：hook 失敗不得阻斷 HIS sync 主流程。用 try/except + log + 放入 `sync_retry_queue`。

---

## 七、API 層完整清單

| Endpoint | Method | 用途 | 快取 |
|----------|--------|-----|------|
| `/patients/{id}/medication-duplicates` | GET | 單一病人完整 alerts | Yes（cache table） |
| `/pharmacy/duplicate-summary` | POST | 批次病人 counts | Yes |
| `/patients/{id}/discharge-check` | GET | 出院比對（含重複） | No（少用） |
| `/ai-chat/*` | — | 不新增，改 snapshot builder | N/A |

所有端點都走同一個 `DuplicateDetector.analyze()`，確保結果一致。

---

## 八、前端共用元件

### 8.1 新增
`src/components/patient/medication-duplicate-badges.tsx`
- 沿用 `drug-interaction-badges.tsx` 視覺語言
- Props: `alerts: DuplicateAlert[]`
- 可獨立被 patient-medications-tab / pharmacy-interactions / discharge-check 使用

### 8.2 API client
`src/lib/api/medications.ts` 新增：
```typescript
export interface DuplicateAlert { ... }
export async function fetchMedicationDuplicates(patientId: string): Promise<DuplicateAlert[]>
export async function fetchPharmacyDuplicateSummary(patientIds: string[]): Promise<Record<string, {critical: number, high: number}>>
```

### 8.3 SWR key 設計
```typescript
useSWR(['medication-duplicates', patientId], ...)
// 藥物 mutation 後：mutate(['medication-duplicates', patientId])
```

---

## 九、上線順序與相依關係

### Wave 1：核心管線（1 週）
1. Migration 063（新增 detection tables + cache table；062 已佔用）
2. `DuplicateDetector` service + 單元測試
3. Seed `drug_mechanism_groups` P0 清單（alpha1_blocker、serotonergic、qtc_prolonging、cns_depressant、raas_blockade、bleeding_risk、nephrotoxic_triple_whammy）
4. `GET /patients/{id}/medication-duplicates` endpoint

### Wave 2：前端第一個消費點（3 天）
5. `medication-duplicate-badges.tsx`
6. 串入 `patient-medications-tab.tsx`
7. Shadow mode 一週（藥師人工對比結果）

### Wave 3：AI 串接（3 天）
8. `format_duplicate_metadata` + snapshot builder 串接
9. System prompt template 更新

### Wave 4：快取與 HIS sync hook（3 天）
10. `medication_duplicate_cache` 表 + refresh 邏輯
11. `post_sync_refresh_duplicates` hook

### Wave 5：藥師中心與審方（4 天）
12. `/pharmacy/duplicate-summary` 批次端點
13. Pharmacy interactions 頁加 tab
14. Pharmacy workstation 清單 badge

### Wave 6：出院與 Dashboard（3 天）
15. Discharge check endpoint + panel
16. Patient summary 風險卡片 + Dashboard badge

### Wave 7：Phase 2 擴充（後續 iteration）
17. L3 / L4 完整清單擴充至 P1 / P2
18. ICU 專屬規則
19. 覆寫 UI + feedback 表 + KPI dashboard

---

## 十、整合測試計畫

### 10.1 合約測試（Contract test）
所有消費點呼叫 `DuplicateDetector.analyze()` 的 fixture 結果需一致。
- `backend/tests/test_integration/test_duplicate_consumers.py`
- 準備 5 位合成病人 → 各自算一次 → 各消費點（API、AI snapshot、cache）應得同一 `fingerprint` 集合

### 10.2 E2E 測試
- `tests/e2e/duplicate-medication.spec.ts`（Playwright）
- 登入 → 打開特定病人 → 看到 `<MedicationDuplicateBadges>` → 新增一條 PPI → badge 立即更新

### 10.3 Shadow mode 驗收
Wave 2 後，生產開啟 feature flag：
- 系統照跑，但不顯示 UI，只寫入 `duplicate_alert_shadow_log`
- 藥師每週對比 10 位病人人工審方結果 vs 系統偵測 → 計算 PPV／漏網率
- 目標：PPV > 70%、漏網率 < 5% 才開放 UI

---

## 十一、特殊情境決策

| 情境 | 決策 |
|------|------|
| 15.4% 無 ATC 的藥品 | 以 `ingredient` 字串比對作 fallback；UI 註記「部分藥品未分類」 |
| 停藥但未刪除的 records | 以 `status='active'` 過濾；cache 以 `medications.updated_at` 觸發失效 |
| 複方藥（FDC） | `medication.ingredients` 陣列比對；Metformin 單+複方為 P0 測試案例 |
| PRN 藥 | `is_prn=True` 觸發自動降級；但若為 long-acting（如 Fentanyl patch）仍視為活躍 |
| 出院時 | `context="discharge"`；抓「該停未停」而非「不該一起用」 |
| 快取未命中 & detector timeout | Fall back 回「資料準備中」狀態，避免阻塞 UI |

---

## 十二、對接點摘要（一頁速查）

```
┌──────────────────────────────────────────────────────────┐
│  單一進入點                                                │
│  app/services/duplicate_detector.py                       │
│    DuplicateDetector(session).analyze(meds, context=...)  │
└──────────────────────────────────────────────────────────┘
         │ 被以下 5 個位置消費
         │
         ├─[HIS sync hook]   post_sync_refresh_duplicates()
         │     → 寫入 medication_duplicate_cache
         │
         ├─[REST API]        /patients/{id}/medication-duplicates
         │     → patient-medications-tab.tsx
         │     → pharmacy/interactions.tsx (Tab 2)
         │     → discharged-patients.tsx
         │
         ├─[AI snapshot]     format_duplicate_metadata()
         │     → build_clinical_snapshot()
         │     → system_prompt 注入
         │
         ├─[批次 API]        /pharmacy/duplicate-summary
         │     → pharmacy/workstation.tsx
         │     → dashboard.tsx
         │
         └─[Discharge check] /patients/{id}/discharge-check
               → discharged-patients.tsx（出院 checklist）
```

---

## 附錄 A：「帶入患者藥物判斷有沒有重複」的最簡呼叫範例

**後端**（從任何 service 呼叫）：
```python
from app.services.duplicate_detector import DuplicateDetector

async def check_patient(db, patient_id: str):
    meds = await load_active_medications(db, patient_id)
    detector = DuplicateDetector(db)
    alerts = await detector.analyze(meds, context="inpatient")
    critical = [a for a in alerts if a.level == "critical"]
    return {"has_duplicate": len(critical) > 0, "alerts": alerts}
```

**前端**（從任何頁面呼叫）：
```typescript
import { fetchMedicationDuplicates } from '@/lib/api/medications'

const { data: duplicates } = useSWR(
  ['medication-duplicates', patientId],
  () => fetchMedicationDuplicates(patientId)
)
```

**AI 問答**（自動已含，無需額外呼叫）：
AI 在 system prompt 裡已看到 `duplicate_warnings`，對話中直接會提醒。

---

## 附錄 B：與既有 DDI 的對照

| 能力 | DDI（既有） | 重複用藥（新） |
|-----|------------|--------------|
| Service 位置 | `utils/ddi_check.py` + `drug_graph_bridge.py` | `services/duplicate_detector.py` |
| Cache | 單進程 in-memory | DB `medication_duplicate_cache` 表 |
| AI snapshot 注入 | `format_ddi_metadata()` | `format_duplicate_metadata()` |
| 前端元件 | `drug-interaction-badges.tsx` | `medication-duplicate-badges.tsx`（平行） |
| API 路徑 | 內嵌於 `/medications` | 獨立 `/medication-duplicates` |
| 批次端點 | 無 | `/pharmacy/duplicate-summary` |
| HIS sync hook | 無 | `post_sync_refresh_duplicates` |

