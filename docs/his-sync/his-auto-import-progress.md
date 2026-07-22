# HIS 自動匯入接線 — 進度總板（START HERE）

> 建立：2026-07-21 ｜ 域：his-sync ｜ **這是本主題的單一入口**：先讀這頁掌握現況，再依需要跳到細節文件。
> 主題：把原本「只能手動填」的病人欄位改成由 HIS 新數據批（SMARTBED / getICUbed / getTPR）自動匯入。

---

## 0. 一句話現況

**2026-07-22 欄位串接已完成：HIS 病人的自動欄位由 API 邊界禁止人工覆寫；生命徵象以逐欄最新值合併 HIS TPR 與五個人工指標；藥物、檢驗、培養與真正的 AI／手術報告均已直接連到目前 `patient/` 快照。同步 state 加入 mapping schema version，converter 改版時即使快照 hash 不變也會重跑。**

> **2026-07-21 更正**：先前記「Vercel 未切版（bundle 仍 C1j_oTLU）」是**誤判**——`index-*.js` 是 entry chunk，Vite 依內容 hash，而 `patient-edit-dialog.tsx` + 所有 locale JSON 都 static-import 進 entry chunk，內容變了但**檔名 hash 恰好沒變**。實測 `curl chat-icu.vercel.app` 的 `index-C1j_oTLU.js` **已含 `hisSyncNote` ×3 + 中英 banner 全文**，且 Vercel deployment overview 顯示 `66c6a48` = Production·Current、`chat-icu.vercel.app` 已指向它。**前端已生效，無需再 Promote。** 教訓：驗證「切版沒」別只比 index hash，直接 grep 服務中 bundle 的新字串。

---

## 1. 已完成（程式 + commit）

| commit | 內容 | 檔案 |
|---|---|---|
| `e812aaa9d` | 後端：新格式 loader（ALL_MERGED fallback）+ converter 接 bed/身高體重/氣道/過敏 + `convert_vital_signs`(getTPR→vital_signs) | `backend/app/fhir/his/snapshot_io.py`、`converter.py`、`snapshot_sync.py` + 測試 |
| `66c6a4841` | 前端：編輯對話框加「HIS 每小時覆蓋」提示 banner + 修 `.gitignore` `/patient/` 錨定 | `src/components/patient/dialogs/patient-edit-dialog.tsx`、`src/i18n/locales/{zh-TW,en-US}/patients.json`、`.gitignore` |
| `1574779b1` | 後端：藥物/檢驗/培養完整來源保留、部分來源防誤刪、人工補充保留、HIS 自動欄位禁止手動改、migration 085 | `converter.py`、`snapshot_sync.py`、models/routers/schemas + 測試 |
| 2026-07-22 欄位封口 | patient PATCH ownership、sparse vital merge + per-field timestamp、手動 vital 欄位限制、sync schema version、排除把影像醫囑誤當 final report | patients/vital routers、vital schema、converter、serial sync + API/FHIR 測試 |

兩個 commit 都在 `main`，已 `git push personal main`（Railway）+ `git push railway main`（Vercel）。

**接了哪些欄位**（來源見 [gap-closure §2](./manual-to-auto-gap-closure-2026-07-21.md)）：床號(getICUbed)、身高/體重/BMI(sbNutrition)、插管/氣切+日期(sbTube)、食物過敏(sbDisease)、生命徵象 HR/BP/RR/體溫(getTPR)。
**歸類**：patient 欄走 `PRESERVE_EXISTING`+`_is_meaningful`（HIS 有值就覆蓋、沒值保留手動，零資料遺失）；vital_signs 用 `upsert_records`（只 upsert HIS-id 列，手動列含 SpO2 永不被碰）。**沒動 frozenset**。

---

## 2. 部署狀態

| 元件 | 狀態 | 備註 |
|---|---|---|
| **Railway 後端** | ✅ 已部署（commit `1574779b1`，GitHub deploy status = success） | 啟動命令已執行 `alembic upgrade head`；schema head = 085 |
| **Vercel 前端** | ✅ **已上線**（deployment `dpl_Hc5J1ephB3JZ9G5u2VCd5YFL36yF` = Production Ready） | `chat-icu.vercel.app` 已指向本次 main 部署；本次沒有改 UI。 |

---

## 3. 待辦 / 決策（下次進來優先看這段）

- [x] ~~**Vercel 前端 promote**~~：**已確認生效（2026-07-21）**。`66c6a48` = Production·Current，apex `index-C1j_oTLU.js` 已含 `hisSyncNote` 中英 banner。（驗證改用 `curl chat-icu.vercel.app/assets/index-*.js | grep hisSyncNote`，別比 index hash——見 §0。）
- [x] **正式庫強制熱匯目前快照**：本次部署後使用 serial `--force` 在線逐病人 transaction 匯入；不用 migration/backfill、不停機。同步 state 現在保存 `schema_version`，以後 mapping 更新不會再被相同 snapshot hash 跳過。
- [x] ~~**部署 + 啟用「出院自動下架」**~~ ✅ **完成（2026-07-22）**，見 [`census-left-unit-detection-design-2026-07-21.md`](./census-left-unit-detection-design-2026-07-21.md)。**真相來源=`patient/` 目錄**（不在目錄的 HIS 病人=出院），全量 sync 尾端自動 `archived=true`。後端(migration 082)+前端已部署驗證；prod 全量 sync 已跑（台北 00:16），5 位（鄭義輝/周麗華/舒以信/陳弘暉/黃桂華）已 archive 離板、邱建陽保留(→MICU17)、board active=10。初版 getICUbed 旗標做法已廢除（會搞反）。
- [x] **床號與其他快照自動欄位 ownership**：HIS 決定性病人禁止透過 patient PATCH 修改；只有 `critical_status`、`campus`、`is_isolated`、`symptoms` 保持人工入口。非 HIS 建立的病人仍可完整編輯。
- [ ] **（延後）`patients.unit`**：仍硬編碼 `'ICU'`，未改讀 BED_CODE 前綴——因為改值會動**資料層存取控制**（unit-scoped 使用者可見範圍），需先評估。
- [ ] **（延後）過敏 parser bug**：`getSO` SOAP 的 `parse_allergy_texts` 把「denied」誤判成過敏物質（應為 NKA）。既有 bug，非本次引入；哪天碰 allergy 再修。

---

## 4. 驗收紀錄（都通過）

- 單元/整合測試：`tests/test_fhir/` **143 passed / 15 skipped**；API ownership、sparse vital、bootstrap、手動 POST 與 sync schema version 另有回歸測試。
- fresh-DB bootstrap：`scripts/ops/verify_fresh_db_bootstrap.sh` **PASS**（80 migrations + seeds + API smoke）。
- 真 PG sync：拋棄式容器實跑 `sync_snapshot_into_session`，`tracheostomy_date`（raw-SQL 欄）與 `vital_signs`（50669055=1401 列）寫入正確、`spo2` 保持 NULL。
- **Playwright 本機 UI 走測**：登入 → 病人列表顯示 MICU11/MICU17、氣切/插管；編輯對話框 banner 有出現、床號/身高/氣切日期自動帶入。**床號更新測試**：手動改 `A-99-TEST` 存得進 DB（更新功能正常）→ 重跑 sync → 變回 `MICU17`（**確認「手動床號撐不過下次同步」= 預期行為**）。
- **2026-07-22 真實快照逐筆驗收**：10 位病患；藥物 **2,120/2,120**、檢驗 **6,224/6,224**、培養/藥敏 **1,812/1,812** 全數對上原始 `patient/` 欄位，數值差異 0；MIC **98/98**；空白 lab orphan 0。
- **報告語意修正**：`getAllOrder` 是醫囑，不再轉成 final diagnostic report；目前快照只匯入真正的 ECG AI **40** 筆與手術報告 **3** 筆。ID 改由來源 sheet／手術代碼與日期決定，不再依陣列順序。
- **生命徵象**：HIS `vit_*` 只供 HR/BP/MAP/RR/體溫，人工 `vs_*` 只供 SpO₂/EtCO₂/CVP/ICP/CPP；latest、bootstrap 與人工 POST 回應均逐欄合併，趨勢/歷史維持原始列。
- **2026-07-22 回歸/部署驗收**：本機 backend **909 passed / 40 skipped**；GitHub CI 的 backend-test、lint、migration-check、security、frontend build、critical E2E、DAST、Docker build 全數 success；Railway + Vercel production success。

---

## 5. 文件地圖（要細節看這些）

| 想知道 | 看 |
|---|---|
| **本主題現況/待辦**（就是這頁） | `docs/his-sync/his-auto-import-progress.md` |
| **「已離開 ICU」自動旗標設計**（getICUbed 名冊偵測，已定案未實作） | [`census-left-unit-detection-design-2026-07-21.md`](./census-left-unit-detection-design-2026-07-21.md) |
| 哪些手動欄位變自動 / 仍缺 / pipeline 接線細節 | [`manual-to-auto-gap-closure-2026-07-21.md`](./manual-to-auto-gap-closure-2026-07-21.md) |
| DB 欄位「HIS 覆蓋 vs 手動保留」邊界（三 frozenset） | [`his-field-source-inventory-2026-07-21.md`](./his-field-source-inventory-2026-07-21.md) |
| 原始 snapshot 全欄位 + 坑（LAB_CODE、DC_FLAG、跨院區…） | [`patient-snapshot-field-inventory-2026-07-21.md`](./patient-snapshot-field-inventory-2026-07-21.md) |
| 藥物直連決策、實作與 2,120 筆驗收 | [`med-field-direct-connect-audit-2026-07-22.md`](./med-field-direct-connect-audit-2026-07-22.md) |
| HIS sync 操作（serial 版、latest.txt、DB 端驗證） | 根 `CLAUDE.md`「手動更新 HIS 患者資料」 |

**關鍵程式**：`backend/app/fhir/his/snapshot_io.py`（loader，ALL_MERGED fallback）、`backend/app/fhir/his/converter.py`（`convert_patient`/`convert_vital_signs`）、`backend/app/fhir/snapshot_sync.py`（三 frozenset merge + vital upsert）。
