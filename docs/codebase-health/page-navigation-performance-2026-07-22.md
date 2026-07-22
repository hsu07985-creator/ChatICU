# 頁面切換效能修正（2026-07-22）

## 問題與量測基線

- Dashboard ↔ 住院病人已有 TanStack Query 共用快取，重複切換約 0.3 秒。
- 藥事工作站首次載入約 1.1 秒，不是主要瓶頸。
- 病人詳情首次載入約 7.9–8.9 秒，其中 `/patients/{id}/bootstrap` 佔 96% 以上。
- 高資料量病人的 bootstrap 約 8.03 秒、840,254 字元、289 筆藥物；即使只讀病人基本資料仍約 5.65 秒，顯示主要限制是 Railway 到 Supabase 的資料庫往返延遲，加上 bootstrap 串行組裝所有頁籤資料。

## 已實作

1. 病人詳情首屏只讀取病人資料，不再呼叫完整 bootstrap。
2. 從住院病人清單進入詳情時，先顯示 TanStack Query 內已有的病人資料，再背景更新單筆資料。
3. 檢驗、生命徵象、呼吸器、脫機評估、藥物與評分改為首次開啟相關頁籤才載入。
4. 藥物 API 新增向後相容的 `compact=true`：保留前端顯示與結構化分類所需欄位，省略 `sourceDetails`、伺服器端重複 grouping 及此頁不用的交互作用計算。
5. 病人 `intubation_date`、`tracheostomy_date` 改用既有 ORM 欄位，移除同一請求內額外 raw SQL 查詢／更新。
6. Dashboard 統計由多次串行查詢合併為病人、SAN 與訊息三組查詢；回傳契約不變。
7. 病人背景更新不再重複觸發 AI session 與 score 請求；正式站驗證兩者各只有一次。
8. Railway API 從 `us-west2` 搬到官方最接近台灣與 Sydney Supabase 的 Singapore `asia-southeast1-eqsg3a`。Redis 因掛載 volume、搬遷會停機，維持原區域。

## 資料正確性界線

- `compact` 預設為 `false`，其他藥物頁面與既有 API 使用者不受影響。
- compact 藥物分類仍只讀資料欄位（`sanCategory`／來源類型），沒有新增藥名關鍵字推論。
- `/patients/{id}/bootstrap` 暫時保留相容性，但病人詳情頁不再依賴它。
- 氣道日期欄位早已由 migration 056 建立，本次沒有 schema 變更或新 migration。

## 驗收紀錄

- Backend：927 passed、40 skipped。
- Frontend：typecheck、lint、production build 全部通過。
- compact medication API：新增契約測試，確認筆數與顯示欄位不變、`sourceDetails` 不回傳。
- Alembic：本機資料庫停在 revision 071，repo head 為 087；因此本機 `alembic check` 回報資料庫未升到 head，與本次（無 migration）修改無關。
- 正式站 Railway 與 Vercel deployment 均成功，production health 為 200。
- 住院名單 → 高資料量病人（289 筆藥物）：表頭 0.21–0.82 秒可見；背景單筆病人 API 約 2.6–3.0 秒；`/bootstrap` 請求 0 次。
- 藥物頁籤：首次點擊才送 `compact=true`，約 3.05 秒完成；289 筆、S/A/N 為 9/17/2，compact 與完整 API 逐筆比較 0 筆不一致。
- compact JSON 211,042 bytes，完整 JSON 754,217 bytes，縮小約 72%；不含 `sourceDetails`，完整端的 grouping／interaction 契約仍保留。
- 檢驗頁籤：四個 API 只在首次點擊後平行送出，最慢約 3.70 秒；頁面顯示正式 vital/lab 值，沒有 bootstrap。
- Dashboard stats 約 2.75 秒，較修正前約 5.7 秒減少約 52%，統計值與修正前一致。
- Singapore 切換後 Railway health 暖請求約 1.09 秒（切換前約 1.54–1.72 秒）；Vercel proxy health 約 1.38–1.83 秒。
- 正式站瀏覽器 console：0 error、0 warning；所有受測 API 均為 200。
