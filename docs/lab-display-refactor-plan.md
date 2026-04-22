# 檢驗數據顯示重構計畫（B 案：Data-driven Section Rendering）

> 2026-04-23 起草 · 對應前端檔案 `src/components/lab-data-display.tsx`

## 1. 背景 & 現況問題

### 症狀
截圖中「其他」區塊出現了本該歸屬其他 section 的項目：
- `Eos / MCH / MCV / Baso / MCHC / NRBC / Myelo / RDW_CV / RDW_SD` 應在「血液學檢查」
- `BEecf` 應在「動脈血氣體分析」或「靜脈血氣體分析」
- `ACTH` 應跟 `Cortisol` 同在「內分泌」
- `12191 Negative` 其實是 Legionella urine Ag，因後端未登錄 LAB_CODE 而裸露成 code

### 根因
- **後端分類正確**：`REP_TYPE_NAME`（原始 HIS 欄位）→ `_REP_TYPE_TO_CATEGORY`（`his_converter.py:310`）→ `LAB_CODE_MAPPING` 精修（`his_lab_mapping.py`）已把每個項目分到合理 category。
- **前端斷鏈**：每個 section 用手列的顯式白名單（`HEMATOLOGY_METRICS`、`ABG_METRICS`…）決定渲染什麼欄位。白名單外的 key 一律被 `HANDLED_KEYS` 排除，掉進 fallback「其他檢驗 → 其他」。
- 結果：每次後端補一個 LAB_CODE，前端沒跟上 → 項目漂流到「其他」。長期技術債。

### 目標
- **單一真相來源**：前端以「後端 category」為分類依據，不再手列項目白名單。
- **白名單降格**：只用來指定 (a) 優先 / 必顯項目 (b) 排序 (c) 顯示標籤覆寫。
- **零遺漏**：任何 `labData[category][key]` 有值且能歸類者，一定出現在某個 section（不會默默消失，也不會不該屬於「其他」卻掉進「其他」）。

---

## 2. 架構設計

### 2.1 概念

```
labData (backend)
  └─ { biochemistry: { Na, K, ... }, hematology: { MCH, MCV, ... }, ... }
         │
         ▼
    groupLabData()          ← 單純的 pure function
         │
         ▼
  Map<SectionId, RenderItem[]>
         │
         ▼
    <LabSection /> ×N       ← 統一渲染
```

### 2.2 Section 定義（UI 層）

```ts
type SectionId =
  | 'electrolytes'     // 電解質
  | 'hematology'       // 血液學檢查
  | 'inflammatory'     // 發炎指標
  | 'abg'              // 動脈血氣體分析
  | 'vbg'              // 靜脈血氣體分析
  | 'liverRenal'       // 肝腎功能
  | 'coagulation'      // 凝血功能
  | 'biochemExtra'     // 其他生化（Glucose/Uric/HbA1C…）
  | 'endocrine'        // 內分泌（TSH/freeT4/Cortisol/ACTH）
  | 'cardiac'          // 心臟
  | 'lipid'            // 脂質
  | 'other';           // 其他檢驗（含 U_ / ST_ / PF_ / misc 子分組）

const SECTION_ORDER: SectionId[] = [
  'electrolytes', 'hematology', 'inflammatory', 'abg', 'vbg',
  'liverRenal', 'coagulation', 'biochemExtra', 'endocrine',
  'cardiac', 'lipid', 'other',
];

const SECTION_TITLE: Record<SectionId, string> = {
  electrolytes: '電解質',
  hematology:   '血液學檢查',
  inflammatory: '發炎指標',
  abg:          '動脈血氣體分析',
  vbg:          '靜脈血氣體分析',
  liverRenal:   '肝腎功能',
  coagulation:  '凝血功能',
  biochemExtra: '其他生化',
  endocrine:    '內分泌',
  cardiac:      '心臟酵素',
  lipid:        '脂質',
  other:        '其他檢驗',
};
```

### 2.3 Category → Section 預設映射（粗分類預設）

```ts
const CATEGORY_DEFAULT_SECTION: Record<string, SectionId> = {
  hematology:       'hematology',
  bloodGas:         'abg',
  venousBloodGas:   'vbg',
  inflammatory:     'inflammatory',
  coagulation:      'coagulation',
  cardiac:          'cardiac',
  thyroid:          'endocrine',
  hormone:          'endocrine',
  lipid:            'lipid',
  biochemistry:     'biochemExtra',  // default; overridden per item
  other:            'other',         // 含 U_ / ST_ / PF_ / 折入的 serology/tdm
};
```

### 2.4 Item Override 表（第二層 — 只處理需要細分的 key）

只有 `biochemistry` 需要按項目拆到 3 個 section（電解質 / 肝腎 / 其他生化）；
其他 category 都靠預設映射。另外用來覆寫單位、標籤、排序。

```ts
interface ItemOverride {
  section?: SectionId;  // 覆寫 section
  order?: number;       // 同 section 內排序（小 → 大，未指定 = Infinity → 按字母序）
  label?: string;       // 顯示標籤（預設 = itemName）
  unit?: string;        // 預設單位（fallback 用）
  pinned?: boolean;     // 無值也要顯示卡片
}

const ITEM_OVERRIDE: Record<string, ItemOverride> = {
  // ── 電解質 ───────────────────────────────
  'biochemistry:Na':      { section: 'electrolytes', order: 1, unit: 'mmol/L', pinned: true },
  'biochemistry:K':       { section: 'electrolytes', order: 2, unit: 'mmol/L', pinned: true },
  'biochemistry:Ca':      { section: 'electrolytes', order: 3, unit: 'mg/dL' },
  'biochemistry:freeCa':  { section: 'electrolytes', order: 4, unit: 'mmol/L' },
  'biochemistry:Mg':      { section: 'electrolytes', order: 5, unit: 'mg/dL' },
  'biochemistry:Cl':      { section: 'electrolytes', order: 6, unit: 'mmol/L' },
  'biochemistry:Phos':    { section: 'electrolytes', order: 7, unit: 'mg/dL' },

  // ── 肝腎功能 ──────────────────────────────
  'biochemistry:AST':     { section: 'liverRenal', order: 1, unit: 'U/L' },
  'biochemistry:ALT':     { section: 'liverRenal', order: 2, unit: 'U/L' },
  'biochemistry:TBil':    { section: 'liverRenal', order: 3, unit: 'mg/dL' },
  'biochemistry:DBil':    { section: 'liverRenal', order: 4, unit: 'mg/dL' },
  'biochemistry:AlkP':    { section: 'liverRenal', order: 5, unit: 'U/L' },
  'biochemistry:rGT':     { section: 'liverRenal', order: 6, unit: 'U/L' },
  'biochemistry:BUN':     { section: 'liverRenal', order: 7, unit: 'mg/dL', pinned: true },
  'biochemistry:Scr':     { section: 'liverRenal', order: 8, unit: 'mg/dL', pinned: true },
  'biochemistry:eGFR':    { section: 'liverRenal', order: 9, unit: 'mL/min' },
  'biochemistry:Clcr':    { section: 'liverRenal', order: 10, unit: 'mL/min' },

  // ── 發炎 (biochemistry 入發炎) ────────────
  'biochemistry:Alb':     { section: 'inflammatory', order: 1, unit: 'g/dL' },
  'biochemistry:Ferritin':{ section: 'inflammatory', order: 10, unit: 'ng/mL' },
  'biochemistry:LDH':     { section: 'inflammatory', order: 11, unit: 'U/L' },
  'bloodGas:Lactate':     { section: 'inflammatory', order: 2, unit: 'mmol/L' },

  // ── 其他生化（Glucose/Uric/HbA1C）─────────
  'biochemistry:Glucose': { section: 'biochemExtra', order: 1, unit: 'mg/dL' },
  'biochemistry:Uric':    { section: 'biochemExtra', order: 2, unit: 'mg/dL' },
  'other:HbA1C':          { section: 'biochemExtra', order: 3, unit: '%' },
  'other:NH3':            { section: 'biochemExtra', order: 4, unit: 'μg/dL' },
  'other:Amylase':        { section: 'biochemExtra', order: 5, unit: 'U/L' },
  'other:Lipase':         { section: 'biochemExtra', order: 6, unit: 'U/L' },

  // ── 內分泌排序 ────────────────────────────
  'thyroid:TSH':          { section: 'endocrine', order: 1 },
  'thyroid:freeT4':       { section: 'endocrine', order: 2 },
  'hormone:Cortisol':     { section: 'endocrine', order: 3 },
  'hormone:ACTH':         { section: 'endocrine', order: 4 },

  // ── 血液學排序（常用 pinned 在前） ────────
  'hematology:WBC':       { section: 'hematology', order: 1, pinned: true },
  'hematology:Hb':        { section: 'hematology', order: 2, pinned: true },
  'hematology:Hct':       { section: 'hematology', order: 3 },
  'hematology:PLT':       { section: 'hematology', order: 4, pinned: true },
  'hematology:RBC':       { section: 'hematology', order: 5 },
  'hematology:MCV':       { section: 'hematology', order: 10 },
  'hematology:MCH':       { section: 'hematology', order: 11 },
  'hematology:MCHC':      { section: 'hematology', order: 12 },
  'hematology:RDW_CV':    { section: 'hematology', order: 13 },
  'hematology:RDW_SD':    { section: 'hematology', order: 14 },
  'hematology:Segment':   { section: 'hematology', order: 20 },
  'hematology:Lymph':     { section: 'hematology', order: 21 },
  'hematology:Mono':      { section: 'hematology', order: 22 },
  'hematology:Eos':       { section: 'hematology', order: 23 },
  'hematology:Baso':      { section: 'hematology', order: 24 },
  'hematology:Band':      { section: 'hematology', order: 25 },
  'hematology:Myelo':     { section: 'hematology', order: 26 },
  'hematology:NRBC':      { section: 'hematology', order: 27 },
};
```

**注意**：表中未列的 key **一樣會顯示**，只是用預設 section + 預設排序（按 itemName 字母序）。這是 data-driven 的核心保證。

### 2.5 分組函式

```ts
interface RenderItem {
  category: keyof LabData;    // 原始 category（給 handleLabClick / trend API 用）
  itemName: string;
  key: string;                // `${category}:${itemName}`
  order: number;
  label: string;
  unit: string;
  pinned: boolean;
  subGroup?: 'U' | 'ST' | 'PF' | 'misc';  // only for section='other'
}

function groupLabData(labData: LabData | null): Map<SectionId, RenderItem[]> {
  const result = new Map<SectionId, RenderItem[]>();
  if (!labData) return result;

  for (const category of Object.keys(labData) as (keyof LabData)[]) {
    const bucket = labData[category];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const itemName of Object.keys(bucket)) {
      if (itemName.startsWith('_')) continue;           // skip meta keys
      const key = `${String(category)}:${itemName}`;
      const override = ITEM_OVERRIDE[key];
      const defaultSection = CATEGORY_DEFAULT_SECTION[String(category)] ?? 'other';
      const section = override?.section ?? defaultSection;

      const render: RenderItem = {
        category,
        itemName,
        key,
        order: override?.order ?? Number.POSITIVE_INFINITY,
        label: override?.label ?? itemName,
        unit: override?.unit ?? '',
        pinned: override?.pinned ?? false,
        subGroup: section === 'other' ? detectSubGroup(itemName) : undefined,
      };

      if (!result.has(section)) result.set(section, []);
      result.get(section)!.push(render);
    }
  }

  // Sort within each section
  for (const [, items] of result) {
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.itemName.localeCompare(b.itemName);
    });
  }

  return result;
}

function detectSubGroup(name: string): 'U' | 'ST' | 'PF' | 'misc' {
  if (name.startsWith('U_')) return 'U';
  if (name.startsWith('ST_')) return 'ST';
  if (name.startsWith('PF_')) return 'PF';
  return 'misc';
}
```

### 2.6 渲染

```tsx
export function LabDataDisplay({ labData, patientId, ... }: Props) {
  const sections = useMemo(() => groupLabData(labData), [labData]);

  // pinned 補位：即使無值也要顯示（靠 ITEM_OVERRIDE 注入空 RenderItem）
  const pinnedItems = useMemo(() => computePinned(sections, ITEM_OVERRIDE), [sections]);

  const hasAnyVisible = SECTION_ORDER.some(sid => {
    const items = sections.get(sid) ?? [];
    return items.some(i => hasValue(labData, i));
  });

  return (
    <div className="space-y-4">
      {SECTION_ORDER.map(sid => {
        const items = [...(sections.get(sid) ?? []), ...(pinnedItems.get(sid) ?? [])];
        if (!items.length) return null;
        if (sid === 'other') return <OtherSection key={sid} items={items} ... />;
        return <LabSection key={sid} title={SECTION_TITLE[sid]} items={items} ... />;
      })}
      {hasAnyVisible && <Legend />}
    </div>
  );
}
```

`OtherSection` 保留現行 `U_/ST_/PF_/misc` 的子分組邏輯，只是改成讀 `item.subGroup` 而非字串 prefix 判斷。

---

## 3. 受影響檔案清單

| 檔案 | 變更性質 | 要點 |
|---|---|---|
| `src/components/lab-data-display.tsx` | **大改** | 移除 `HEMATOLOGY_METRICS` 等 8 個白名單、`HANDLED_KEYS`、所有手寫 `LabItem` JSX；新增 `SECTION_ORDER`、`CATEGORY_DEFAULT_SECTION`、`ITEM_OVERRIDE`、`groupLabData()`、抽出 `<LabSection>` / `<OtherSection>` 子元件 |
| `src/components/__tests__/lab-data-display.test.tsx`（新增） | **新增** | 用 fixture `labData` 驗證：(1) MCH/BEecf/ACTH 落對 section；(2) 未知 key 不會消失；(3) pinned 無值時仍顯示；(4) 排序符合 override |
| `src/lib/clinical/format-for-paste.ts` | **小改**（可選） | 目前已是 data-driven，只需確認 `CATEGORY_ORDER` 與新架構一致；或改讀同一個 `ITEM_OVERRIDE` 取 label |
| `backend/app/fhir/his_lab_mapping.py` | **小補** | 順手加 `"12191": ("serology", "Legionella_UAg", "Legionella urine Ag")`，讓裸 code 消失（和此次 refactor 正交，但同 PR 處理一次解決） |

**不動**：
- `backend/app/fhir/his_converter.py`（category 語意不變）
- `src/lib/api/lab-data.ts`（API 合約不變）
- DB schema / migration（完全不動）

---

## 4. 實作步驟（建議順序 & 獨立 commit）

> **進度狀態**（2026-04-23）：feature branch `refactor/labs-data-driven-display`
> - ✅ Step 1（commit `fa174a0`）
> - ✅ Step 4（commit `cf47752`）
> - ⏳ Step 2 — 進行中
> - ⏸ Step 3 — 依賴 Step 2
> - ⏸ Step 5 — 依賴 Step 3

### ✅ Step 1 — 抽取表格 & 函式（0 行為變化）
- 新增 `src/components/lab-data-display/sections.ts`：放 `SECTION_ORDER`、`SECTION_TITLE`、`CATEGORY_DEFAULT_SECTION`、`ITEM_OVERRIDE`、`groupLabData()`、`RenderItem` 型別。
- 暫不套用到主檔，只確保 build 過 + type 檢查過。
- **已完成**：commit `fa174a0`，220 行，`tsc --noEmit` 通過。`LabData` 從 `'../../lib/api'` 引入（barrel re-export）。

### ⏳ Step 2 — 新增 Section 元件
- 新增 `src/components/lab-data-display/LabSection.tsx`：吃 `{ title, items, labData, handleClick }` 輸出卡片網格。
- 新增 `OtherSection.tsx`：處理 `U_/ST_/PF_/misc` 子分組。
- 抽出 `LabItem.tsx`（現在寫在 `lab-data-display.tsx` 內部）供兩個新元件共用；主檔改用 re-export 保持相容直到 Step 3。
- 寫元件層 test（Storybook 或 RTL）。
- Commit: `refactor(labs): add LabSection/OtherSection components`

### ⏸ Step 3 — 切換主檔案（行為變化）
- 在 `lab-data-display.tsx` 以新元件取代 11 個手寫 section。
- 移除 `HEMATOLOGY_METRICS` 等白名單、`HANDLED_KEYS`、`otherLabItems`。
- 保留 `handleLabClick`、trend chart 開啟邏輯。
- Commit: `refactor(labs): switch to data-driven rendering`

### ✅ Step 4 — 後端補 LAB_CODE（並行）
- `his_lab_mapping.py` 加入 `12191`（Legionella UAg）。
- **已完成**：commit `cf47752`。**修正**：字典名稱是 `HIS_LAB_MAP`（原計畫誤寫為 `LAB_CODE_MAPPING`），後續 step 如需引用請用正確名稱。

### ⏸ Step 5 — 驗證 & 清理
- Playwright 對多位病人頁截圖比對：舊版截圖 → 新版應該 (1) 新增 BEecf/MCH/ACTH 等欄位 (2) 「其他」只剩真正的 other（IGRA/CryptoAg/ValproicAcid/糞便 OB）。
- 刪掉 dead code（舊 `OTHER_CATEGORY_ORDER` 等）。
- 更新 `docs/frontend-data-inventory.md`（若有提及 lab display 架構）。
- Commit: `refactor(labs): cleanup legacy whitelists`

---

## 5. 測試計畫

### 5.1 Fixture 層
建一個 `labData` mock（涵蓋所有 12 個截圖中看到的 category），驗證：

| 輸入 key | 期望 section |
|---|---|
| `hematology:MCH` | `hematology` |
| `hematology:RDW_SD` | `hematology` |
| `bloodGas:BEecf` | `abg` |
| `venousBloodGas:BEecf` | `vbg` |
| `hormone:ACTH` | `endocrine` |
| `hormone:Cortisol` | `endocrine` |
| `biochemistry:Na` | `electrolytes` |
| `biochemistry:AST` | `liverRenal` |
| `biochemistry:Glucose` | `biochemExtra` |
| `other:U_pH` | `other`, subGroup=U |
| `other:ST_OccultBlood` | `other`, subGroup=ST |
| `other:IGRA_Result` | `other`, subGroup=misc |
| `other:ValproicAcid` | `other`, subGroup=misc |
| `other:Unknown_Future_Test` | `other`, subGroup=misc（不遺失） |

### 5.2 UI 層（Playwright）
- 走訪 patient `50076763` / `50161769` / `50091953`（三人資料覆蓋不同 category）。
- 截圖比對 / 確認「其他」區塊只剩預期項目。
- 確認點擊卡片仍打開 trend chart 且呼叫 `/lab-trends?category=hormone&item=ACTH` 等正確 URL。

### 5.3 Regression 清單
- [ ] `formatLabsForPaste` 複製貼上內容與重構前相同（同一份 labData 輸入）
- [ ] 單位顯示未退化（`mg/dL` / `U/L` / `mmol/L` 等）
- [ ] 紅框/藍框（高/低）判定未變
- [ ] 空值時 pinned 卡片仍顯示「--」佔位

---

## 6. 風險與回退

| 風險 | 影響 | 緩解 |
|---|---|---|
| `ITEM_OVERRIDE` 漏填某個既有 key | 該 key 落到預設 section（可能錯位） | Step 1 加 unit test：把所有既有白名單項都 assert 回原 section |
| pinned item 無值時卡片樣式不對 | 空白卡片破版 | 保留原 `isOptional` 的 placeholder 行為 |
| 後端新增 category 前端沒預設 | 掉進 `other` | 可接受（符合「零遺漏」原則，頂多錯分組而非消失） |
| trend click 傳 category 與後端 API 不合 | 某幾項 trend 開不起來 | 傳 `item.category` 原值，不轉 section id |

**回退策略**：每個 Step 獨立 commit，必要時 `git revert` 對應 commit 即可。

---

## 7. Out of Scope（另外處理）

- 後端 `_REP_TYPE_TO_CATEGORY` 的新項目補齊（例：新增的「過敏檢驗」細類）— 交給後端 session。
- 讓「serology」「tdm」脫離 other 獨立成一個 section — 需求端未確認，等 UX 決定。
- `LAB_CODE_MAPPING` 全面體檢 — 另開 issue 跑一次覆蓋率腳本（已有 954 筆 100% 覆蓋紀錄，但未登錄碼如 12191 算漏網）。

---

## 8. 完成標準（DoD）

- [ ] 截圖中所有項目落在正確 section
- [ ] 新增任何 LAB_CODE（後端單一來源）不需改前端即可顯示
- [ ] `formatLabsForPaste` 輸出與重構前一致
- [ ] Vitest + Playwright 全綠
- [ ] Railway + Vercel 部署後，至少 3 位病人頁視覺驗證通過
- [ ] `docs/drug-data-pipeline-reference.md` 或本檔註記 12191 等新增 code
