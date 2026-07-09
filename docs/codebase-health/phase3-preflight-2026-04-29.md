# Phase 3 Preflight — Patient Detail 大整理

- **日期**：2026-04-29
- **目的**：Phase 3.1（aggregate endpoint）+ Phase 3.2（patient-detail.tsx 拆檔）動工前，量測現況、列出邊界、決定是否合併執行
- **方法**：3 個 agent 平行調查（API fan-out / 拆檔邊界 / 線上量測）
- **本檔不改任何代碼**

---

## 1. API fan-out 現況（agent 1）

### 進入單一病人頁觸發的 13 個 API call

| API | 端點 | 觸發階段 | 並發/序列 | 首屏需要 |
|---|---|---|---|---|
| `getPatient` | `/patients/{id}` | 行 530 Promise.all | 並發 | ✅ 必要 |
| `getLatestLabData` | `/patients/{id}/lab-data/latest` | 行 530 Promise.all | 並發 | ✅ 必要 |
| `getMedications` | `/patients/{id}/medications?status=all` | 行 530 Promise.all | 並發 | ✅ 必要 |
| `getMessages` | `/patients/{id}/messages` | 行 530 Promise.all | 並發 | ⚠️ 只 unread badge 用，可延後 |
| `getLatestVitalSigns` | `/patients/{id}/vital-signs/latest` | 行 530 Promise.all | 並發 | ✅ 必要 |
| `getLatestVentilatorSettings` | `/patients/{id}/ventilator/latest` | 行 530 Promise.all | 並發 | ✅ 必要 |
| `getWeaningAssessment` | `/patients/{id}/ventilator/weaning-assessment` | 行 530 Promise.all | 並發 | ⚠️ 摘要 tab 用，可延後 |
| `getLatestScores` | `/patients/{id}/scores/latest` | 行 550 await | **序列**（卡 Promise.all 後） | ⚠️ 摘要小卡用，可延後 |
| `fetchChatSessionsApi` | `/ai/sessions?patientId=...` | 行 554 await | **序列**（再卡 scores 後） | ❌ 對話 tab 才需要 |
| `getPresetTags` | `/patients/{id}/messages/preset-tags` | 行 648 useEffect | 並行 | ❌ 留言 tab 才用 |
| `getCustomTags` | `/patients/{id}/messages/custom-tags` | 行 648 useEffect | 並行 | ❌ 留言 tab 才用 |
| `getPharmacyTags` | `/patients/{id}/messages/pharmacy-tags` | 行 651 fire-and-forget | 並行 | ❌ 留言 tab 才用 |
| `getSymptomRecords` | `/patients/{id}/symptom-records` | 摘要 tab onMount | 條件 | ❌ 摘要 tab 才用 |

### 關鍵路徑（首屏白屏到顯示）

```
[7 並發 (行 530)] → await loadLatestScores → await fetchChatSessionsApi
                                                       ↓
                                           setPatientLoading(false)
```

→ **9 個 RTT 才解除 loading**。Roadmap 寫 4-7 是低估，實際更糟。

---

## 2. 線上量測（agent 3）

### 8 個首屏端點 TTFB 中位數（未認證 401，3 次取中位）

| 端點 | TTFB |
|---|---|
| `/patients/{id}` | 0.585s |
| `/patients/{id}/medications` | 0.701s |
| `/patients/{id}/messages` | 0.598s |
| `/patients/{id}/lab-data/latest` | 0.696s |
| `/patients/{id}/vital-signs/latest` | 0.404s |
| `/patients/{id}/ventilator/latest` | 0.595s |
| `/ai/sessions?patientId={id}` | 0.636s |
| `/patients/{id}/scores/latest` | 0.498s |
| `/health` baseline | 0.605s |

### 三種模式總時間估計

| 模式 | 估計總時間 |
|---|---|
| **Serial 8 RTT** | ≈ 4.7s（最壞情境） |
| **Parallel Promise.all + 2 await tail** | ≈ 1.5–2.0s（受 slowest + serial tail 拖累） |
| **Aggregate `/patients/{id}/bootstrap`** | ≈ 0.6s（1 RTT + server-side parallel） |

→ Aggregate 預期 **省 0.5–1.0s p95**，對行動網路（高 RTT）受益更大。

### Bundle 現況

| Chunk | raw | gzip |
|---|---|---|
| `index` 主入口 | 361 KB | 112 KB |
| `vendor` | 164 KB | 54 KB |
| **`patient-detail`**（已 lazy） | 213 KB | 59 KB |
| `charts`（recharts） | 421 KB | 114 KB |
| `ai-chat` | 34 KB | 11 KB |

`patient-detail` 已在獨立 chunk，但進頁額外拉 `charts` (114 KB gz)。

---

## 3. 拆檔邊界（agent 2）

### 6 個 tab 抽出狀態

| Tab | 行範圍 | 抽出狀態 |
|---|---|---|
| `chat` | 1437-1932（**~496 行**） | ❌ **未抽**（`patient-chat-tab.tsx` 空殼已存在） |
| `messages` | 1935-1956 | ✅ `<PatientMessagesTab>` |
| `records` | 1959-1966 | ✅ `<MedicalRecords>` |
| `labs` | 1970-2003 | ✅ `<PatientLabsTab>` |
| `meds` | 2006-2031 | ✅ `<PatientMedicationsTab>` |
| `summary` | 2034-2040 | ✅ `<PatientSummaryTab>` |

### 拆檔最大槓桿：chat tab

抽 chat tab 出去：
- 釋出 ~700 行（含 14 個 chat-only useState + 多 callback + JSX）
- patient-detail.tsx 從 2072 → ~1300 行
- 已有空殼 `src/components/patient/patient-chat-tab.tsx` 等填

### Cross-tab 共享 state（**不可** 盲目搬到子元件）

- `patient` / `labData` / `allMedications`：多 tab 共讀，留父層或 Context
- `activeTab`：summary 會 `setActiveTab('meds')`，**留父層**
- `vitalSigns` / `ventilator` / `weaningAssessment`：labs tab 用，但 update callback 寫回父
- `scores` hook：放 meds tab，但 `scoreTrendOpen` modal 視覺上獨立
- `selectedTrendMetric` / `editingPatient`：對應 dialog 渲染在 Tabs 外面

---

## 4. 是否合併 3.1（aggregate endpoint）+ 3.2（拆檔）？

### 合併執行的好處

- 一次 PR review
- aggregate 開出來時順便重構消費端
- 兩個改動互相驗證（少一輪部署）

### 分開執行的好處

- 風險類型不同：3.1 是後端 + 前端 fetch 邏輯（latency），3.2 是純前端 component split（維護性）
- 可分階段量測：先 3.1 量 RTT 改善，再 3.2 量 bundle/render 改善
- 分開好 rollback：若 aggregate endpoint 出 bug，不會卡 chat tab 拆檔

### 我的建議：**分開做**

| 順序 | 內容 | 估時 | 預期收益 |
|---|---|---|---|
| **3.1 先** | 後端開 `/patients/{id}/bootstrap`（initial bundle）+ 前端 patient-detail.tsx 改用單一 endpoint + scores/chat-sessions/tags 移到 lazy | 1.5-2 天 | **省 0.5-1.0s p95**，13 API → 1+5 lazy |
| 3.1 部署觀察 1 週 | 量 prod p50/p95 latency 改善 | — | 確認 aggregate 設計正確 |
| **3.2 後** | 拆 chat tab → `patient-chat-tab.tsx` + 加 React.memo + Context | 1-2 天 | patient-detail.tsx 2072 → ~1300 行 |
| 3.4 順手 | tab lazy（其他 tab 已抽出，只需 wrap 一層 React.lazy） | 半天 | 進頁 chunk 從 59KB gz 估 → 35-40KB gz |
| **3.3 收尾** | `dashboard-stats-cache.ts` 整檔刪、改純 TanStack（已有 callsite list） | 半天 | 完全收斂雙軌 cache |

---

## 5. 動 Phase 3.1 前還要決策的事

1. **Aggregate endpoint 的 URL 與 schema**：
   - 建議 `GET /patients/{id}/bootstrap`，回傳 `{ patient, latestLab, medications, latestVitals, latestVentilator }`
   - 不包含 weaning / messages / scores / chat sessions / tags（這些 lazy）
   - **不**做成「全包」（首屏永遠夠用就好）

2. **scores 與 weaning 的處置**：
   - (a) fire-and-forget（不 await，UI 後到後填）
   - (b) 移到摘要 tab onMount
   - 建議 (a) — 不影響白屏結束

3. **後端 endpoint 實作**：
   - 用 SQLAlchemy `selectinload` 一次帶出所有需要的 relation？
   - 還是 `asyncio.gather` 並行 query？
   - 哪個對 pooler 友善（Phase 0 #1 已處理 pooler 設定）？

4. **前端 patient-detail.tsx 的 fetch 改寫**：
   - 整個 `loadPatientBundle` 函式重寫
   - error handling: aggregate 失敗 → 退回 5 個獨立 API（safety net）？還是直接顯示錯誤？

5. **要不要先寫 invariant 測試**（如 Phase 1 D3 那樣）？
   - aggregate 取代 5 個 endpoint，需 contract 測試確保 schema 對應
   - 建議寫 1-2 個快樂路徑 + 邊界 case（patient 不存在、沒 vitals）

---

## 6. 結論 / 等你決策

| 決策點 | 建議 |
|---|---|
| 3.1 vs 3.2 順序 | **分開**做，3.1 先 |
| Aggregate scope | 5 個首屏必要欄位（patient/lab/med/vital/vent）；其他 lazy |
| scores / chat / tags | 移到 lazy（tab onMount 觸發） |
| Aggregate endpoint URL | `GET /patients/{id}/bootstrap`（建議） |
| 後端實作策略 | `asyncio.gather` 並行 query |
| Error fallback | 失敗回退 5 個獨立 API（safety net） |
| 先寫測試 | 是（Phase 1 D3 模式：先測再改） |

回我「同意 / 改哪些」我就動 3.1。

---

## 附錄 A：每個 agent 的 raw 結論

- **Agent 1（API fan-out）**：13 個 API、9-RTT serial chain、最小 set 5 個並發即可顯示頁面骨架
- **Agent 2（拆檔邊界）**：6 個 tab 已抽 5 個，剩 chat tab（496 行）；patient/labData/allMedications/activeTab 等需留父層
- **Agent 3（線上量測）**：8 個 endpoint TTFB 中位數 ~0.6s；aggregate 預期省 0.5-1.0s p95；patient-detail chunk 59 KB gz 已 lazy

完整 raw 結論存於 4 月 29 日 conversation log。
