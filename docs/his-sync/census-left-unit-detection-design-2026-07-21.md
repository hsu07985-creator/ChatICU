# ICU 在院名冊偵測 — 「已離開 ICU」自動旗標設計

> 建立：2026-07-21 ｜ 域：his-sync ｜ 狀態：**後端已實作+測試綠（未部署），前端 badge 待做**
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

## 4. 資料模型（schema migration，一欄）— **已實作**

`patients` 加：

| 欄 | 型別 | 意義 |
|---|---|---|
| `left_unit` | `BOOLEAN NOT NULL DEFAULT FALSE` | 此病人 MRN 不在最新 getICUbed 名冊 = 已離開 ICU |

- **不碰 `archived`**（那是死亡，離開 ICU ≠ 死亡）。
- migration `081_patient_left_unit.py`：`ADD COLUMN IF NOT EXISTS`（冪等、fresh DB 可過）；**不是** data-seed migration（遵守 backend/CLAUDE.md C3）。
- 旗標直接落欄（不查詢時算）：sync 每輪由 converter 逐病人算出並寫入。

> **設計演進**：原稿用 `census_last_seen_at TIMESTAMPTZ` + 查詢時 `< MAX()` 推導。改成
> **逐病人 boolean** 因為 (a) 每位 snapshot 本就各帶完整名冊 → 不需全域參考時間；
> (b) 消掉冷啟動缺口（邱〇陽這種「上線前就離開」的人，時間戳法永遠拿不到 present 蓋章 →
> 永不旗標；boolean 法第一次 re-sync 就旗）；(c) 避開 `_is_meaningful` 把 `False` 當空、
> 導致旗標永遠清不掉。時間戳留給未來寬限期再加（§7）。

## 5. 偵測位置：converter 逐病人（`converter.py`）— **已實作**

床號本來就讀同一份名冊。加 `_left_icu_unit()`，tri-state：

```python
pat_nos = { PAT_NO in getICUbed.json }
if len(pat_nos) < _MIN_ICU_ROSTER:  return None   # 名冊不可信 → 見 §6
return str(self.pat_no) not in pat_nos            # True=離開 False=在院
```
`convert_patient()` 帶出 `left_unit: Optional[bool]`；`snapshot_sync.merge_patient_payload` 規則：
- `None`（名冊不可信）→ **保留既有旗標**（不覆蓋）。
- `True`/`False` → 覆蓋（設旗／清旗，**自癒**：重入名冊即清）。
- 新病人（existing=None）且 `None` → 落 `False`（NOT NULL 保護）。

**自癒**：真的還在 ICU 的人下次 sync 名冊仍含他 → `left_unit=False`。名冊是全單位的，任何人離開都會改動每位的 snapshot hash → 觸發 re-sync → 旗標即時更新。

## 6. 三個必守護欄（否則出事）— **已實作**

1. **只碰 HIS 病人**：**自動成立**——只有「從 snapshot 同步的病人」會被 converter 算旗標；demo/seed 病人沒 snapshot、根本不進這條路徑，永遠不被觸碰。（不需脆弱的 id-format predicate；seed 也用 `pat_{8hex}`，本來就分不出。）
2. **空/殘名冊護欄**：`_MIN_ICU_ROSTER = 3`（converter.py）。名冊 < 3（demographics-only 殘檔，參 memory「4–6KB」）→ `None` → 保留既有，**不會把全單位標成離開**。
3. **不跟 `archived=死亡` 打架**：獨立欄、獨立邏輯；死亡仍走 `archived`。

## 7. 未來（YAGNI，先不做）

- **寬限期自動下架**：連續缺席 ≥ N 次 sync / ≥ X 小時才自動 `/archive`。`census_last_seen_at` 已足以支撐，不用再加欄。
- **「仍在院」手動 pin**：目前 false positive 靠「下次 sync 自癒」即可，不需持久化覆蓋欄。真的踩到名冊 bug 再加。
- **床號前綴 → unit 推導**（`CW*` vs `*ICU*`）：可當第二訊號，但牽涉 `patients.unit` 存取控制（見 auto-import-progress §3 延後項），暫不併入。

## 8. 實作任務切分（跨 session）

| 層 | 檔 | 動作 | 狀態 |
|---|---|---|---|
| Backend schema | `alembic/versions/081_patient_left_unit.py` | 加 `left_unit` bool（`ADD COLUMN IF NOT EXISTS`） | ✅ |
| Backend model | `models/patient.py` | `left_unit` mapped column | ✅ |
| Backend 偵測 | `fhir/his/converter.py` | `_left_icu_unit()` tri-state + `_MIN_ICU_ROSTER=3` | ✅ |
| Backend merge | `fhir/snapshot_sync.py` | `left_unit` None→保留 / bool→覆蓋 / new→False | ✅ |
| Backend API | `routers/patients.py:patient_to_dict` | 加 `leftUnit` | ✅ |
| Test | `tests/test_fhir/test_left_unit_census.py` | 7 條（在院/離開/小名冊/merge×4）＋全 test_fhir 121 綠 | ✅ |
| Frontend badge | `dashboard.tsx`、`patient-detail-header.tsx` | `leftUnit` → 琥珀警示 badge（i18n 中/英） | ✅ |
| Frontend 確認出院 | `dashboard.tsx` | 板卡片「確認出院」按鈕 → 重用 `PatientArchiveDialog`（lockTarget）+ `archivePatient` | ✅ tsc/build/orphan 綠 |
| 部署 | — | 後端 push `personal`(Railway)（含 migration 081）；前端 push `railway`(Vercel) | ⬜ |
| Prod 驗證 | — | 跑一次 sync 後，DB 查 `SELECT id,name,bed_number,left_unit FROM patients WHERE left_unit` 應含邱〇陽 | ⬜ |

> ⚠️ 尚未部署、尚未在 prod 驗。前端 badge 是使用者可見的最後一哩，未接則後端旗標無 UI 出口。
