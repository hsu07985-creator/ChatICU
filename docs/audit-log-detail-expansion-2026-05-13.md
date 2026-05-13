# 稽核紀錄細節深化（2026-05-13）

> 本輪追加 `audit_logs.details` 的內容深度與覆蓋率，回應「追蹤每位用戶細節更詳細」的需求。涵蓋 [維度 1：before/after diff] + [維度 2：補關鍵缺口]。
>
> 上游審查：見「現況盤點」段落（57 個既有埋點對照表）— 本 doc 不重複。

---

## 0. 範圍

| 維度 | 處理 | 不處理（保留 backlog） |
|---|---|---|
| 內容深度（before/after diff） | ✓ 5 個 update 端點 / create 深化 1 個 | — |
| 覆蓋率（明顯缺口） | ✓ scores.py POST/DELETE、symptom_records.py POST | AI chat（量大需 granularity 設計）、notifications mark-read |
| 追蹤性（correlation） | — | request_id / user-agent / X-Forwarded-For（要動 middleware） |
| 視角（timeline view） | — | 前端 UX，等資料齊再做 |
| 法規（retention / append-only） | — | 需要先回答法規問題（HIPAA / PDPA / 醫療法 70 條） |

---

## 1. 設計：`diff_dict` helper

`backend/app/middleware/audit.py` 新增兩個 helper：

```python
diff_dict(before: dict, after: dict, *, include=None, exclude=None,
          max_value_chars=200) -> dict
```

回傳：
```json
{
  "changes": {
    "bed_number":  { "from": "I-17", "to": "I-18" },
    "is_isolated": { "from": false,  "to": true }
  },
  "fields_changed": ["bed_number", "is_isolated"]
}
```

設計選擇：
- **shape 是 `changes.{field}.{from,to}`** — audit diff 的金本位，未來 details Drawer 可以做 visual diff
- **`fields_changed` 保留** — 向後相容前端既有讀法
- **長字串截 200 字 + `…`** — clinical assessment 可能上千字，JSONB row 必須有上限
- **datetime / date 自動 ISO 8601 化**（UTC for datetime）— Postgres JSONB 序列化保險
- **敏感欄位**仍由現有 `_mask_sensitive` 在 `create_audit_log` 內遞迴 mask；`changes.password.{from,to}` 整個 `password` 鍵會被 mask 成 `***MASKED***`（保留「password 有改」事實，不洩漏 hash）

```python
snapshot_fields(obj, fields) -> dict
```
從 ORM object 或 dict 抓欄位的便利函式，用於 update 端點開頭抓 before-state。

---

## 2. 變更明細

### Wave 1 — `diff_dict` helper + 5 個 update / create 端點接 diff

| 端點 | 動作 | details 變化 |
|---|---|---|
| `patients.py:527` `PATCH /{patient_id}` | 更新病患資料 | 從 `fields_changed=[...]` → `changes.{field}.{from,to}` + airway 日期手動補 |
| `medications.py:402` `PATCH /{medication_id}` | 更新藥物 | 從 `fields_changed=[...]` → `changes.{field}.{from,to}` |
| `admin.py:315` `PATCH /users/{user_id}` | 更新使用者 | 從 `fields_changed=[...]` + `target_user_id` → `changes.{field}.{from,to}` + `target_user_id`；password 改動會記入 changes 但 mask 成 `***MASKED***` |
| `ventilator.py:166` `POST /` 呼吸器設定 | 手動輸入呼吸器設定 | 從 `details={ventilator_id}` → `details={ventilator_id, settings: {mode, fio2, peep, tidal_volume, respiratory_rate, inspiratory_pressure, pressure_support, ie_ratio, pip, plateau, compliance, resistance}}` — 整套參數 snapshot（事故回溯需要每一個轉鈕） |

> 不接 diff：`patients.py:648` archive（單 flag 翻轉，diff 無意義）、`medications.py:436` administration（status patch 已記）

### Wave 2 — 補新埋點

| 端點 | 新增 audit | details 內容 |
|---|---|---|
| `scores.py:99` `POST /patients/{id}/scores` | `action="記錄臨床評分"` | `score_id, score_type, value, notes` |
| `scores.py:124` `DELETE /patients/{id}/scores/{score_id}` | `action="刪除臨床評分"` | `score: <被刪整筆 dict>` — 刪除後 audit log 是唯一存證 |
| `symptom_records.py:56` `POST /patients/{id}/symptom-records` | `action="新增病人症狀記錄"` | `record_id, symptoms, previous_symptoms, notes` — 同時記錄前後 symptoms |

理由：RASS / PAIN 評分直接影響鎮靜處置決策，**P0 漏埋**；症狀記錄是診療關鍵。

### Wave 3 — 文件（此檔）

---

## 3. 上游盤點修正

原盤點報告把以下三點寫錯，本輪修正：
- `clinical.py:641` 是「文本修飾」(AI polish)，**不是** update clinical assessment
- `clinical.py:923` 是「交互作用查詢」，**不是** 完成臨床評估
- `ventilator.py:210` 是 **POST create**，不是 update

→ 真實的 UPDATE 端點只有 `patients / medications / admin` 三個，故 W1 只處理 3 個 update + 1 個 create 深化（ventilator）。

---

## 4. 不處理（明確 backlog）

### B1：AI chat 埋點（`ai_chat.py:104, 576, 832, 976, 997, 1116`）
量大（一天可能千筆訊息），需要先設計 granularity：
- 選項 (a)：每 session 一筆 audit（session 開始 / 結束）
- 選項 (b)：每訊息一筆（量爆）
- 選項 (c)：critical actions 一筆（刪 session、feedback negative）
建議：(a) + (c)。等使用者回「法規面是否要每訊息都留證」再動。

### B2：correlation_id / request_id
要動 middleware 把 `X-Request-ID` 串進 audit log。改 helper 簽名（多一個 optional `request_id` 參數）+ middleware 改 inject。Backlog。

### B3：真實 IP（X-Forwarded-For）
目前用 `request.client.host`，Vercel proxy 後拿到的是 proxy IP，不是使用者 IP。需要解析 `X-Forwarded-For` 並信任 Vercel proxy。Backlog。

### B4：notifications mark-read
群體可見的 `is_read` flag，理論上影響其他人通知徽章。量也大。優先級低，留 backlog。

### B5：retention / append-only enforcement
資料庫層級的 append-only（trigger 禁止 UPDATE/DELETE）只有 `drug_library_audit_log` 有（migration 072）。`audit_logs` 主表沒擋。要不要擋 → 法規問題。Backlog。

---

## 5. 驗證

- `python3 -c "import ast; ast.parse(...)"` 對 7 個改動檔案全過
- 沒有 schema migration（純應用層）
- 改動只在後端 → 部署只需 `git push personal main`，不必 push railway
- `_mask_sensitive` 既有遞迴行為對新的 `changes.{password}.{from,to}` 也成立（手動驗證：key 名稱命中 `SENSITIVE_KEYS`，整個 value 被覆蓋）

---

## 6. 進度追蹤

- [x] W1：diff_dict + 4 個 update 端點接 diff + ventilator create 深化
- [x] W2：scores POST/DELETE + symptom_records POST 新埋點
- [x] W3：文件
- [x] B1：AI chat 埋點（粗粒度 — 2026-05-13）  
      _4 個 critical-action 端點：session create（在 chat_stream 內偵測 `was_created`）、session DELETE（含 `message_count` 快照）、session PATCH（title diff）、message feedback PATCH（含 previous_feedback）。`POST /chat/stream` 每訊息**不**埋，遵守粗粒度核心決策。`_get_or_create_session` 簽名改為 `Tuple[AISession, bool]`。_
- [ ] B2：correlation_id middleware
- [ ] B3：X-Forwarded-For 真實 IP
- [ ] B4：notifications mark-read
- [ ] B5：append-only enforcement（法規決策後）
