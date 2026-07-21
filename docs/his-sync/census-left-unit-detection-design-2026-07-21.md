# ICU 在院名冊偵測 — 「已離開 ICU」自動旗標設計

> 建立：2026-07-21 ｜ 域：his-sync ｜ 狀態：**設計已定案、尚未實作**
> 觸發：病人板顯示 `邱〇陽`（床 `CW29`、住院 300 天）等**已轉出 ICU 卻仍賴在板上**的人。
> 決策：**旗標 + 人工確認**（PM 2026-07-21 拍板），不自動隱藏。

---

## 1. 問題

病人板（`src/pages/dashboard.tsx`）與列表只濾 `Patient.archived == False`
（`backend/app/routers/patients.py:231`）。而 `archived` 的唯一 HIS 來源是
`DEAD_DATE`（`archived = bool(DEAD_DATE)`，見
[`his-field-source-inventory-2026-07-21.md`](./his-field-source-inventory-2026-07-21.md) §3.1）——
**只反映死亡，不反映出院/轉出**。因此轉出 ICU 的活人永遠留在板上，且舊床號
（如 `CW29`）因 `_extract_bed_number` 找不到名冊列而回 `None`、被 PRESERVE 保留不覆蓋。

## 2. 訊號：getICUbed 就是權威在院名冊（免費）

- `getICUbed.json` 是**全單位 ICU 在院名冊**，非單一病人資料：`[{BED_CODE, PAT_NO, PAT_SEQ}, …]`，
  實測 16 筆（如 `{'BED_CODE':'GICU01','PAT_NO':'61288774','PAT_SEQ':'G01003'}`）。
- **每位病人的 snapshot 都各複製一份**（`patient/{MRN}/{latest}/Factories/G/getICUbed.json`）→
  只要 sync 到任一位，就拿得到完整當前名冊。
- `converter.py:321 _extract_bed_number` **現在就在讀它**（`PAT_NO == self.pat_no` 撈本人床號）。偵測訊號零額外抓取成本。
- **Join key 單一乾淨**：`pat_no = os.path.basename(patient_dir) = MRN = 名冊 PAT_NO = patients.medical_record_number`
  （`converter.py:65,153`）。名冊 PAT_NO 直接對得上 DB 病人的 `medical_record_number`。

> **定義**：「這一批在院病人」= 最新 `getICUbed` 名冊裡的 PAT_NO 集合。
> 板上（HIS 來源、未 archived）任何 MRN 不在名冊裡的人 = **已離開 ICU**。

## 3. 定案動作：旗標 + 人工確認（不自動隱藏）

板上仍顯示，但打旗標；醫護點「確認出院」→ 走**現成的** `/archive` 出院流程
（`patient-archive-dialog.tsx` + `discharged-patients.tsx` 都已存在，不重造）。

```
┌──────────────┐
│ 邱〇陽  ⚠ 已離開 ICU？ │
│ CW29 · 住院 300 天     │
│ [確認出院]             │
└──────────────┘
```

**為何不自動隱藏**：名冊單次抖動/殘缺就把還在的病人弄不見 = 病安「漏掉病人」風險。
自動隱藏（含寬限期版）留作未來選項，`census_last_seen_at` 欄已為它預留（見 §7）。

## 4. 資料模型（schema migration，一欄）

`patients` 加：

| 欄 | 型別 | 意義 |
|---|---|---|
| `census_last_seen_at` | `TIMESTAMPTZ NULL` | 此 MRN 最後一次出現在 getICUbed 名冊的時間 |

- **不碰 `archived`**（那是死亡，離開 ICU ≠ 死亡）。
- schema 變更走 alembic；**不是** data-seed migration（遵守 backend/CLAUDE.md C3）。
- 衍生旗標**不落欄、查詢時算**：
  `leftUnit = (census_last_seen_at IS NOT NULL AND census_last_seen_at < MAX(census_last_seen_at))`
  —— `MAX()` 即「最近一次名冊蓋章時間」，不需另建 settings 表。
- **NULL = 不旗標**（安全預設：資料缺就別動）。剛加入、還沒被任何名冊蓋過的 HIS 病人不誤旗。

## 5. Sync reconcile pass（`snapshot_sync.py` 或 serial script 尾端）

```
roster = { PAT_NO for row in getICUbed.json }          # 已在讀
if len(roster) < MIN_ROSTER:      # 空名冊護欄，見 §6
    skip census reconcile this run
else:
    UPDATE patients SET census_last_seen_at = :now
      WHERE medical_record_number = ANY(:roster)
        AND <is HIS-sourced>                            # 見 §6
```
在院者蓋成 `now()`；缺席的 HIS 病人保留舊（較早）時間 → 自然 `< MAX` → 被旗標。
**真的還在 ICU 的人下次 sync 會重新入名冊 → census_last_seen_at 回到 MAX → 自動取消旗標**（false positive 自癒）。

## 6. 三個必守護欄（否則出事）

1. **只掃 HIS 病人**：demo/seed 病人不在 ICU 名冊，否則全被誤旗。scope 條件：
   `id LIKE 'pat_%'` 且為 HIS 指紋（`pat_{md5(MRN)[:8]}`）／或 `medical_record_number` 是數字 MRN 且曾出現在 snapshot。**實作時先確認 seed 病人的 id 形態再定 predicate**。
2. **空名冊護欄**：名冊空/殘缺時（參 memory「4–6KB 來源只剩 demographics」）**絕不 reconcile**，否則全board 被旗。`MIN_ROSTER` 設個合理下限（如 ≥ 3 或 ≥ 上輪名冊數的一半）。
3. **不跟 `archived=死亡` 打架**：獨立欄、獨立邏輯；死亡仍走 `archived`。

## 7. 未來（YAGNI，先不做）

- **寬限期自動下架**：連續缺席 ≥ N 次 sync / ≥ X 小時才自動 `/archive`。`census_last_seen_at` 已足以支撐，不用再加欄。
- **「仍在院」手動 pin**：目前 false positive 靠「下次 sync 自癒」即可，不需持久化覆蓋欄。真的踩到名冊 bug 再加。
- **床號前綴 → unit 推導**（`CW*` vs `*ICU*`）：可當第二訊號，但牽涉 `patients.unit` 存取控制（見 auto-import-progress §3 延後項），暫不併入。

## 8. 實作任務切分（跨 session）

| 層 | 檔 | 動作 |
|---|---|---|
| Backend schema | alembic migration | 加 `census_last_seen_at` |
| Backend sync | `snapshot_sync.py` / `sync_his_snapshots_serial.py` | roster reconcile + 護欄 |
| Backend API | `routers/patients.py` (`_patient_to_dict` ~L144、list 序列化) | 加 `censusLastSeenAt` + 衍生 `leftUnit`（CamelModel） |
| Frontend | `dashboard.tsx`、`patient-detail-header.tsx` | `leftUnit` → 警示 badge +「確認出院」按鈕接既有 archive dialog |
| Test | `tests/test_fhir/` | 名冊缺席 → 旗標；空名冊 → 不動；seed 病人不被旗；重入名冊 → 自癒 |

> Backend 改動 push `personal`(Railway)、Frontend push `railway`(Vercel)。跨 session 依 backend/CLAUDE.md 用 `docs/coordination/*-tasks.md` 交接。
