# 用藥交互摘要 — Class Rule 配對歸屬 Bug 與修正方案

> 撰寫日期：2026-05-08
> 觸發案例：使用者輸入 5 個藥（Mosapride / Candesartan / Linagliptin / Metformin / Carvedilol），UpToDate 顯示 4 筆交互作用，ChatICU「用藥交互」detail 列出 3 筆，「配對速查」只列 2 對，且其中一對的 count=2 把不屬於它的 Risk B 規則計了進去；Carvedilol↔Metformin 與 Candesartan↔Metformin 完全消失。
> 結論：**結構性 bug**，並非個案。前端摘要 (`interactions.tsx`) 對每一條 class-level rule 只挑「`validDrugs` 順序中第一個命中的藥」當 matchA / matchB，當一條規則的某一側同時涵蓋輸入清單裡兩個以上的藥（例如 Antidiabetic group 同時包含 Linagliptin 跟 Metformin）時，剩下的對就被吞掉，並被錯誤聚合到第一個命中對。同類問題會在「Anticoagulants 群、CYP3A4 群、ARB 群、CNS Depressants 群」這類常見 class rule 反覆出現。

---

## 0. 進度追蹤

> 每完成一項實作就回來打勾。最後驗收回填觀察結果。

| # | 項目 | 狀態 |
|---|---|---|
| P1 | §5.1 主修：cartesian product + by-rule_id dedup + wordPattern memoize | ✅ 已完成 (`tsc --noEmit` pass) |
| P2 | §5.2 detail card 標題顯示「適用輸入藥對 (class group)」 | ✅ 已完成 (`tsc --noEmit` pass) |
| P3 | §6.4 i18n 文案（規則數 vs 配對-規則數）— zh-TW + en-US | ✅ 已完成 (`tsc --noEmit` pass) |
| P4 | §7.1 單元測試新增 | ✅ 改以 standalone Node 腳本驗證（`/tmp/test-summary-fix.mjs` + `/tmp/test-edge-cases.mjs`），共 **9/9 assertions 通過** |
| P5 | §7.2 手動驗證（程式碼 trace + standalone Node 跑觸發案例） | ✅ 已完成（trace + 5 邊界案例皆 pass，見 §0.3 / §0.4） |
| P6 | §7.3 部署驗證（Vercel bundle hash + curl 驗證） | ⏸️ 待使用者授權 push（合併到 main → `git push railway main`）後再做 |

> **0.2 P4 範圍調整（2026-05-08）**：`package.json` 確認專案前端**沒有單元測試框架**（只有 `@playwright/test`），加 Vitest 屬於基建變更，超出本次 fix 範圍。改以下列方式取代：
> - **程式碼推演**：手動 trace 觸發案例 5 藥的完整路徑（見 §0.3）
> - **TypeScript + ESLint 驗證**：`npm run typecheck` + `npm run lint` 全部 pass
> - **deploy 後 prod 驗證**：上線後再用使用者原本截圖的同一個 5 藥輸入做端對端比對

### 0.3 觸發案例 trace 結果（2026-05-08）

**Input**：`validDrugs = [Mosapride, Candesartan, Linagliptin, Metformin, Carvedilol]`

3 條 distinct rules（dedup 後）：

| Rule | sideAHits | sideBHits | 產生 pairs |
|---|---|---|---|
| `ddi_0140a2e928d6` BB(Nonsel) ↔ Antidiabetic (C) | [Carvedilol] | [Linagliptin, Metformin] | (Carv, Lina) C, (Carv, Met) C |
| `ddi_169e2e66fe1e` DPP-IV ↔ ARB (C) | [Linagliptin] | [Candesartan] | (Cand, Lina) C |
| `ddi_085545ef250d` ARB ↔ BloodGlucose (B) | [Candesartan] | [Linagliptin, Metformin] | (Cand, Lina) B → 既存 C 不變 count→2；(Cand, Met) B |

**最終 pairMap**：

| 配對 | count | risk |
|---|---|---|
| Candesartan ↔ Linagliptin | **2** | C（rule#2 C + rule#4 B，max-severity 留 C）|
| Carvedilol ↔ Linagliptin | 1 | C |
| Carvedilol ↔ Metformin | **1** | C ← **修前消失，修後出現** |
| Candesartan ↔ Metformin | **1** | B ← **修前消失，修後出現** |

**riskCounts**（由 dedupedResults 算）：Risk C: 2 規則, Risk B: 1 規則
**queryStats**：「查詢 5 種藥品，找到 3 條規則」

**Detail cards**：

| Rule | CardTitle | 副標 |
|---|---|---|
| #1 | Carvedilol ↔ Linagliptin、Carvedilol ↔ Metformin | Beta-Blockers (Nonselective) ↔ Antidiabetic Agents（class rule） |
| #2 | Candesartan ↔ Linagliptin | Dipeptidyl Peptidase-IV Inhibitors ↔ Angiotensin II Receptor Blockers（class rule） |
| #4 | Candesartan ↔ Linagliptin、Candesartan ↔ Metformin | ARB ↔ Agents with Blood Glucose Lowering Effects（class rule） |

→ 全部符合 §6.1 修後預期 ✓

`tsc --noEmit` + `eslint .` 兩者皆 pass。

### 0.4 Standalone Node 腳本驗證結果（2026-05-08）

把 useMemo 內的核心邏輯複製到 `/tmp/test-summary-fix.mjs` 與 `/tmp/test-edge-cases.mjs`，用真實 mock data 跑一次。

**觸發案例腳本** (`test-summary-fix.mjs`)：故意把 rule#1 在 `searchResults` 裡放兩次（模擬 backend 從 Carv+Lina query 與 Carv+Met query 各回一次），確認 by-id dedup 把它折成一條。

```
searchResults.length = 4         （含 dup）
dedupedResults.length = 3        ← by-id dedup ✓
Risk C: 2、Risk B: 1
配對速查（4 列，依 risk 排序）：
  Carvedilol  ↔ Linagliptin   Risk C  count=1
  Carvedilol  ↔ Metformin     Risk C  count=1   ← 修前消失，修後出現
  Candesartan ↔ Linagliptin   Risk C  count=2   ← rule#2 C + rule#4 B max 取 C
  Candesartan ↔ Metformin     Risk B  count=1   ← 修前消失，修後出現
Σcount = 5
✅ 4/4 §6.1 acceptance assertions PASS
```

**邊界案例腳本** (`test-edge-cases.mjs`)：

| # | 案例 | 期望 | 結果 |
|---|---|---|---|
| 1 | 非 class rule（`interactingMembers=[]`） | 1 pair | ✅ |
| 2 | 同 class rule（`group_name` 兩側相同）| 0 pair（已知限制 — DB 該類規則在實務上會用不同 group_name 的兩個 entries） | ✅ |
| 3 | substring 邊界（Methylprednisolone vs Prednisolone）| 不誤撈 | ✅（與 2026-05-06 substring fix 一致）|
| 4 | 空 `searchResults` | 0 pair（不 crash） | ✅ |
| 5 | AI flat finding（drugA/drugB 是真實藥名，無 class group） | 1 pair（與既有行為一致）| ✅ |

**合計 9/9 assertions PASS**。腳本檔保存在 `/tmp/`，後續加 Vitest 時可直接搬進 `src/pages/pharmacy/__tests__/`。

> **Edge case 2 觀察（不是 bug，但記錄一下）**：當一條 rule 的 `drug1 === drug2`（罕見，只有「同 class 內互斥」會出現），現行邏輯只把成員加到 side1，side2 會空，pair 產生不出來。實際 DB 該類 rule 通常用兩個獨立 group entries 表達（像 `ddi_ab869654bc38 Bradycardia-Causing Agents ↔ Bradycardia-Causing Agents`，會有兩個成員列表）。若日後遇到該情境，再針對性處理。

> **0.1 文件 review 後修訂紀錄（2026-05-08）**：經 3 個 Opus 4.7 agent 並行審查，修訂以下 4 處：
> - §5.1：補 by-rule_id dedup（避免 `searchResults` 跨迭代重複計數）+ wordPattern memoize
> - §5.2 / §6.4：從 optional 升 **mandatory**（修後配對速查列數 ≠ detail 卡片數，無 §5.2 與 i18n 文案會造成 UX 倒退）
> - §5.3：修正對 AI path 的描述（AI findings 也可能有 `interacting_members`，cartesian 對 AI 同樣展開，並非免疫）
> - §6.1：修正 acceptance table 預期值（Candesartan↔Linagliptin 修後 **count=2** 而非 1，rule #4 ARB↔BloodGlucose 在 DB 的 `Agents with Blood Glucose Lowering Effects` group 同時含 Linagliptin 與 Metformin，cartesian 會合法 attribute 到 (Candesartan, Linagliptin) 與 (Candesartan, Metformin) 兩對）

---

## 1. 症狀

| 觀察 | 對應的內部現象 |
|---|---|
| UpToDate 4 筆 → ChatICU detail 3 筆 | `rule_id` 去重正確：UpToDate 把同一條 `Beta-Blockers (Nonselective) ↔ Antidiabetic Agents` class rule 對 (Carvedilol, Linagliptin) 與 (Carvedilol, Metformin) 各列一次；ChatICU 是 by-rule 列一次。**這部分是設計，不是 bug**。 |
| detail 3 筆 → 配對速查只有 2 對 | 摘要 pair-attribution 用 `if (!matchA && ...)` 只取第一個命中藥物；class rule 一側有多藥命中時，第二、第三對沒被產生。 |
| 風險分佈出現 Risk B 1 筆，但配對速查沒有任何 Risk B 對 | 那條 Risk B 規則（`ARB ↔ Agents with Blood Glucose Lowering`）正確的對應對是 Candesartan↔Metformin，但 `validDrugs` 裡 Linagliptin 順序在 Metformin 之前，於是 matchB 落在 Linagliptin，被誤併到 Candesartan↔Linagliptin 那一列、被「取最高 risk = C」吃掉，count 變 2。 |
| Carvedilol↔Metformin 完全消失 | rule `Beta-Blockers (Nonselective) ↔ Antidiabetic Agents` side2 命中 Linagliptin（順序在前）就停手，Metformin 沒被列舉。 |

---

## 2. 觸發案例的 DB 真相（已查證）

5 個輸入藥對應到 DB 裡的 4 條規則；Carvedilol↔Linagliptin 與 Carvedilol↔Metformin **共用同一條 rule_id**，這是 UpToDate 4 vs ChatICU 3 distinct rules 的合理差異：

| UpToDate 顯示的 4 對 | DB rule | rule_id | Risk |
|---|---|---|---|
| Carvedilol ↔ LinaGLIPtin | Beta-Blockers (Nonselective) ↔ Antidiabetic Agents | `ddi_0140a2e928d6` | C |
| Carvedilol ↔ MetFORMIN | **同一條** ↑ | `ddi_0140a2e928d6` | C |
| LinaGLIPtin ↔ Candesartan | Dipeptidyl Peptidase-IV Inhibitors ↔ Angiotensin II Receptor Blockers | `ddi_169e2e66fe1e` | C |
| Candesartan ↔ MetFORMIN | Angiotensin II Receptor Blockers ↔ Agents with Blood Glucose Lowering Effects | `ddi_085545ef250d` | B |

驗證 SQL（保留以利日後重現）：

```sql
SELECT id, drug1, drug2, risk_rating
FROM drug_interactions
WHERE id IN ('ddi_0140a2e928d6','ddi_169e2e66fe1e','ddi_085545ef250d');
```

---

## 3. 根本原因 — 前端摘要 pair-attribution

`src/pages/pharmacy/interactions.tsx:413-446` 對每一條規則只記一對：

```ts
let matchA = '';
let matchB = '';
for (const drug of validDrugs) {
  const dl = drug.toLowerCase();
  if (!matchA && side1.some(n => wordMatch(dl, n))) matchA = drug;  // ← 只取第一個
  if (!matchB && side2.some(n => wordMatch(dl, n))) matchB = drug;  // ← 只取第一個
}
if (!matchA || !matchB || matchA.toLowerCase() === matchB.toLowerCase()) continue;
const [sortedA, sortedB] = [matchA, matchB].sort(...);
const key = `${sortedA.toLowerCase()}|${sortedB.toLowerCase()}`;
const existing = pairMap.get(key);
// ... pairMap upsert，count++ 並取 risk 最高
```

`!matchA &&` 是讓「第一個命中就鎖定」的旗標，跟「列出全部命中」的 cartesian product 行為衝突。

套到觸發案例（`validDrugs = [Mosapride, Candesartan, Linagliptin, Metformin, Carvedilol]`）：

| Rule | side1 命中 | side2 命中 | 應產生 | 實際產生 |
|---|---|---|---|---|
| `ddi_0140a2e928d6` BB(Nonsel.) ↔ Antidiabetic (C) | Carvedilol | Linagliptin, Metformin | Carvedilol↔Linagliptin、Carvedilol↔Metformin | 只有 Carvedilol↔Linagliptin |
| `ddi_169e2e66fe1e` DPP-IV ↔ ARB (C) | Linagliptin | Candesartan | Candesartan↔Linagliptin | ✓ |
| `ddi_085545ef250d` ARB ↔ Blood Glucose (B) | Candesartan | Linagliptin, Metformin | Candesartan↔Metformin | **誤歸 Candesartan↔Linagliptin** |

聚合後的 pairMap：
- `Candesartan|Linagliptin`：rule #2 (C) + rule #4 (B) → count=2，max risk = C ✗
- `Carvedilol|Linagliptin`：rule #1 (C) → count=1
- `Candesartan|Metformin`：缺
- `Carvedilol|Metformin`：缺

完全對應使用者截圖。

---

## 4. 為什麼會反覆出現

DB 裡 6,040 / 10,308（59%）的規則是 class-level（drug1 或 drug2 是群組名）。常見一側涵蓋多輸入藥的 class：

| Class group | 常見成員（一張 ICU 藥單就會多重命中） |
|---|---|
| Anticoagulants | Heparin、Enoxaparin、Apixaban、Rivaroxaban、Dabigatran |
| CNS Depressants | Fentanyl、Midazolam、Propofol、Dexmedetomidine、Morphine |
| Antidiabetic Agents | Metformin、Linagliptin、Insulin、Glipizide |
| CYP3A4 Inhibitors / Inducers (Strong/Moderate) | Clarithromycin、Voriconazole、Diltiazem、Rifampin |
| Blood Pressure Lowering Agents | Carvedilol、Amlodipine、Losartan、Hydralazine |

任何一張 ICU 藥單同時用兩種以上同 class 的藥（極常見），現行邏輯都會把該 class rule 的「第二、第三對」吞掉、並把第二條其他 class rule 誤掛到第一對上。**這不是個案，是高頻問題。**

---

## 5. 修法計畫

### 5.1 主修：摘要 pair-attribution 改 cartesian product（含跨迭代去重 + regex memoize）

**檔案**：`src/pages/pharmacy/interactions.tsx:413-446`
**職責**：把「每條 rule 取一對」改成「列舉 side1 全部命中 × side2 全部命中」。

> **必加保護（review 補上）**：
> - **跨迭代去重**：DB 路徑會對每對藥跑一次 backend query，同一條 class rule 會被多對 query 各回一次，`searchResults.flat()` 後 `rule_id` **重複出現**。如果只在「每條 rule 內」去重，跨迭代仍會把同一個 (rule_id, pair) tuple 計多次（例如 rule#1 從 Carv+Lina query 與 Carv+Met query 各來一次，cartesian 各展兩對 → 同樣 (Carv↔Lina) 與 (Carv↔Met) 各被計兩次，count 變 2）。在進迴圈前先 by-`id` dedup，沿用 `workstation.tsx:379-384` 已驗證的 `byId` pattern。
> - **`wordPattern` memoize**：原本每條 rule × 每藥 × 每 member 都重建一次 RegExp，17 藥 × 4000+ class rules × ~100 members ≈ 7M 次 build。把 `wordPattern(name)` 結果 cache 起來（`Map<string, RegExp | null>`）。

預期改寫（虛擬碼，實際保留現有 `wordMatch` / `pairMap` upsert 結構）：

```ts
// ── NEW: rule-id dedup（class rule 會從多對 query 各回一次）──
const seen = new Set<string>();
const dedupedResults: DisplayInteraction[] = [];
for (const it of searchResults) {
  const id = it.id;
  if (!id || seen.has(id)) continue;
  seen.add(id);
  dedupedResults.push(it);
}

// ── NEW: wordPattern memo cache，避免 7M 次重建 RegExp ──
const patternCache = new Map<string, RegExp | null>();
const cachedPattern = (name: string): RegExp | null => {
  const lower = name.toLowerCase();
  if (patternCache.has(lower)) return patternCache.get(lower)!;
  const p = wordPattern(lower);
  patternCache.set(lower, p);
  return p;
};
const cachedWordMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  const pa = cachedPattern(al);
  const pb = cachedPattern(bl);
  return (pa !== null && pa.test(bl)) || (pb !== null && pb.test(al));
};

const pairMap = new Map<string, { a: string; b: string; risk: string; count: number }>();
const ro: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };

for (const item of dedupedResults) {
  // ── 既有：建 side1 / side2 名稱集合 ──
  const d1l = (item.drug1 || '').toLowerCase();
  const d2l = (item.drug2 || '').toLowerCase();
  const side1: string[] = [d1l];
  const side2: string[] = [d2l];
  for (const g of item.interactingMembers) {
    const gn = (g.group_name || '').toLowerCase();
    const ms = g.members.map(m => m.toLowerCase());
    if (gn === d1l) side1.push(...ms);
    else if (gn === d2l) side2.push(...ms);
  }

  // ── NEW: 取 side1 / side2 全部命中的輸入藥物 ──
  const sideAHits = validDrugs.filter(d => side1.some(n => cachedWordMatch(d, n)));
  const sideBHits = validDrugs.filter(d => side2.some(n => cachedWordMatch(d, n)));
  if (sideAHits.length === 0 || sideBHits.length === 0) continue;

  // ── NEW: cartesian product；同條 rule 對同一對 (a,b) 只算一次 ──
  const seenInThisRule = new Set<string>();
  for (const a of sideAHits) {
    for (const b of sideBHits) {
      if (a.toLowerCase() === b.toLowerCase()) continue;
      const [sortedA, sortedB] = [a, b].sort((x, y) =>
        x.toLowerCase().localeCompare(y.toLowerCase())
      );
      const key = `${sortedA.toLowerCase()}|${sortedB.toLowerCase()}`;
      if (seenInThisRule.has(key)) continue;
      seenInThisRule.add(key);

      const existing = pairMap.get(key);
      const curRisk = ro[item.riskRating] ?? 5;
      if (!existing) {
        pairMap.set(key, { a: sortedA, b: sortedB, risk: item.riskRating || '?', count: 1 });
      } else {
        existing.count++;
        if (curRisk < (ro[existing.risk] ?? 5)) existing.risk = item.riskRating;
      }
    }
  }
}
```

關鍵設計決定：
1. **跨迭代 by-`id` dedup**：避免 backend 同 rule 從多對 query 回多次造成的重複計數（已驗證為 HIGH severity 漏洞）。
2. **`seenInThisRule` 去重**：避免同條 rule 因為 sideA / sideB 對稱命中 (X,Y) 與 (Y,X) 計兩次。兩層去重缺一不可。
3. **`wordPattern` cache**：減少 7M 次 RegExp 重建。
4. **保留既有 word-boundary**：和 2026-05-06 substring bug fix 一致，不退回 `includes`。
5. **count 語意**：count = 「涉及這對藥的 distinct rule 數」（不是「規則總數」也不是「規則 × 配對」雙計），對使用者直覺可解釋。

### 5.2 配修（mandatory）：detail card 標題顯示「實際輸入藥對 (class group)」

> **為什麼從 optional 升 mandatory**：修後配對速查會展開為 4 列（觸發案例），但 detail 卡片仍 by `rule_id` 維持 3 張。使用者點配對速查的 Carvedilol↔Metformin 找不到對應 detail card，UX 比修前更亂。**§5.1 與 §5.2 必須同 commit 上線**。

**檔案**：`src/pages/pharmacy/interactions.tsx:748-855`（CardHeader 標題 + CardTitle）
**現況**：`<CardTitle>{interaction.drug1} + {interaction.drug2}</CardTitle>` 直接顯示 class group 名稱（"Beta-Blockers (Nonselective) + Antidiabetic Agents"），無法對應使用者輸入的具體藥對。
**改法**：
1. 在 §5.1 的 cartesian product 內，順便把每條 rule 對應到的 `applicablePairs: Array<[string, string]>` 算好，存進 result 結構（例如 detail row 多帶一個 `applicablePairs` 欄位）。
2. CardTitle 改顯示：

   ```
   Carvedilol ↔ Linagliptin、Carvedilol ↔ Metformin
   ```
3. 子行顯示 class group 名稱（小字，灰色）：

   ```
   Beta-Blockers (Nonselective) ↔ Antidiabetic Agents（class rule）
   ```

i18n key 新增：`interactions.detail.applicablePairsLabel`（「適用於：」/「Applies to:」），`interactions.detail.classRuleSuffix`（「（class rule）」/「(class rule)」）。

**不改變 detail row 數量**（仍 by `rule_id` 列一次），只讓使用者看得到這條規則覆蓋了哪幾對。

### 5.3 AI 路徑說明（review 修訂）

> **review 修訂**：原稿說「AI findings 已是真正藥對，沒有 class group 攤平問題」**錯誤**。檢視 `src/lib/api/ai.ts` `InteractionCheckResponse.findings[]` 型別，**finding 同樣可帶 `interacting_members`**，AI prompt 也允許回 class-level finding。所以 §5.1 的 cartesian product 對 AI 路徑同樣有效並非「免疫」。

實際行為：
- AI finding 若 `interacting_members` 為空 → `side1 = [drugA]`、`side2 = [drugB]` → cartesian 退化為 1 對（與既有行為一致，無回歸）。
- AI finding 若有 class group → cartesian 同樣展開（與 DB 路徑同樣受益）。

**§7.1 單元測試需新增 AI finding with class group 的 fixture。**

### 5.4 不在這次範圍內 — 留待後續

| 項目 | 為什麼不一起做 |
|---|---|
| `workstation.tsx`（智藥輔助）的 detail card 標題 | 它沒有摘要 pair-attribution，detail 直接列原始 rule，雖然標題同樣顯示 class group 名稱不直觀，但風險等級資訊完整、不會誤導；屬 UX 改善而非正確性 bug。 |
| 後端 `_pair_on_different_sides` | 已用 `word_match` 字邊界保護（2026-05-06 substring bug fix），不在這次範圍。 |
| DB rule #4 (ARB↔BloodGlucose) 的 `Agents with Blood Glucose Lowering Effects` group 是否該收 Linagliptin | 這是 **DB curation** 議題（UpToDate 的 curated view 不把 DPP-IV 算進來，但我們的 DB 收進去了，所以 Candesartan↔Linagliptin 修後會出現 count=2 含 Risk B 規則）。需與藥師確認後另案處理。本修法只負責「正確 attribute 已存在的 rule」。 |
| DB 補 ATC 欄位 | DDI 比對主要靠 drug 名 regex，不靠 ATC；ATC 補回填是另一個獨立任務。 |

---

## 6. 驗收條件（Acceptance Criteria）

### 6.1 觸發案例（5 個藥）

輸入：Mosapride、Candesartan、Linagliptin、Metformin、Carvedilol。

**修前 / 修後對比**（review 修訂後）：

| 區塊 | 修前 | 修後（預期） |
|---|---|---|
| detail 筆數 | 3 | 3（不變，by rule_id） |
| 配對速查列數 | 2 | **4** |
| Carvedilol ↔ Linagliptin | Risk C, count=1 | Risk C, count=1 |
| Carvedilol ↔ Metformin | （缺）| **Risk C, count=1** |
| Candesartan ↔ Linagliptin | Risk C, count=2（含誤歸 B）| **Risk C, count=2**（rule#2 C + rule#4 B，max-severity 取 C）¹ |
| Candesartan ↔ Metformin | （缺）| **Risk B, count=1** |
| 風險分佈 | Risk C: 2、Risk B: 1 | Risk C: 2、Risk B: 1（不變，by rule） |
| Σ 配對速查 count | 3 | 5（= 1+1+2+1）|
| 整體最高風險 | Risk C 監測治療 | Risk C 監測治療（不變） |

¹ **¹ 為什麼 Candesartan ↔ Linagliptin 修後仍是 count=2？**
DB rule `ddi_085545ef250d`（ARB ↔ Agents with Blood Glucose Lowering Effects）的「Agents with Blood Glucose Lowering Effects」group **同時包含 Linagliptin 與 Metformin**（已查 DB 確認）。cartesian product 對 (Candesartan, Linagliptin) 與 (Candesartan, Metformin) 都會合法 attribute 一筆。
- 修前：count=2 但其中一筆是「應該歸 Candesartan↔Metformin 的 rule#4 被誤歸到這裡」（pair-attribution bug）
- 修後：count=2 但兩筆都是合法 attribute（rule#2 DPP-IV↔ARB Risk C + rule#4 ARB↔BloodGlucose Risk B），max-severity 取 C
- **count 數字看起來一樣，但內容已經正確**

UpToDate 之所以不顯示 Candesartan↔Linagliptin 有 ARB↔BloodGlucose 規則，是因為 UpToDate 的 curated view 不把 DPP-IV 算進「Blood Glucose Lowering Effects」group。我們 DB 的 group 定義較寬，這是 §5.4 提到的 DB curation 議題，需藥師另案決議。本修法不處理。

### 6.1.1 風險分佈與配對速查 Σcount 不再相等的解釋

修前風險分佈 = 配對速查 Σcount（因為每條 rule 只歸一對）。修後兩者**會不同**：
- 風險分佈 = `searchResults.length`（distinct rule 數，dedup 後）= 3
- 配對速查 Σcount = `Σ (sideAHits.length × sideBHits.length − 自配對)` over all rules = 1×2 + 1×1 + 1×2 = **5**

UI 文案需明示，避免使用者誤讀（見 §6.4）。

### 6.2 回歸案例

| 案例 | 預期 |
|---|---|
| 兩個藥（Heparin + Aspirin）非 class rule | 配對速查 1 列，count=規則數 |
| 三個藥同 class（Heparin + Enoxaparin + Apixaban，全 Anticoagulants）| Anticoagulants ↔ Anticoagulants 同 class 規則：side1 與 side2 都命中三藥，但因為 cartesian 排除 `a === b`，只產生 (Heparin↔Enoxaparin)、(Heparin↔Apixaban)、(Enoxaparin↔Apixaban)，每對 count=規則數 |
| 兩個藥分屬同一個 class（Linagliptin + Metformin）| `Antidiabetic ↔ Antidiabetic` 同 class rule（如有）只在 sideA / sideB 命中對方時才產生對；不會產生 `Linagliptin↔Linagliptin` 之類自配對 |
| 含 substring 母字串（Methylprednisolone + Prednisolone）| 與 2026-05-06 substring fix 共存，`word_match` 仍維持字邊界保護，不退回 `includes` |

### 6.3 摘要 vs 詳細數字一致性

- 風險分佈的 `Risk X/D/C/B/A` 加總 = detail rule 筆數（搜尋結果的 `rule_id` 數）
- 配對速查的 `Σ count` = `Σ (sideAHits.length × sideBHits.length - 自配對數)` over all rules，應 ≥ 風險分佈加總
- **不要求** 配對速查 `Σ count` = 風險分佈加總（前者是「對-規則」二元組計數，後者是「規則」計數，本來就會不同；UI 文案需澄清）

### 6.4 i18n 文案（mandatory，不可後補）

> **為什麼從 optional 升 mandatory**：修後配對速查 Σcount ≠ 風險分佈規則數，沒有文案明示會讓使用者誤讀（看到「Risk C: 2 筆」但配對速查同 Risk C 卻 Σ=3，會覺得系統算錯）。

**修改檔案**：`src/i18n/locales/{zh-TW,en-US}/pharmacy.json`

| key | 修前 | 修後 zh-TW | 修後 en-US |
|---|---|---|---|
| `interactions.summary.queryStats` | 「查詢 {{drugs}} 種藥品，找到 {{count}} 筆交互作用」 | 「查詢 {{drugs}} 種藥品，找到 **{{count}} 條規則**」 | "Searched {{drugs}} drugs — found **{{count}} rule(s)**" |
| `interactions.summary.tableHeaders.count` | 「筆數」 | 「相關規則數」 | "Rule(s) involved" |
| `interactions.summary.riskCount` | 「{{label}}：{{count}} 筆」 | 「{{label}}：{{count}} 條規則」 | "{{label}}: {{count}} rule(s)" |
| 新增 `interactions.summary.pairLookupNote` | — | 「※ 同一條 class rule 可能涵蓋多對藥，因此「相關規則數」加總可能大於上方「條規則」總數」 | "※ A class rule may cover multiple drug pairs; the per-pair count may sum higher than the total rule count above." |

新 key 也需在 §5.2 的 detail card 標題加：
- `interactions.detail.applicablePairsLabel`：「適用於：」 / "Applies to:"
- `interactions.detail.classRuleSuffix`：「（class rule）」 / " (class rule)"

---

## 7. 測試計畫

### 7.1 單元測試（新增）

`src/pages/pharmacy/__tests__/interactions-summary.test.ts`（新檔）：

```ts
describe('interactions summary pair attribution', () => {
  it('class rule with multi-drug sideB produces N pairs', () => {
    // rule: BB(Nonsel) ↔ Antidiabetic, side1=[Carvedilol], side2=[Linagliptin, Metformin]
    // → expect pairs: [Carvedilol↔Linagliptin, Carvedilol↔Metformin]
  });

  it('overlapping class memberships legitimately attribute to multiple pairs', () => {
    // rule: ARB ↔ BloodGlucose, side1=[Candesartan], side2=[Linagliptin, Metformin]
    // validDrugs = [Mosapride, Candesartan, Linagliptin, Metformin, Carvedilol]
    // → expect pairs: [Candesartan↔Linagliptin (B), Candesartan↔Metformin (B)]
    // → combined with rule #2 (DPP-IV↔ARB Risk C for Candesartan↔Linagliptin),
    //   final pairMap['candesartan|linagliptin'] = { count: 2, risk: 'C' }
  });

  it('same rule_id appearing twice in searchResults is deduped before cartesian', () => {
    // Backend returns rule#1 from both (Carv,Lina) query and (Carv,Met) query.
    // searchResults length = 2 with same id. After by-id dedup → 1 rule.
    // → cartesian over 1 rule produces (Carv↔Lina) count=1 + (Carv↔Met) count=1
    // → NOT count=2 each (would happen without dedup).
  });

  it('same drug on both sides is filtered (no self-pair)', () => {
    // rule: Anticoagulants ↔ Anticoagulants, validDrugs=[Heparin, Enoxaparin]
    // sideAHits=[H,E], sideBHits=[H,E]
    // → expect: 1 pair (Enoxaparin↔Heparin), self-pairs (H↔H, E↔E) skipped,
    //   symmetry (E↔H == H↔E) deduped via seenInThisRule
  });

  it('preserves wordMatch boundary (no substring leakage)', () => {
    // rule with member "Methylprednisolone", input drug "Prednisolone"
    // → must NOT match (consistent with 2026-05-06 substring fix)
  });

  it('AI finding with class group expands like DB rule', () => {
    // AI finding: drugA="ARB", drugB="DPP-IV Inhibitors",
    //             interacting_members=[{group_name:"ARB", members:[Candesartan]},
    //                                   {group_name:"DPP-IV", members:[Linagliptin]}]
    // → expect 1 pair (Candesartan↔Linagliptin)
  });

  it('non-class rule (interacting_members empty) degrades to single pair', () => {
    // rule: Cimetidine ↔ Carvedilol, interacting_members=null
    // → side1=[cimetidine], side2=[carvedilol], cartesian = 1 pair
    //   (identical to pre-fix behavior for non-class rules)
  });

  it('wordPattern memoization does not affect correctness', () => {
    // Run same rule twice, verify pairMap output identical (cache hit path).
  });
});
```

### 7.2 手動測試清單

| # | 步驟 | 預期 |
|---|---|---|
| 1 | 進 `/pharmacy/interactions`，輸入觸發案例 5 藥，按查詢 | 配對速查 4 列，含 Carvedilol↔Metformin、Candesartan↔Metformin |
| 2 | 同上，切換到 `/pharmacy/workstation`（智藥輔助）做同樣輸入 | detail 區仍正確列出 3 條 rule（這頁沒摘要邏輯，不受影響） |
| 3 | I-16 傅壽曉病患 picker 自動帶入用藥（含 Methylprednisolone）查詢 | 不出現 prednisolone 誤撈（與 2026-05-06 substring fix 結果一致） |
| 4 | 純兩藥（Heparin + Aspirin）查詢 | 配對速查 1 列，count 與 detail rule 數一致 |

### 7.3 部署驗證

依 `CLAUDE.md` §「部署與驗證流程」：
- 純前端修改 → push 到 `railway` remote → 等 Vercel build → curl 確認 bundle hash 變動
- `VITE_API_URL` 強制空字串維持不變
- `/pharmacy/interactions` 走 Vercel proxy 不需要 CORS

---

## 8. 風險與回滾

| 風險 | 評估 | 對策 |
|---|---|---|
| 配對速查列數暴增（class rule 對大量同 class 藥單）| ICU 藥單常 15-20 種藥，最壞情境 100+ 對。視覺壓力大 | UI 表格加 `max-h-[400px] overflow-auto`；count 排序仍按 risk |
| 同條 rule 計入多對後，風險分佈不變但配對速查 Σcount 變大 | 是預期行為，但需文案說明 | 5.1 文案 + 6.4 i18n 處理 |
| AI / DB 兩條路徑都共用此摘要邏輯，AI finding 結構不同可能漏匹配 | AI finding 的 drugA/drugB 已是真正藥對而非 class，sideAHits/sideBHits 在這條路徑會退化為 [drugA] / [drugB]，cartesian 結果是 1 對，等於現行行為 | 單元測試覆蓋 AI finding case（mock） |
| 回滾 | 純前端 1 個 commit | revert 該 commit、重新 push railway |

---

## 9. 工作分解（建議單一 commit）

> review 修訂：5.2 與 6.4 升 mandatory，加入單一 commit。

| # | 檔案 | 變更內容 | 對應 § |
|---|---|---|---|
| 1 | `src/pages/pharmacy/interactions.tsx` | 摘要 useMemo 改 cartesian product；加 by-id dedup + wordPattern memo cache；CardTitle 加 applicablePairs 顯示 | §5.1 + §5.2 |
| 2 | `src/pages/pharmacy/__tests__/interactions-summary.test.ts` | 新增 8 個單元測試（含 AI finding、跨迭代 dedup、memo correctness） | §7.1 |
| 3 | `src/i18n/locales/zh-TW/pharmacy.json` | 改 queryStats / tableHeaders.count / riskCount 文案；新增 pairLookupNote / detail.applicablePairsLabel / detail.classRuleSuffix | §6.4 |
| 4 | `src/i18n/locales/en-US/pharmacy.json` | 同上 en-US 對應字串 | §6.4 |
| 5 | `docs/drug-interactions-architecture.md` | 補 cross-link 到本文件 | — |

**不改**：
- 後端（`_pair_on_different_sides` 已有 word-boundary 保護）
- `workstation.tsx`（沒有摘要 pair-attribution，不受影響）
- DB（rule#4 group 是否該收 Linagliptin 屬另案 curation 議題，§5.4 已記錄）

**Commit message**：`fix(pharmacy): expand class-rule pair attribution in interactions summary`

Commit body 提及：
- 修前 5 藥案例配對速查 2 列、Carvedilol↔Metformin 消失
- 修後 4 列含 by-id dedup + wordPattern memo
- 配對速查 count 語意改變（規則數 vs 配對-規則數），文案已對應更新

---

## 10. 與既有資產的關聯

- **2026-05-06 substring bug fix**（`docs/drug-interactions-substring-bug-and-fix.md`）：建立了 `wordMatch` word-boundary 保護，本文件的 cartesian product 改動繼續沿用，不退回 `includes`。
- **Lexicomp XD upgrade**（`docs/lexicomp-xd-upgrade-2026-04-28.md`）：4 月底補進 1,522 筆 Risk X 規則，提高了 class-level rule 比例（DB 已有 59% 是 class-level），讓本 bug 的暴露率變高。
- **`drug-interactions-architecture.md`**：DDI 比對 pipeline 全圖，會在本修法落地後加一條 cross-link。
