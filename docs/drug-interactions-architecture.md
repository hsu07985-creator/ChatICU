# 用藥交互 — 「查詢」按鈕背後的程式碼

> 撰寫日期：2026-05-06
> 範圍：
> 1. `/pharmacy/interactions`（用藥交互頁）按下「查詢」按鈕的完整呼叫鏈
> 2. `/pharmacy/workstation`（智藥輔助頁）按下「執行評估」時，**交互作用部分**重用的同一條鏈路
>
> 不涵蓋：兩頁的其他互動（病患選擇器、新增藥物、清除、結果渲染、摘要計算、智藥輔助的相容/劑量/重複用藥/PAD 等其他三條 task）。

---

## 0. 一張圖看完整鏈路

```
USER 按「查詢」
   │
   ▼
[Frontend] interactions.tsx:586  Button onClick={handleSearch}
   │
   ▼
[Frontend] interactions.tsx:213  handleSearch()
   │ 1. 過濾空字串 + 去重 → validDrugs
   │ 2. 至少 2 個藥，否則 toast.error 結束
   │ 3. setLoading(true); setHasSearched(true)
   │ 4. Promise.all 並行打兩支 API ↓↓↓
   │
   ├──── A. checkInteractions({ drugList: validDrugs })
   │       │  src/lib/api/ai.ts:973
   │       ▼
   │     POST /api/v1/clinical/interactions
   │       │  body: { drug_list: ["Warfarin", "Aspirin", ...] }
   │       ▼
   │     [Backend] backend/app/routers/clinical.py:819  interaction_check
   │       │  - require_roles(admin/doctor/np/pharmacist/nurse)
   │       │  - rate limit 60/min
   │       │  - drugs = drug_list[:10]
   │       │  - 對 N 取 2 每對：
   │       │      SELECT * FROM drug_interactions
   │       │      WHERE _drug_match_clause(da)
   │       │        AND _drug_match_clause(db)
   │       │        LIMIT 50
   │       │  - filter _pair_on_different_sides → seen_ids 去重
   │       │  - 取最高 severity（contraindicated > major > moderate > minor）
   │       │  - 寫 audit_log（action="交互作用查詢"）
   │       ▼
   │     200 { overall_severity, findings: [...], source: "database" }
   │
   └──── B. queryDatabase()  // interactions.tsx:224 內部 helper
           │  for i,j in N 取 2:
           │    pairs.push([drugA, drugB, i, j])
           │  Promise.all(pairs.map(...))
           │
           ▼
         GET /pharmacy/drug-interactions?drugA=...&drugB=...
           │  src/lib/api/pharmacy.ts:169  getDrugInteractions
           ▼
         [Backend] backend/app/routers/pharmacy_routes/interactions.py:136
                   search_drug_interactions
           │  Step 1: try drug_graph_bridge.search_interactions(...)
           │     → 需要 data/drug_interactions/DrugData/drug_graph_rag.py 存在
           │     → 目前 repo 沒這檔，會 catch Exception 走 Step 2
           │  Step 2: SELECT * FROM drug_interactions
           │            WHERE _drug_match(drugA) AND _drug_match(drugB)
           │            LIMIT 500
           │          filter _pair_on_different_sides
           │          sort _relevance_score = (direct, risk_rank, severity_rank)
           │          paginate
           ▼
         200 { interactions: [...], total, source: "database" }

   ▼ Promise.all 收回 [aiResult, dbResults]
   │
   if (aiResult.findings.length > 0):
     setResultSource('ai')                         // 紫色 badge
     setSearchResults(map + sort by Risk X→A)
   else:
     setResultSource('database')                   // 藍色 badge
     setSearchResults(dbResults)
   setLoading(false)
```

---

## 1. 觸發點 — 按鈕本身

**檔案**：`src/pages/pharmacy/interactions.tsx`

```tsx
// 行 585-593
<Button onClick={handleSearch} disabled={loading}>
  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
           : <Search className="mr-2 h-4 w-4" />}
  {t('interactions.actions.search')}
</Button>
```

`disabled={loading}` 防止 click spam。`t('interactions.actions.search')` 是 i18n key（中文「查詢」/英文 "Search"）。

---

## 2. `handleSearch` — 前端入口

**檔案**：`src/pages/pharmacy/interactions.tsx:213-318`

### 2.1 輸入正規化（213-218）

```ts
const validDrugs = [...new Set(drugs.map(d => d.trim()).filter(Boolean))];
if (validDrugs.length < 2) {
  toast.error(t('interactions.validation.needTwo'));
  return;
}
```

- `drugs` 是當前 N 個 input 的 state。
- 去前後空白、過濾空字串、`Set` 去重 — 同一個藥重複輸入會被合併。
- 不到 2 個直接 toast 提示後 return。

### 2.2 設旗標（220-221）

```ts
setLoading(true);
setHasSearched(true);
```

`hasSearched` 控制結果區塊何時要 render。

### 2.3 並行打兩支 API（266-269）

```ts
const [aiResult, dbResults] = await Promise.all([
  checkInteractions({ drugList: validDrugs }, { suppressErrorToast: true }).catch(() => null),
  queryDatabase(),
]);
```

兩支同時發、同時等。`suppressErrorToast: true` 讓 401/500 不會跳 toast，由頁面自己處理。`.catch(() => null)` 確保 A 失敗時 B 仍能用。

### 2.4 結果採用策略（271-310）

```ts
const aiFindings = aiResult?.findings || [];

if (aiFindings.length > 0) {
  setResultSource('ai');
  setOverallSeverity(aiResult?.overall_severity || 'none');
  const mapped: DisplayInteraction[] = aiFindings.map((f, idx) => ({
    id: `int-${idx}`,
    drug1: f.drugA || f.drug_a || validDrugs[0],
    drug2: f.drugB || f.drug_b || validDrugs[1],
    severity: mapSeverity(f.severity),
    // ... 其他欄位 snake_case → camelCase
  }));
  const riskOrder: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };
  mapped.sort((a, b) => (riskOrder[a.riskRating] ?? 5) - (riskOrder[b.riskRating] ?? 5));
  setSearchResults(mapped);
} else {
  setResultSource('database');
  if (dbResults.length) {
    const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const max = dbResults.reduce((acc, it) =>
      (rank[it.severity] > rank[acc] ? it.severity : acc), 'low');
    setOverallSeverity(max);
  } else {
    setOverallSeverity('none');
  }
  setSearchResults(dbResults);
}
```

**A 路徑（`checkInteractions`）有結果就贏**，沒有才看 B 路徑。
A 路徑會按 Lexicomp Risk Rating（X → D → C → B → A）排序；B 路徑後端已經排好。

### 2.5 收尾（315-317）

```ts
} finally {
  setLoading(false);
}
```

---

## 3. 路徑 A — `checkInteractions` （前端 → 後端 clinical.py）

### 3.1 前端 API client

**檔案**：`src/lib/api/ai.ts:973-989`

```ts
export async function checkInteractions(data: {
  drugList: string[];
  patientContext?: PatientContext;
}, options?: { suppressErrorToast?: boolean }): Promise<InteractionCheckResponse> {
  const payload: Record<string, unknown> = {
    drug_list: data.drugList,
  };
  if (data.patientContext) {
    payload.patient_context = data.patientContext;
  }
  const response = await apiClient.post<ApiResponse<InteractionCheckResponse>>(
    '/api/v1/clinical/interactions',
    payload,
    { suppressErrorToast: options?.suppressErrorToast },
  );
  return ensureData(response.data, 'API contract');
}
```

回應型別 `InteractionCheckResponse` 定義在 `ai.ts:933-971`，重點欄位：
`request_id`、`overall_severity`、`findings[]`、`applied_rules[]`、`citations[]`、`conflicts[]`、`confidence`。

### 3.2 後端 endpoint

**檔案**：`backend/app/routers/clinical.py:819-927`
**Schema**：`backend/app/schemas/clinical.py:166-168`

```python
class InteractionCheckRequest(BaseModel):
    drug_list: List[str] = Field(..., min_length=2)
    patient_context: Optional[PatientContext] = None
```

```python
# clinical.py:819-832
@router.post("/interactions")
@limiter.limit("60/minute")
async def interaction_check(
    req: InteractionCheckRequest,
    request: Request,
    user: User = Depends(require_roles(
        "admin", "doctor", "np", "pharmacist", "nurse"
    )),
    db: AsyncSession = Depends(get_db),
):
    """Check drug-drug interactions via the local DrugInteraction table."""
    drugs = req.drug_list[:10]   # 硬上限 10
```

#### 3.2.1 SQL 過濾子句（840-847）

```python
def _drug_match_clause(drug_name: str):
    escaped = escape_like(drug_name)
    return or_(
        DrugInteraction.drug1.ilike(f"%{escaped}%"),
        DrugInteraction.drug2.ilike(f"%{escaped}%"),
        cast(DrugInteraction.interacting_members, SAString).ilike(f"%{escaped}%"),
    )
```

把 JSONB `interacting_members` cast 成字串再 ilike — 可命中「Aspirin」屬於某個 NSAID 群組成員的 row。

#### 3.2.2 不同邊驗證（849-868）

```python
def _pair_on_different_sides(row, da: str, db_: str) -> bool:
    members = row.interacting_members if isinstance(row.interacting_members, list)
              else (json.loads(row.interacting_members) if row.interacting_members else [])
    d1_l = (row.drug1 or "").lower()
    d2_l = (row.drug2 or "").lower()
    side1 = {d1_l}
    side2 = {d2_l}
    for g in members:
        gn = (g.get("group_name") or "").lower()
        member_set = {m.lower() for m in g.get("members", [])}
        if gn == d1_l: side1.update(member_set)
        elif gn == d2_l: side2.update(member_set)
    da_l, db_l = da.lower(), db_.lower()
    da_s1 = any(da_l in n or n in da_l for n in side1)
    da_s2 = any(da_l in n or n in da_l for n in side2)
    db_s1 = any(db_l in n or n in db_l for n in side1)
    db_s2 = any(db_l in n or n in db_l for n in side2)
    return (da_s1 and db_s2) or (da_s2 and db_s1)
```

避免「同一個群組裡兩個成員 vs. 自己」的假陽性。`in` 是 substring 包含關係，這層判定相對寬鬆。

#### 3.2.3 主迴圈（870-908）

```python
seen_ids = set()
for i in range(len(drugs)):
    for j in range(i + 1, len(drugs)):
        da, db_ = drugs[i], drugs[j]
        query = select(DrugInteraction).where(
            _drug_match_clause(da)
        ).where(
            _drug_match_clause(db_)
        )
        rows_result = await db.execute(query.limit(50))
        for row in rows_result.scalars().all():
            if row.id in seen_ids: continue
            if not _pair_on_different_sides(row, da, db_): continue
            seen_ids.add(row.id)
            sev = row.severity or "unknown"
            if severity_rank.get(sev, 0) > severity_rank.get(max_sev, 0):
                max_sev = sev
            db_findings.append({
                "drug_a": row.drug1, "drug_b": row.drug2,
                "severity": sev,
                "mechanism": row.mechanism or "",
                "clinical_effect": row.clinical_effect or "",
                "recommended_action": row.management or "",
                "dose_adjustment_hint": row.references or "",
                "risk_rating": row.risk_rating or "",
                "interacting_members": row.interacting_members or [],
                "pubmed_ids": row.pubmed_ids or [],
                # ... 其餘欄位
                "source": "database",
            })
```

#### 3.2.4 Audit + 回應（916-927）

```python
await create_audit_log(
    db, user_id=user.id, user_name=user.name, role=user.role,
    action="交互作用查詢",
    target=",".join(req.drug_list[:5]),   # 只記前 5 個
    status="success",
    ip=request.client.host if request.client else None,
    details={
        "drug_count": len(req.drug_list),
        "overall_severity": result.get("overall_severity"),
        "source": "database",
    },
)
return success_response(data={
    "overall_severity": max_sev,
    "findings": db_findings,
    "source": "database",
})
```

> **注意**：endpoint 名稱在 frontend 標為 "AI"，但後端**沒呼叫 LLM**，純 DB 查詢。

---

## 4. 路徑 B — `queryDatabase` （前端 → 後端 pharmacy_routes/interactions.py）

### 4.1 前端 helper（interactions.tsx:223-262）

```ts
const queryDatabase = async () => {
  const pairs: Array<[string, string, number, number]> = [];
  for (let i = 0; i < validDrugs.length; i++) {
    for (let j = i + 1; j < validDrugs.length; j++) {
      pairs.push([validDrugs[i], validDrugs[j], i, j]);
    }
  }
  const pairResults = await Promise.all(
    pairs.map(async ([drugA, drugB, i, j]) => {
      try {
        const resp = await getDrugInteractions(
          { drugA, drugB },
          { suppressErrorToast: true }
        );
        return (resp.interactions || []).map((r: any, idx: number) => ({
          id: r.id || `db-int-${i}-${j}-${idx}`,
          drug1: r.drug1 || drugA,
          drug2: r.drug2 || drugB,
          severity: mapSeverity(r.severity || ''),
          // ... 其餘欄位
        }));
      } catch {
        return [];   // 任一對失敗只丟空陣列，不影響其他對
      }
    })
  );
  return pairResults.flat();
};
```

**前端做 N 取 2**，每對一個 HTTP，全部並發。`mapSeverity` 把後端 `contraindicated/major/moderate/...` 收斂成 UI 用的 `high/medium/low`：

```ts
// interactions.tsx:335-341
const mapSeverity = (s?: string): string => {
  if (!s) return 'low';
  const lower = s.toLowerCase();
  if (lower === 'contraindicated' || lower === 'major') return 'high';
  if (lower === 'moderate') return 'medium';
  return 'low';
};
```

### 4.2 前端 API client

**檔案**：`src/lib/api/pharmacy.ts:169-178`

```ts
export async function getDrugInteractions(params: {
  drugA: string;
  drugB?: string;
}, options?: { suppressErrorToast?: boolean }): Promise<DrugInteractionSearchResponse> {
  const response = await apiClient.get<ApiResponse<DrugInteractionSearchResponse>>(
    '/pharmacy/drug-interactions',
    { params, suppressErrorToast: options?.suppressErrorToast }
  );
  return ensureData(response.data, 'API contract');
}
```

### 4.3 後端 endpoint

**檔案**：`backend/app/routers/pharmacy_routes/interactions.py:136-190`

```python
@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    allowRag: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1) Try drug graph first
    try:
        resolved_a = drug_graph_bridge.resolve_drug(drugA)
        resolved_b = drug_graph_bridge.resolve_drug(drugB) if drugB else None
        if resolved_a:
            graph_results = drug_graph_bridge.search_interactions(
                drug_a=resolved_a, drug_b=resolved_b,
                page=page, limit=limit,
            )
            if graph_results:
                return success_response(data={
                    "interactions": graph_results,
                    "total": len(graph_results),
                    "source": "drug_graph",
                })
    except Exception as e:
        logging.getLogger(__name__).warning(
            "drug_graph_bridge error (falling back to DB): %s", e
        )

    # 2) Fallback to database
    query = select(DrugInteraction).where(_drug_match(drugA))
    if drugB:
        query = query.where(_drug_match(drugB))
    result = await db.execute(query.limit(500))
    interactions: List[DrugInteraction] = list(result.scalars().all())

    if drugB:
        interactions = [i for i in interactions
                        if _pair_on_different_sides(i, drugA, drugB)]

    interactions.sort(key=lambda i: _relevance_score(i, drugA, drugB))

    offset = (page - 1) * limit
    page_items = interactions[offset:offset + limit]

    return success_response(data={
        "interactions": [_interaction_to_dict(i) for i in page_items],
        "total": len(interactions),
        "page": page, "limit": limit,
        "source": "database",
    })
```

#### 4.3.1 排序鍵（52-68）

```python
_SEVERITY_RANK = {"contraindicated": 0, "major": 1, "moderate": 2, "minor": 3}
_RISK_RANK = {"X": 0, "D": 1, "C": 2, "B": 3, "A": 4}

def _relevance_score(interaction, drug_a: str, drug_b: str) -> tuple:
    d1 = (interaction.drug1 or "").lower()
    d2 = (interaction.drug2 or "").lower()
    a_lower = drug_a.lower()
    b_lower = drug_b.lower() if drug_b else ""
    direct = 0
    if a_lower in d1 or a_lower in d2: direct += 1
    if b_lower and (b_lower in d1 or b_lower in d2): direct += 1
    direct_priority = 2 - direct
    risk = _RISK_RANK.get(interaction.risk_rating or "", 5)
    sev = _SEVERITY_RANK.get((interaction.severity or "").lower(), 5)
    return (direct_priority, risk, sev)
```

把直接命中（不靠 `interacting_members` 群組擴展）的列排前面，再按 Risk X→A，再按 severity。

#### 4.3.2 序列化（112-133）

```python
def _interaction_to_dict(i: DrugInteraction) -> dict:
    return {
        "id": i.id,
        "drug1": i.drug1, "drug2": i.drug2,
        "severity": i.severity,
        "mechanism": i.mechanism,
        "clinicalEffect": i.clinical_effect,        # snake → camel
        "management": i.management,
        "references": i.references,
        "riskRating": i.risk_rating,
        "riskRatingDescription": i.risk_rating_description,
        "severityLabel": i.severity_label,
        "reliabilityRating": i.reliability_rating,
        "routeDependency": i.route_dependency,
        "discussion": i.discussion,
        "footnotes": i.footnotes,
        "dependencies": _parse_json_field(i.dependencies),
        "dependencyTypes": _parse_json_field(i.dependency_types),
        "interactingMembers": _parse_json_field(i.interacting_members),
        "pubmedIds": _parse_json_field(i.pubmed_ids),
    }
```

`_parse_json_field`（40-49）能容忍 JSONB（已是 list）或舊 Text 欄位（JSON 字串）兩種格式。

---

## 5. 兩支 API 的差別速查

| 維度 | A. `POST /api/v1/clinical/interactions` | B. `GET /pharmacy/drug-interactions` |
|---|---|---|
| 前端 client | `checkInteractions` | `getDrugInteractions` |
| 輸入 | `drug_list: [...]`（一次傳全部） | `drugA`, `drugB`（每對一次） |
| 配對邏輯 | 後端 N 取 2 | 前端 N 取 2，每對一個 HTTP |
| 走 drug_graph | ❌ | ✅（失敗 fallback DB） |
| Audit log | ✅ `action="交互作用查詢"` | ❌ |
| 角色限制 | clinical roles only | 任何登入者 |
| Rate limit | 60/min | 無 |
| `drug_list` 上限 | `[:10]` | N/A |
| 前端優先採用 | ✅（findings ≥ 1 即用） | fallback |

---

## 6. 智藥輔助（`/pharmacy/workstation`）也用同一條鏈路

「執行評估」按鈕背後的 `handleComprehensiveAssessment` 是**綜合評估**：交互作用、IV 配伍、劑量、重複用藥四件事**並行**跑。其中**交互作用那條 task 用的是同樣的兩支 API**，但有幾處差異需要注意。

### 6.1 觸發點

**檔案**：`src/pages/pharmacy/workstation/assessment-results-panel.tsx:240`、`331`

```tsx
<Button onClick={onRunAssessment} disabled={!assessReady} ...>
  {isAssessing ? t('workstation.assess.panel.processing')
                : t('workstation.assess.panel.runAssessment')}  {/* 「執行評估」 */}
</Button>
```

`onRunAssessment` prop 從 `workstation.tsx:1076` 綁到 `handleComprehensiveAssessment`。

### 6.2 `handleComprehensiveAssessment`（workstation.tsx:278-329）

```ts
const handleComprehensiveAssessment = async () => {
  if (drugList.length === 0) { toast.error(...); return; }
  if (!selectedPatient)        { toast.error(...); return; }

  setIsAssessing(true);
  try {
    const uniqueDrugs = Array.from(
      new Set(drugList.map(d => d.trim()).filter(Boolean))
    );

    const patientContext: PatientContext = {
      age_years:    selectedPatient.age,
      height_cm:    extendedData?.height,
      weight_kg:    extendedData?.weight,
      sex:          normalizePatientGender(selectedPatient.gender),
      crcl_ml_min:  extendedData?.egfr,
      hepatic_class: hepaticMap[extendedData?.hepaticFunction || 'normal'],
      sbp_mmHg:     extendedData?.sbp,
      hr_bpm:       extendedData?.hr,
      rr_bpm:       extendedData?.rr,
      k_mmol_l:     extendedData?.k,
    };

    const [interactions, ...] = await Promise.all([
      // Task 1: Interactions  ← 本文重點
      // Task 2: Compatibility (IV) — getIVCompatibilityBatch
      // Task 3: Dosage         — padCalculate
      // Task 4: Duplicates
    ]);
  }
};
```

**和「用藥交互」頁的差異 #1**：強制要求 `selectedPatient`（病患選擇器是必填）；用藥交互頁只是建議，不選也能查。

**和「用藥交互」頁的差異 #2**：會帶 `patientContext`（年齡、身高體重、性別、CrCl、肝功 Child-Pugh、SBP、HR、RR、K+）。

### 6.3 Task 1：交互作用查詢（workstation.tsx:331-408）

```ts
// Task 1: Interactions
(async (): Promise<DrugInteraction[]> => {
  try {
    // 主路徑：和用藥交互頁同一支 API
    const res = await checkInteractions(
      { drugList: uniqueDrugs, patientContext },     // ← 多帶 patientContext
      { suppressErrorToast: true },
    );
    return (res.findings || [])
      .map((f, idx) => ({
        id: `int_${idx}`,
        drugA: f.drugA || f.drug_a || '',
        drugB: f.drugB || f.drug_b || '',
        severity: mapSeverity(f.severity),
        // ... mechanism / clinicalEffect / management / riskRating ...
      }))
      .filter(x => x.drugA && x.drugB);
  } catch (err) {
    // Fallback 路徑：checkInteractions 整個失敗才打 getDrugInteractions
    console.warn('Evidence 交互作用引擎不可用，改用本地資料庫查詢', err);
    try {
      const pairCalls = [];
      for (let i = 0; i < uniqueDrugs.length; i++) {
        for (let j = i + 1; j < uniqueDrugs.length; j++) {
          pairCalls.push(getDrugInteractions({
            drugA: uniqueDrugs[i],
            drugB: uniqueDrugs[j],
          }));
        }
      }
      const respList = await Promise.all(pairCalls);
      const all = respList.flatMap(resp => resp.interactions || []);
      // 用 it.id 去重後 map 成 DrugInteraction[]
      ...
    } catch (fallbackErr) {
      console.error(...); return [];
    }
  }
})(),
```

**和「用藥交互」頁的差異 #3 — fallback 邏輯不同**：

| 行為 | 用藥交互頁 (`interactions.tsx`) | 智藥輔助頁 (`workstation.tsx`) |
|---|---|---|
| 兩支 API 觸發 | **並行**：`Promise.all([A, B])` 都打 | **序列**：A 失敗（throw / reject）才退到 B |
| 採用判斷 | A 有 findings 就用 A，否則用 B | A 成功就用 A（即使 findings 是空也用），B 只當例外救援 |

也就是說，如果 `checkInteractions` 回 200 但 `findings = []`，**智藥輔助會直接顯示「沒有交互作用」，不會再去打 `getDrugInteractions`**；用藥交互頁則會 fallback 顯示 DB 結果。

> 註：上面 `checkInteractions` 失敗時的 console warning 寫的是「Evidence 交互作用引擎」，這是更早期 evidence_rag 路線的命名遺留 — 目前 `/api/v1/clinical/interactions` 後端只查 DB，沒有 RAG。

**和「用藥交互」頁的差異 #4 — 後端走的是同一支，但 patientContext 目前未被使用**：

`backend/app/schemas/clinical.py:166-168` 接受 `patient_context`，但 `backend/app/routers/clinical.py:819-927` 內**沒有讀 `req.patient_context`** —— 整個 endpoint 只用 `req.drug_list[:10]` 做 DB pair lookup。智藥輔助多送的 patient context 目前是 ignored field，沒有影響查詢結果。（這是預留欄位，給未來 RAG / 規則引擎用。）

### 6.4 結果落點

`Task 1` 回傳的 `DrugInteraction[]` 透過 `setAssessmentResults({ interactions, compatibility, dosage, duplicates, ... })`（`workstation.tsx:716`）寫進 state，由 `assessment-results-panel.tsx` 的「交互作用」卡片渲染：

- 顯示總數 + Risk X 高風險紅標（`assessment-results-panel.tsx:369-376`、`483-486`）
- 排序方式：X → D → C → B → A（`272`）
- 沒有「用藥交互」頁那套「摘要 + 配對速查表」UI；改成嵌在 `pharmacy-report-view.tsx` 的「DDI 段」內

### 6.5 完整呼叫鏈對照

```
[智藥輔助] 按「執行評估」
   │
   ▼
workstation/assessment-results-panel.tsx:240/331  Button onRunAssessment
   │
   ▼
workstation.tsx:1076                              onRunAssessment={handleComprehensiveAssessment}
   │
   ▼
workstation.tsx:278  handleComprehensiveAssessment()
   │ - 驗證 drugList + selectedPatient
   │ - 組 patientContext（age/sex/crcl/hepatic/sbp/hr/rr/k...）
   │ - Promise.all([Task1 ddi, Task2 iv-compat, Task3 dose, Task4 dup])
   │
   ▼ Task 1 (workstation.tsx:331-408)
   │
   ├─ try: checkInteractions({ drugList, patientContext })
   │       │  src/lib/api/ai.ts:973
   │       ▼
   │     POST /api/v1/clinical/interactions
   │       └─ backend/app/routers/clinical.py:819  ← 與用藥交互頁完全相同
   │          （req.patient_context 目前未使用）
   │
   └─ catch: 才 fallback to getDrugInteractions（per-pair）
           │  src/lib/api/pharmacy.ts:169
           ▼
         GET /pharmacy/drug-interactions?drugA=...&drugB=...
           └─ backend/app/routers/pharmacy_routes/interactions.py:136
              （有 drug_graph_bridge 嘗試 → DB fallback）
```

---

## 7. 完整檔案/行號索引

### 用藥交互頁（`/pharmacy/interactions`）

| 步驟 | 檔案 | 行 |
|---|---|---|
| 按鈕 | `src/pages/pharmacy/interactions.tsx` | 586 |
| handleSearch | `src/pages/pharmacy/interactions.tsx` | 213-318 |
| queryDatabase（內部 helper） | `src/pages/pharmacy/interactions.tsx` | 224-262 |
| `mapSeverity` | `src/pages/pharmacy/interactions.tsx` | 335-341 |

### 智藥輔助頁（`/pharmacy/workstation`）

| 步驟 | 檔案 | 行 |
|---|---|---|
| 按鈕 | `src/pages/pharmacy/workstation/assessment-results-panel.tsx` | 240, 331 |
| 綁定 prop | `src/pages/pharmacy/workstation.tsx` | 1076 |
| handleComprehensiveAssessment | `src/pages/pharmacy/workstation.tsx` | 278-329 |
| Task 1 主路徑（`checkInteractions`） | `src/pages/pharmacy/workstation.tsx` | 331-356 |
| Task 1 fallback（`getDrugInteractions` per-pair） | `src/pages/pharmacy/workstation.tsx` | 357-408 |
| 結果寫入 state | `src/pages/pharmacy/workstation.tsx` | 716 |
| UI 渲染 | `src/pages/pharmacy/workstation/assessment-results-panel.tsx` | 258-380, 483-510 |

### 共用前端 client + 後端

| 步驟 | 檔案 | 行 |
|---|---|---|
| `checkInteractions` client | `src/lib/api/ai.ts` | 973-989 |
| `getDrugInteractions` client | `src/lib/api/pharmacy.ts` | 169-178 |
| `InteractionCheckRequest` schema | `backend/app/schemas/clinical.py` | 166-168 |
| `interaction_check` endpoint (A) | `backend/app/routers/clinical.py` | 819-927 |
| `search_drug_interactions` endpoint (B) | `backend/app/routers/pharmacy_routes/interactions.py` | 136-190 |
| `_drug_match` / `_pair_on_different_sides` (B) | `backend/app/routers/pharmacy_routes/interactions.py` | 27-109 |
| `_relevance_score` (B) | `backend/app/routers/pharmacy_routes/interactions.py` | 52-68 |
| `_interaction_to_dict` (B) | `backend/app/routers/pharmacy_routes/interactions.py` | 112-133 |
| `DrugInteraction` model | `backend/app/models/drug_interaction.py` | 11-41 |
