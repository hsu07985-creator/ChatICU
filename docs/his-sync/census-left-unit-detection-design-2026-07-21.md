# 出院偵測 — 以 `patient/` 目錄為真相，自動下架

> 建立：2026-07-21（設計）｜改版：2026-07-22（改為 patient/ 目錄 + 自動 archive）｜域：his-sync
> 起因：病人板顯示已出院卻仍在的病人（鄭義輝 I-07、周麗華 I-12、舒以信 I-15、陳弘暉 I-17、黃桂華 I-20）。
> 決策（PM 2026-07-22）：**真相來源＝`patient/` 目錄**；不在目錄裡的 HIS 病人＝出院，**sync 時自動 archive（直接下架）**。

---

## 1. 真相來源：`patient/` 目錄

`/patient/{MRN}/` 每個子目錄 = HIS 目前**仍在匯出**的病人。HIS 停止匯出某人 → 目錄消失 → 該人已出院。
這比 getICUbed 名冊更權威，因為它是「HIS 還認不認這個病人」，而非「他在不在 ICU 床」。

**Join key 單一乾淨**：目錄名 = MRN = `patients.medical_record_number`。
**HIS 身分**：`patients.id == 'pat_' || md5(MRN)[:8]`（`_gen_id('pat', mrn)`）。手動 demo（`pat_001/003/004`，其 MRN 不會 md5 回自己的 id）**天生被排除**。

## 2. 為什麼放棄原本的 getICUbed 做法（重要教訓）

初版用 getICUbed 名冊算 `left_unit` 旗標（誰不在 ICU 床誰就標記）。實跑 prod × `patient/` 比對後發現**訊號會搞反**：

- **邱建陽（床 RCW29-1，MRN 50669055）在 `patient/` 裡** → 是現役病人（轉呼吸照護病房，HIS 仍匯出），**不該標記**。但 getICUbed 做法會把他標成離開（他不在 ICU 床）。
- **真正出院的 5 位**（鄭義輝等）**snapshot 已不再 sync** → getICUbed 逐病人邏輯根本跑不到他們 → 抓不到。

結論：「在不在 ICU 床」≠「是不是現役病人」。**目錄成員**才對。`left_unit` 欄/旗標/badge/確認按鈕整組移除（migration 082 drop 掉 081 加的欄）。

## 3. 動作：sync 時自動 archive

**位置**：`sync_his_snapshots_serial.py` main() 迴圈**之後**（API `/admin/his-sync` 也走這支腳本，兩路同時涵蓋）。
**只在全量 sync 跑**（`patient_filter is None`）——`-p 單一 MRN` 時**絕不** reconcile（否則會把其他人全下架）。

```
present = { 目錄名 for 目錄 in patient/ }          # discover_patient_roots
archive_absent_his_patients(session, present):
    if len(present) < CENSUS_MIN_PRESENT(=3): 跳過        # 空/殘目錄護欄
    取 archived=false 的 (id, mrn)
    要下架 = [ id | mrn 不在 present 且 id == pat_{md5(mrn)} ]   # 純函式，可測
    UPDATE ... SET archived=true, archived_at=now, updated_at=now,
                   discharge_reason=COALESCE(既有, 'HIS 匯出已無此病人，自動判定出院')
             WHERE id IN 要下架
```
- **冪等**：已 archived 的不動；重跑無副作用。
- **不跟 HIS_OWNED `archived` 打架**：被下架者不在 `patient/` → 無 snapshot → sync 根本不會 merge 到他們（`archived=bool(DEAD_DATE)` 那條碰不到），所以下架穩定不被還原。
- **不設 discharge_type/date**：我們不知道真實出院別/日期，只留 reason 說明是自動判定，誠實可審計。

## 4. 護欄（否則出事）

1. **只碰 HIS 身分**（`id == pat_{md5(mrn)}`）＋ **archived=false**：demo/手動病人天生排除。
2. **空/殘目錄護欄**（`CENSUS_MIN_PRESENT=3`）：`patient/` 目錄過少（跑 sync 的機器資料不全）→ 整個跳過，不會把全board 下架。
3. **僅全量 sync**：`-p` 單人 sync 不 reconcile。

## 5. Prod 實測（dry-run 已驗，2026-07-22）

`patient/` 有 10 目錄。DB 未 archived 15 位 → predicate 精準命中**這 5 位**（鄭義輝/周麗華/舒以信/陳弘暉/黃桂華），零誤傷（邱建陽在目錄 → 保留；seed 全部不符 md5 身分 → 保留）。

## 6. 實作任務

| 層 | 檔 | 動作 | 狀態 |
|---|---|---|---|
| Backend 邏輯 | `fhir/snapshot_sync.py` | `archive_absent_his_patients` + `select_absent_his_patient_ids`(純) + `_his_patient_id` + `CENSUS_MIN_PRESENT` | ✅ |
| Backend 接線 | `scripts/sync_his_snapshots_serial.py` | 迴圈後、全量 sync 才 reconcile | ✅ |
| Backend 移除 | converter/merge/model/api | 拔掉 `left_unit`（getICUbed 旗標） | ✅ |
| Migration | `082_drop_patient_left_unit.py` | drop 掉 081 加的欄（`DROP COLUMN IF EXISTS`） | ✅ |
| Frontend 移除 | `dashboard.tsx`、`patient-detail-header.tsx`、`patients.ts`、i18n | 拔掉 badge/確認按鈕/型別/字典 | ✅ tsc/build/orphan 綠 |
| Test | `tests/test_fhir/test_census_auto_archive.py` | 5 條（選中/保留/非HIS/None/護欄）；test_fhir 119 綠 | ✅ |
| 部署 | — | 後端 Railway（migration 082 已上，`left_unit` 欄已 drop）；前端 Vercel bundle `BsgigTzN` | ✅ 已驗（2026-07-22） |
| Prod 啟用 | — | **跑一次全量 sync** → 5 位自動 archive 離板 | ⬜ 待跑（prod-direct，使用者決策） |

> ⚠️ 部署後，5 位仍在板上直到**跑一次全量 sync**；sync 尾端才會 archive 他們。
