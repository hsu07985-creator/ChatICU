# HIS 自動匯入接線 — 進度總板（START HERE）

> 建立：2026-07-21 ｜ 域：his-sync ｜ **這是本主題的單一入口**：先讀這頁掌握現況，再依需要跳到細節文件。
> 主題：把原本「只能手動填」的病人欄位改成由 HIS 新數據批（SMARTBED / getICUbed / getTPR）自動匯入。

---

## 0. 一句話現況

**程式已寫完、已 commit、已 push 到兩個 remote；後端 Railway 已部署，前端 Vercel 也已上線（`66c6a48` = Production/Current，apex 實測 banner 字串已出現）；資料要真的進 prod DB 還需在 prod 觸發一次 HIS sync。** 另有 1 個待你拍板的行為決策（床號）。

> **2026-07-21 更正**：先前記「Vercel 未切版（bundle 仍 C1j_oTLU）」是**誤判**——`index-*.js` 是 entry chunk，Vite 依內容 hash，而 `patient-edit-dialog.tsx` + 所有 locale JSON 都 static-import 進 entry chunk，內容變了但**檔名 hash 恰好沒變**。實測 `curl chat-icu.vercel.app` 的 `index-C1j_oTLU.js` **已含 `hisSyncNote` ×3 + 中英 banner 全文**，且 Vercel deployment overview 顯示 `66c6a48` = Production·Current、`chat-icu.vercel.app` 已指向它。**前端已生效，無需再 Promote。** 教訓：驗證「切版沒」別只比 index hash，直接 grep 服務中 bundle 的新字串。

---

## 1. 已完成（程式 + commit）

| commit | 內容 | 檔案 |
|---|---|---|
| `e812aaa9d` | 後端：新格式 loader（ALL_MERGED fallback）+ converter 接 bed/身高體重/氣道/過敏 + `convert_vital_signs`(getTPR→vital_signs) | `backend/app/fhir/his/snapshot_io.py`、`converter.py`、`snapshot_sync.py` + 測試 |
| `66c6a4841` | 前端：編輯對話框加「HIS 每小時覆蓋」提示 banner + 修 `.gitignore` `/patient/` 錨定 | `src/components/patient/dialogs/patient-edit-dialog.tsx`、`src/i18n/locales/{zh-TW,en-US}/patients.json`、`.gitignore` |

兩個 commit 都在 `main`，已 `git push personal main`（Railway）+ `git push railway main`（Vercel）。

**接了哪些欄位**（來源見 [gap-closure §2](./manual-to-auto-gap-closure-2026-07-21.md)）：床號(getICUbed)、身高/體重/BMI(sbNutrition)、插管/氣切+日期(sbTube)、食物過敏(sbDisease)、生命徵象 HR/BP/RR/體溫(getTPR)。
**歸類**：patient 欄走 `PRESERVE_EXISTING`+`_is_meaningful`（HIS 有值就覆蓋、沒值保留手動，零資料遺失）；vital_signs 用 `upsert_records`（只 upsert HIS-id 列，手動列含 SpO2 永不被碰）。**沒動 frozenset**。

---

## 2. 部署狀態

| 元件 | 狀態 | 備註 |
|---|---|---|
| **Railway 後端** | ✅ 已部署（GitHub deploy status = success，`/health` healthy） | 本次無新 migration，`alembic upgrade head` 為 no-op |
| **Vercel 前端** | ✅ **已上線**（`66c6a48` = Production·Current，`chat-icu.vercel.app` 已指向它；apex bundle 實測含 banner 中英全文） | 先前「bundle 未變 = 未切版」是誤判，見 §0 更正。`C1j_oTLU` 就是新版。 |

---

## 3. 待辦 / 決策（下次進來優先看這段）

- [x] ~~**Vercel 前端 promote**~~：**已確認生效（2026-07-21）**。`66c6a48` = Production·Current，apex `index-C1j_oTLU.js` 已含 `hisSyncNote` 中英 banner。（驗證改用 `curl chat-icu.vercel.app/assets/index-*.js | grep hisSyncNote`，別比 index hash——見 §0。）
- [ ] **在 prod 觸發一次 HIS sync**：converter 程式部署了，但**資料不會自己流進 prod DB**，要跑一次 sync（`sync_his_snapshots_serial.py`，見根 CLAUDE.md「手動更新 HIS」）才會看到床號/身高/氣道/生命徵象自動帶入。⚠️ 本機的 HIS sync 按鈕直連 prod，勿在本機亂點。
- [ ] **部署 + 啟用「出院自動下架」**：程式已完成（後端+前端+測試綠、未部署），見 [`census-left-unit-detection-design-2026-07-21.md`](./census-left-unit-detection-design-2026-07-21.md)。**真相來源=`patient/` 目錄**（不在目錄的 HIS 病人=出院），sync 全量跑時自動 `archived=true`。待：後端 push `personal`(migration 082)、前端 push `railway`、**prod 跑一次全量 sync** 才會把 5 位（鄭義輝/周麗華/舒以信/陳弘暉/黃桂華）下架。**注意：邱建陽(RCW29-1) 在目錄裡=現役，不下架**；初版 getICUbed 旗標做法已廢除（會搞反）。
- [ ] **決策：床號覆蓋行為**（Playwright 已重現，見 §4）——維持「HIS 為準」（現狀，banner 已提醒）還是改「手動優先」（fill-if-empty，需改 code）。**未決前維持現狀。**
- [ ] **（延後）`patients.unit`**：仍硬編碼 `'ICU'`，未改讀 BED_CODE 前綴——因為改值會動**資料層存取控制**（unit-scoped 使用者可見範圍），需先評估。
- [ ] **（延後）過敏 parser bug**：`getSO` SOAP 的 `parse_allergy_texts` 把「denied」誤判成過敏物質（應為 NKA）。既有 bug，非本次引入；哪天碰 allergy 再修。

---

## 4. 驗收紀錄（都通過）

- 單元/整合測試：`tests/test_fhir/` **123 passed**（含新增 `test_converter_nested_snapshot.py` 9 條 + `test_upsert_records_preserves_manual_vital_rows`）。
- fresh-DB bootstrap：`scripts/ops/verify_fresh_db_bootstrap.sh` **PASS**（80 migrations + seeds + API smoke）。
- 真 PG sync：拋棄式容器實跑 `sync_snapshot_into_session`，`tracheostomy_date`（raw-SQL 欄）與 `vital_signs`（50669055=1401 列）寫入正確、`spo2` 保持 NULL。
- **Playwright 本機 UI 走測**：登入 → 病人列表顯示 MICU11/MICU17、氣切/插管；編輯對話框 banner 有出現、床號/身高/氣切日期自動帶入。**床號更新測試**：手動改 `A-99-TEST` 存得進 DB（更新功能正常）→ 重跑 sync → 變回 `MICU17`（**確認「手動床號撐不過下次同步」= 預期行為**）。

---

## 5. 文件地圖（要細節看這些）

| 想知道 | 看 |
|---|---|
| **本主題現況/待辦**（就是這頁） | `docs/his-sync/his-auto-import-progress.md` |
| **「已離開 ICU」自動旗標設計**（getICUbed 名冊偵測，已定案未實作） | [`census-left-unit-detection-design-2026-07-21.md`](./census-left-unit-detection-design-2026-07-21.md) |
| 哪些手動欄位變自動 / 仍缺 / pipeline 接線細節 | [`manual-to-auto-gap-closure-2026-07-21.md`](./manual-to-auto-gap-closure-2026-07-21.md) |
| DB 欄位「HIS 覆蓋 vs 手動保留」邊界（三 frozenset） | [`his-field-source-inventory-2026-07-21.md`](./his-field-source-inventory-2026-07-21.md) |
| 原始 snapshot 全欄位 + 坑（LAB_CODE、DC_FLAG、跨院區…） | [`patient-snapshot-field-inventory-2026-07-21.md`](./patient-snapshot-field-inventory-2026-07-21.md) |
| HIS sync 操作（serial 版、latest.txt、DB 端驗證） | 根 `CLAUDE.md`「手動更新 HIS 患者資料」 |

**關鍵程式**：`backend/app/fhir/his/snapshot_io.py`（loader，ALL_MERGED fallback）、`backend/app/fhir/his/converter.py`（`convert_patient`/`convert_vital_signs`）、`backend/app/fhir/snapshot_sync.py`（三 frozenset merge + vital upsert）。
