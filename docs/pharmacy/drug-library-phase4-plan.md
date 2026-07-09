# 藥物資料庫管理系統 — Phase 4 計畫

**狀態**：設計確認中  
**起草日期**：2026-04-28  
**負責**：藥事工具團隊  
**審核**：架構 / 臨床藥師 / 合規 / UX 四方 agent 平行審核

---

## 1. 背景

### 現狀（Phase 1-3 已上線）
- `/pharmacy/drug-library` 唯讀目錄頁
- DB：`drug_interactions` 10,308 row（X 2,191 / D 2,720 / C 4,195 / B 1,185 / A 13），`iv_compatibilities` 1,041 row
- 來源：MICROMEDEX DrugDex (Risk X/D/C/B/A) + Lexicomp 2026 + UpToDate + Trissel's Handbook
- 純圖書館定位，已與病人資料解耦

### 為什麼要做 Phase 4
**藥師反饋**：純看不夠，需要：
- **A. 編輯能力**（維基百科後台）：合併重複、修錯字、新增規則、標 deprecated
- **D. 規則治理**：院內 override、覆蓋率高的規則檢視、版本快照可回溯

**使用者**：藥師 + 系統管理者（院內角色 `pharmacist` + `admin`）

---

## 2. 4-Agent 平行審核共識

### 必修事項（4 agent 一致同意）

| # | 項目 | 提出方 | 嚴重度 |
|---|---|---|---|
| 1 | **Override 用 Option C**（schema 隔離 + COALESCE read-time），不要 A 或 B | 架構 / 藥師 / 合規 / UX | 🔴 必須 |
| 2 | **嚴重度降級必須 4-eye（2 人簽）**，X 永不可單方降 | 藥師 / 合規 | 🔴 必須 |
| 3 | 加 `valid_from` / `valid_to` **bitemporal versioning** | 架構 / 合規 | 🔴 必須 |
| 4 | Audit log 改 **append-only Postgres trigger**（7 年保留期，醫療法 §70）| 合規 | 🔴 必須 |
| 5 | Etag/version 欄位實作**樂觀鎖**（同時編寫拒絕 409） | 架構 | 🟡 建議 |
| 6 | `dedup_key` UNIQUE 改 **partial index** `WHERE is_active = TRUE`，避免下次 Lexicomp 匯入衝突 | 架構 | 🟡 建議 |
| 7 | Reason 必填 ≥30 字、Citation（PubMed/UpToDate/院內共識）不可省 | 藥師 / 合規 | 🟡 建議 |
| 8 | **編輯模式 = posture toggle**（sidebar 切換 `檢視/編輯`），不是散落 icon | UX | 🟡 建議 |
| 9 | Audit log 變 **inline per row + 管理 tabs**，不獨立頁 | 藥師 / UX | 🟡 建議 |
| 10 | 治理面板要做成 **worklist**（可指派、saved filter），不是純 dashboard | 藥師 / UX | 🟡 建議 |
| 11 | Merge 流程 **2-step + diff preview + 打字確認** | UX | 🟡 建議 |

### 工期重新評估（共識）

| Phase | 原估 | 實估 | 為什麼變 |
|---|---:|---:|---|
| 4a edit core | 2d | **4-5d** | etag、軟刪 cascade、permission test、bitemporal、audit trigger 都藏在裡面 |
| 4b merge + create | 1d | **3d** | 2-step 確認 + dedup_key 重寫 + cache 失效 |
| 4c governance | 1d | **3d** | worklist、saved filter、可指派 |
| 4d audit history | 0.5d | **1d** | 改 inline 比想像複雜 |
| **合計** | **4.5d** | **~12d** | 翻倍，含合規 + 多人協作 |

---

## 3. 關鍵設計決策

### D1：Override 模型 — **Option C（schema 隔離 + COALESCE）**

```sql
-- 來源欄絕對不動（Lexicomp 怎麼說就怎麼存）
risk_rating          VARCHAR  -- e.g. 'X' (來源)
severity             VARCHAR  -- e.g. 'contraindicated' (來源)

-- 院內覆寫欄（NULL = 沒覆寫）
override_risk_rating VARCHAR  NULL  -- e.g. 'C'
override_severity    VARCHAR  NULL
override_reason      TEXT     NULL  -- ≥30 chars
overridden_by        VARCHAR  NULL  -- user.id
overridden_at        TIMESTAMPTZ NULL
override_expires_at  TIMESTAMPTZ NULL  -- 強制年度 re-verify
```

讀取時：
```sql
SELECT
  COALESCE(override_risk_rating, risk_rating) AS effective_risk,
  risk_rating AS source_risk_rating,
  override_reason,
  override_expires_at
FROM drug_interactions WHERE ...
```

API 回傳同時帶 `effective_risk` + `source_risk_rating`，前端顯示「Lexicomp 說 D / 院內降為 C，理由：…，到期 2027-04-28」。

### D2：4-eye 簽核分級

| 動作 | 簽核需求 |
|---|---|
| 加 `pharmacist_note`（備註） | 1 人即可 |
| 標 `last_verified_at`（已核對） | 1 人即可 |
| 改 `mechanism` / `management` 文字 | 1 人即可（記 audit + reason ≥30 字） |
| **嚴重度變動**（severity / risk_rating） | **2 人簽**（proposed_by + approved_by 不可同人） |
| **soft-delete**（is_active = false） | **2 人簽** |
| **創 override**（任何 severity 變動形式） | **2 人簽** |
| 新增規則 | 1 人提議 → 1 人 approve |
| **X → 任何降級** | **永遠禁止**（即使 2 人簽也不行）|

### D3：權限分層

不再平等的 `pharmacist`，分 3 級：

| 角色 | 可做 |
|---|---|
| `pharmacist_proposer`（rotator / 新人） | 提議任何變動 → 進 queue 等資深批 |
| `pharmacist_editor`（資深 ≥2y） | 直接編 Moderate / Minor 文字、加備註、標核對；提議 Major / X |
| `pharmacist_director`（藥劑部主任 / 設計） | approve Major / Contraindicated 變動、所有 override |
| `admin` | 同 director |

---

## 4. 分階段路線圖

### 4a — 編輯核心（**MVP-Lite**，建議**先做這個**）
**範圍**：只加「貼便利貼」能力，不改原 row、不 override、不 merge
- DB 加 `pharmacist_note`、`last_verified_at`、`verified_by`、`is_active`、`etag`
- 新表 `drug_library_audit_log`（append-only via Postgres trigger）
- API：
  - `PATCH /pharmacy/drug-library/rules/{id}/note`（任一藥師）
  - `POST /pharmacy/drug-library/rules/{id}/verify`（任一藥師）
  - `POST /pharmacy/drug-library/rules/{id}/deprecate`（reason ≥30 字，**先單人即可**，後階段加 4-eye）
  - `GET /pharmacy/drug-library/rules/{id}/history`
- 前端：
  - Sidebar header 「**編輯模式**」toggle（`pharmacist` + `admin` 才看得到，per-session 持久化）
  - 編輯模式 ON：DDI 卡顯示 inline rail（備註欄 + 「標記已核對」+ 「標 deprecated」+ 「歷史」連結）
  - 編輯模式 OFF：跟現在一模一樣
  - 「歷史」點開 modal 顯示該規則的 audit log（時間 / 動作 / 誰）
- **acceptance**：藥師能加備註、標核對、軟刪除；軟刪後該 row 不再出現在 read-only 介面；audit log 完整紀錄
- **工期估**：2-3 天

### 4b — Override + 嚴重度修改（含 4-eye）
- DB 加 override 6 欄 + `valid_from/valid_to` (bitemporal) + `proposed_by/approved_by` 簽核欄
- 加 partial UNIQUE on dedup_key (`WHERE is_active = TRUE`)
- audit trigger 強化：trap UPDATE/DELETE 並 reject（append-only）
- API：
  - `POST /rules/{id}/propose-override`（任一藥師提議）
  - `POST /rules/{id}/approve-override`（director 批准 → 生效）
  - `PATCH /rules/{id}/text`（mechanism/management 文字編輯，1 人即可）
  - `PUT /rules/{id}` with etag header（樂觀鎖）
- 前端：
  - DDI 卡顯示「來源 Lexicomp X / 院內降為 C — by 王藥師 reason: ... 到期 2027-04-28」**並列**（非 strike-through）
  - 提議流程 2-step（填 reason → 預覽 → 確認）
  - approver 的「待批准」工作清單
- **工期估**：4-5 天（含 bitemporal、4-eye workflow）

### 4c — Merge / 新增規則
- API：
  - `POST /rules/merge` — 2-step diff preview，typed confirm，可 24h 內 revert
  - `POST /rules` — 新增規則（含 reason、citation 必填）
- 前端：合併 wizard、新規則表單
- **工期估**：3 天

### 4d — 治理 worklist
- 新頁 `/pharmacy/drug-library/管理`（tabs：治理 / 審計 / 合併）
- 治理 tab：過期、不完整、可合併候選、待核對、override 中（**可指派給藥師**、saved filter）
- 審計 tab：可篩 actor / date / action / target；deep-link「此規則歷史」是 killer feature
- **工期估**：3 天

### 4e — 合規補強（合規 agent 強烈建議）
- 步進式 auth（severity / delete / override 動作要 re-enter password）
- WORM 保留：audit table revoke UPDATE/DELETE 給 app role
- 每日 digest email 給 藥劑部主任
- DPIA 更新、ISMS 資產登記變更
- **工期估**：2 天

**全 5 個 sub-phase 合計：~14-16 工作日**

---

## 5. Phase 4a (MVP-Lite) 詳細 Spec

### 5.1 DB Schema 變更

**Migration 1：加新欄位（NULLable，instant on Postgres 11+）**
```sql
ALTER TABLE drug_interactions
  ADD COLUMN pharmacist_note    TEXT NULL,
  ADD COLUMN last_verified_at   TIMESTAMPTZ NULL,
  ADD COLUMN verified_by        VARCHAR(50) NULL,
  ADD COLUMN is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN etag               INTEGER NOT NULL DEFAULT 1;
```

**Migration 2：audit log 表**
```sql
CREATE TABLE drug_library_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  action       VARCHAR(20) NOT NULL,       -- note / verify / deprecate / restore / edit_text
  entity_type  VARCHAR(20) NOT NULL,       -- 'rule' (future: 'iv_compat')
  entity_id    VARCHAR(50) NOT NULL,
  before_json  JSONB NULL,                 -- 變更前的 snapshot (only changed fields)
  after_json   JSONB NULL,                 -- 變更後
  actor_id     VARCHAR(50) NOT NULL,
  actor_name   VARCHAR(100) NOT NULL,
  reason       TEXT NULL,
  ip_address   VARCHAR(50) NULL,
  user_agent   TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_dlaa_entity ON drug_library_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX ix_dlaa_actor ON drug_library_audit_log(actor_id, created_at DESC);
```

**Migration 3：append-only 保護（Postgres trigger）**
```sql
CREATE OR REPLACE FUNCTION reject_audit_modify() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'drug_library_audit_log is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER tr_dlaa_no_update BEFORE UPDATE ON drug_library_audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modify();
CREATE TRIGGER tr_dlaa_no_delete BEFORE DELETE ON drug_library_audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modify();
```

### 5.2 後端 API（5 個新 endpoint）

```
PATCH  /pharmacy/drug-library/rules/{id}/note
       body: { note: str }
       returns: { id, note, etag, last_modified_at }

POST   /pharmacy/drug-library/rules/{id}/verify
       returns: { id, last_verified_at, verified_by }

POST   /pharmacy/drug-library/rules/{id}/deprecate
       body: { reason: str }  # ≥30 chars
       returns: { id, is_active: false, deprecated_at }

POST   /pharmacy/drug-library/rules/{id}/restore
       body: { reason: str }
       returns: { id, is_active: true }

GET    /pharmacy/drug-library/rules/{id}/history
       returns: [{ action, actor_name, reason, created_at, before, after }]
```

**所有 mutating endpoints**：
- 強制 `pharmacist` 或 `admin` role
- 自動寫 audit log（包 IP、UA）
- bump `etag`

**read-side cascade**（必修）：
- `_aggregate_per_drug`、`_drug_match`、`/drugs`、`/drugs/{name}`、`/stats` 全部加 `WHERE is_active = TRUE`
- `/drugs/{name}` 回傳每條 DDI 多帶 `pharmacist_note`、`last_verified_at`、`etag`

### 5.3 前端

**Sidebar header**（`AppSidebar.tsx`）：
```tsx
{isPharmacistOrAdmin && (
  <button onClick={() => toggleEditMode()} className="...">
    {editMode ? '編輯模式' : '檢視模式'}
  </button>
)}
```
存到 sessionStorage / Context。

**詳情頁 DDI 卡**：
- 編輯模式 OFF：跟現在一樣
- 編輯模式 ON：右側顯示 thin rail
  - `[備註]` 點開 inline editor，blur 自動存
  - `[已核對]` 按一下記時間戳
  - `[標 deprecated]` 開 modal 要 reason
  - `[歷史]` 開 modal 顯示 audit log

**清單頁**：
- 軟刪除的 row 自動消失（後端已 filter）
- 編輯模式 OFF 不變；編輯模式 ON 暫時無新功能（4a 不做清單頁批次操作）

### 5.4 Acceptance Criteria
- [ ] 藥師登入 → sidebar 看到「編輯模式」toggle（一般使用者看不到）
- [ ] 開編輯模式 → 詳情頁 DDI 卡出現 inline rail
- [ ] 加備註 → 存進 DB → 重 load 仍在 → audit log 有一筆 `note` 動作
- [ ] 標已核對 → `last_verified_at` 有值 → 顯示「2026-04-28 已核對 by 王藥師」
- [ ] 標 deprecated → 該 row 從清單頁/詳情頁消失（is_active=false）→ audit log 有一筆 `deprecate`
- [ ] audit log 試 UPDATE → 直接 raise SQL exception
- [ ] audit log 試 DELETE → 直接 raise SQL exception
- [ ] 一般使用者 PATCH → 403
- [ ] 兩個藥師同時編 → 後者收 409（4a 用 etag 預檢即可）
- [ ] 重新匯入 Lexicomp → 軟刪 row 不會被 ON CONFLICT 遺漏（dedup_key 仍 unique，但下版要改 partial index）

---

## 6. Phase 4a 不做的事

**明確 OUT OF SCOPE**（避免 scope creep）：
- ❌ 改 mechanism / management 文字 → 4b
- ❌ 任何 severity / risk_rating 變動 → 4b
- ❌ Override（hospital downgrade） → 4b
- ❌ Merge 兩 row → 4c
- ❌ 新增 rule from scratch → 4c
- ❌ Bitemporal valid_from/valid_to → 4b
- ❌ 4-eye 簽核 → 4b（4a 全部單人即可）
- ❌ 治理 worklist → 4d
- ❌ 步進式 auth → 4e

---

## 7. 風險與 mitigation

| 風險 | 機率 | 衝擊 | mitigation |
|---|---|---|---|
| 軟刪除後該 row 仍出現在 search → 病人安全風險 | 中 | 高 | 全 read endpoint 必 cascade `is_active = TRUE`，PR 加單元測試 caught |
| 同時編寫導致覆蓋 | 中 | 中 | etag 預檢 → 409；4a 簡單版即可（讀取時記 etag → write 時帶回） |
| audit log 表暴漲 | 低 | 中 | 評估 1 年後容量；之後加 partition by month |
| 藥師誤標 deprecate | 中 | 中 | reason ≥30 字 + 「復原」按鈕（restore endpoint）|
| 一般使用者繞過前端直接打 API | 低 | 高 | 後端強制 role 檢查；自動測試 |

---

## 8. 附錄：4-Agent 完整反饋

完整輸出見 PR description；以下節錄關鍵警句：

**架構 agent**：
> 「軟刪除污染是真的。dedup_key UNIQUE 仍占用 → 重匯 Lexicomp 2027 會 conflict。改 partial index 或 archive table。」

> 「Audit-log writer 不能信開發者記得手動寫，要 SQLAlchemy event listener 或 service-layer decorator 包起來。」

**臨床藥師 agent**：
> 「標已核對的 button 會沒人按，除非綁實際工作流。在「我打開規則因為病人有 alert」時 prompt 「還準確嗎？」 — 把 verification 變成工作的副產品。」

> 「Citation 不可省。沒附 PubMed/UpToDate/院內共識的編輯就是道聽塗說，下個藥師會 revert。」

**合規 agent**：
> 「`before/after jsonb` 不是合規可辯護的 audit trail。要 ip_address / user_agent / session_id / field_path / approval_id。」

> 「step-up auth：severity 變動 / soft-delete / override 都要 re-enter password。一般文字編輯不用。」

**UX agent**：
> 「最大的 IA 決策：編輯模式是 posture（用戶切到那個狀態）還是 feature（散落的 icon）。選 posture，然後 sidebar 切換。」

> 「治理面板是核心產品，不是 1 天能做完。讓它可指派、可存 filter，變成 worklist 不是 report。」

---

## 9. 決議

- ✅ **採 Option C override 模型**
- ✅ **採 4-eye 嚴重度簽核**（X→ 任何降級永禁）
- ✅ **採 posture toggle 編輯模式**
- ✅ **先做 Phase 4a（MVP-Lite，2-3 天）**，上線收集真實使用回饋後再決定 4b/4c 順序
- ✅ **audit log append-only via Postgres trigger** 從 4a 開始就要有
- ⏳ Phase 4b 之後再考慮 bitemporal、4-eye 簽核工作流

**下一步**：實作 Phase 4a。
