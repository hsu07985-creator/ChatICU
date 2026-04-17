# 病例紀錄 — 藥師 SOAP 修飾流程修改方案（強化版）

日期: 2026-04-17（v2，經三方獨立評審強化）
來源: 藥師端使用回饋 + domain / prompt-engineering / frontend-UX 三方 agent 評審
範圍: `medication-advice` 類型的 AI 修飾流程（前端 + 後端 prompt + schema）

---

## 使用者實際流程（藥師視角）

藥師撰寫用藥建議時也採用 SOAP 格式，但內容安排與醫師 progress note 不同：

| 區段 | 內容 | 來源 | 是否需要 AI |
|------|------|------|-------------|
| **S** | 主要用藥相關主訴 | 自填 / HIS | 否（直接貼上） |
| **O** | 診斷、lab data、目前用藥 | **從 HIS 複製貼上** | 否（直接貼上） |
| **A** | 評估；可能貼入 guideline / 仿單 / 資料庫參考段落，或中英夾雜破英文自寫 | 自寫 or 複製參考資料 | **是** — 修文法不增減 |
| **P** | 藥師主要用藥建議 | 藥師中英夾雜破英文自寫 | **是** — 修文法 + 套藥師格式 |

### P 段格式要求

1. 條列式呈現
2. 藥物格式：`商品名 + (學名 + 單位劑量) + 劑量 + 頻次`
3. 藥物建議的內容結構：**先說原因（一句、≤20 字）**（腎功能不好 / 藥物交互作用 / 避免副作用）→ **再用禮貌語氣**（例：`please consider adjusting...`）請對方調整
4. **每個 P 結尾加一句追蹤提醒**（monitoring / follow-up），開頭 `Monitor:`

### 共通核心原則

**AI 只修文法、不增減內容**：不可加入使用者沒寫的臨床內容；不可砍掉使用者寫的內容；不可壓縮到特定行數。

---

## 核心結論（三方評審共識）

三個獨立 agent（domain / prompt engineer / frontend UX）一致指出**四個結構性盲點**，初版 `.md` 僅靠「單 Textarea + prompt 指令」的路徑無法解決：

1. **純 prompt 指令鎖不住「不增減」**：LLM 對 `DO NOT add/remove/compress` 實測命中率僅 60–75%，長文 guideline 更低。必須補 **few-shot 正反例 + delimiter 強制 echo + 自檢**。
2. **S/O 段在單一 Textarea 下仍會被 AI 動**：`handlePolishContent` 把整個 `inputContent` 一整塊送 API，template 只是把「S:/O:/A:/P:」當字串預填，AI 仍有權動 S/O。**唯一技術上保證 S/O 不動的方法是 4-Textarea 分段**。
3. **REFINEMENT MODE 會吞掉藥師格式規則**（最危險）：後端 `clinical_polish` prompt L213 的 `IGNORE all polish/format instructions above` 會讓第二次「再修一次」退化成通用英文，藥師 4 項格式全消失。
4. **Eval 沒有量化判定方法**：初版「文字量 ±10%」太粗糙，需要 sentence/entity recall + LLM-as-judge rubric。

### 優先級重排（不同於初版）

| 初版 | 新版 | 項目 | 理由 |
|------|------|------|------|
| P3 | **P0** | 藥師 role + medication-advice 走 4-Textarea 分段 UI | 唯一能 100% 保證 S/O 不被動；信任臨界點 |
| P0 | **P0** | 後端 prompt 改寫（保留優先 + 藥師格式 + **few-shot + self-check + 縮寫表**） | 對 A/P 品質關鍵；但必須強化 |
| — | **P0** | **REFINEMENT MODE 修正**（不再 IGNORE polish_type 格式） | 不修的話 P0 prompt 成果會被二次修飾吃掉 |
| — | **P1** | **一鍵插入 lab / 目前用藥**（呼叫既有 patient API） | 比 template 更救命，省切視窗 |
| P0 | **P1** | 藥師 SOAP 模板（含 Allergy）+ description + placeholder | 配合 P3 分段改成四區預填 |
| P1 | **P2** | refinement chips（append 模式 + removable list + 藥師 gate） | 組合指令不被覆蓋 |
| P2 | **P2** | `polish_mode` 合併 enum（`full` / `grammar_only` / `refinement` / `refinement_grammar_only`） | 避免兩個 IGNORE 互踩 |
| — | **P2** | 左側 `font-mono` + `selectedTemplate` 存入 draft + 複製後 `submittedAt` + diff view | UX 細節總合 |

---

## 現況問題（補強版）

### 後端 prompt

| # | 位置 | 問題 | 評審來源 |
|---|------|------|---------|
| B1 | `backend/app/llm.py:198-201` | `Concise`/`3–6 lines`/`at most ONE rationale` 主動砍內容，違反「不增減」 | 初版 + prompt agent |
| B2 | 同上 | 沒有「藥師 SOAP」結構概念，只有處方單格式 | 初版 |
| B3 | 同上 | 藥物格式規範缺（商品名+(學名+劑量)+頻次） | 初版 |
| B4 | 同上 | 沒禮貌語氣規則、沒結尾 follow-up 規則 | 初版 |
| B5 | 全域 | 沒有「只修文法、不增減內容」的 mode | 初版 |
| **B6** | `backend/app/llm.py:212-218` | **REFINEMENT MODE 寫 `IGNORE all polish/format instructions above`，會吞掉藥師格式規則** | prompt agent |
| **B7** | `backend/app/llm.py:184-210` | `progress_note → Full SOAP（主動填）` 與新 `medication_advice → 保留 SOAP` 同 prompt 內衝突，LLM 易混用 | prompt agent |
| **B8** | 同上 | OUTPUT LANGUAGE RULES 的 `clean professional English` 對整段中文 guideline 會觸發翻譯重寫與「保留」衝突 | prompt agent |
| **B9** | — | 缺破英文縮寫對照表（`d/c`、`sug`、`d/t`、`bcz`、`f/u`、`pt` 等），`d/c` 被誤譯 `discharge` 是病人安全事件 | domain agent |
| **B10** | — | 缺 few-shot 範例；條件分支規則（「有藥物才套格式、先原因後禮貌」）純文字命中率 50% | prompt agent |
| **B11** | — | 缺「括號內參考值保留」規則（`Cr 1.8 (0.6-1.2)` 常被 AI 刪括號） | domain agent |

### 前端 UI / 模板

| # | 位置 | 問題 | 評審來源 |
|---|------|------|---------|
| F1 | `src/components/medical-records.tsx:85-96` | 無「藥師 SOAP」模板、無 Allergy 欄位 | 初版 + domain agent |
| F2 | `src/components/medical-records.tsx:60` | description 寫「AI 協助整理為專業建議」誤導 | 初版 |
| F3 | `src/components/medical-records.tsx:62` | placeholder 是通順中文、不符實際破英文輸入 | 初版 |
| **F4** | `src/components/medical-records.tsx:264-290` | **`handlePolishContent` 把整個 `inputContent` 一整塊送 API**，無 section-awareness，S/O 仍會被 AI 動 | frontend agent |
| F5 | `src/components/medical-records.tsx:640-646` | 單一 Textarea 技術上無法讓 S/O 不送 AI | frontend agent |
| F6 | `src/components/medical-records.tsx:754` | refinement 範例指令非藥師情境 | 初版 |
| **F7** | `src/components/medical-records.tsx:645` | 左側 Textarea 無 `font-mono`，貼 lab table 對齊會跑掉 | frontend agent |
| **F8** | `src/components/medical-records.tsx:129-137` | `DraftEntry` 不含 `templateName`，切 recordType 回來 template badge 消失、`templateDirty` 失效 | frontend agent |
| **F9** | — | 無「插入最新 lab / 目前用藥」一鍵帶入，藥師仍要切到 HIS 複製 | frontend agent |
| **F10** | `handleCopy`（L327-333） | 複製後無「已送出」標記，藥師切回來不知有沒有送過 | frontend agent |
| **F11** | — | 無 diff view — 藥師無法快速確認 AI 有沒有偷改劑量/lab 值 | domain agent |

---

## 修改方案（按新優先級）

### P0-A — 後端 `medication_advice` prompt 改寫（含 few-shot + 自檢 + 縮寫表）

**檔案**: `backend/app/llm.py`
**位置**: 替換 L198-201 的 `medication_advice →` 區塊

#### 建議做法：拆 `pharmacist_polish` 獨立 task（推薦）

避免與 `progress_note → Full SOAP`、`nursing_record`、`pharmacy_advice` 互相污染（B7）。

在 `TASK_PROMPTS` 新增：

```python
"pharmacist_polish": (
    "You are a clinical-pharmacy language editor. Your job is to polish a pharmacist's "
    "SOAP-format recommendation into fluent professional English, with STRICT preservation.\n\n"

    "=== INPUT STRUCTURE ===\n"
    "The input JSON contains 'soap_sections' with 4 keys: s, o, a, p. "
    "S and O are pasted verbatim from the hospital information system (HIS). "
    "A and P are the pharmacist's drafts needing polish.\n\n"

    "=== CORE PRESERVATION RULES (HIGHEST PRIORITY) ===\n"
    "1. Lines inside <<<PRESERVE>>>...<<</PRESERVE>>> must be echoed verbatim, "
    "   including typos, Chinese, parentheses, and reference ranges like 'Cr 1.8 (0.6-1.2)'.\n"
    "2. For A and P sections: do NOT add clinical content not in the draft; "
    "   do NOT remove content the user wrote; do NOT compress to a target line count; "
    "   do NOT summarize. Only fix grammar, spelling, and translate Chinese/mixed-language.\n"
    "3. Output sentence count per section must equal input sentence count ±1. "
    "   Before finalizing, count sentences in each input section vs your output. "
    "   If counts differ, revise to match.\n\n"

    "=== PHARMACIST ABBREVIATION LOOKUP (apply in order) ===\n"
    "d/c → discontinue (NEVER 'discharge')\n"
    "sug → suggest\n"
    "d/t → due to\n"
    "bcz / b/c → because\n"
    "f/u → follow up\n"
    "pt → patient\n"
    "fx → function\n"
    "s/p → status post\n"
    "w/ → with, w/o → without\n"
    "q4h PRN → every 4 hours as needed\n"
    "LD → loading dose, MD → maintenance dose\n\n"

    "=== P SECTION FORMAT RULES (apply ONLY to the P section) ===\n"
    "(1) Use bullet points (-).\n"
    "(2) Drug notation — BrandName (Generic, dose/unit) dose frequency.\n"
    "    Oral example: Lasix (Furosemide, 40mg/tab) 1 tab BID\n"
    "    IV drip example: Levophed (Norepinephrine, 4mg/4mL) titrate to MAP ≥65\n"
    "    PRN example: Morphine (Morphine sulfate, 10mg/mL) 2 mg IV q4h PRN pain\n"
    "    Loading+maintenance: Vancomycin 25 mg/kg LD, then 15 mg/kg q12h, adjusted to CrCl\n"
    "    IF brand or generic is missing from source, DO NOT invent — keep what is given.\n"
    "(3) For drug CHANGE recommendations (add / stop / adjust): structure as\n"
    "    brief reason (ONE sentence, ≤20 words: renal impairment / drug interaction / ADE prevention)\n"
    "    → polite request (e.g., 'please consider adjusting / discontinuing / adding ...').\n"
    "    DO NOT expand the reason into multiple sentences.\n"
    "(4) End each plan item with 'Monitor: <items>' — one short line.\n"
    "    IF the original draft has no monitoring content, add a minimal placeholder line "
    "    'Monitor: [AI suggestion — please review]' so the pharmacist sees AI added it.\n\n"

    "=== NEGATIVE CONSTRAINTS ===\n"
    "- Do NOT translate 'd/c' as 'discharge' — it means 'discontinue' in pharmacy context.\n"
    "- Do NOT add rationale the user did not write, except the optional Monitor placeholder above.\n"
    "- Do NOT change numeric values (doses, lab values, frequencies, rates).\n"
    "- Do NOT reorder bullet points in P.\n"
    "- Do NOT translate English to English (leave fluent English as-is).\n\n"

    "=== FEW-SHOT EXAMPLES ===\n"
    "[Good — preserves content, applies format]\n"
    "Draft P: 'pt renal fx not good (CrCl ~20), sug D/C morphine bcz resp depress, "
    "change to fentanyl patch, monitor RR and sedation score'\n"
    "Polished P:\n"
    "- Due to renal impairment (CrCl ~20), please consider discontinuing Morphine "
    "and switching to Fentanyl patch to reduce respiratory depression risk.\n"
    "  Monitor: respiratory rate, sedation score.\n\n"

    "[Bad — violates preservation]\n"
    "Draft A: '根據 IDSA guideline, CRE 感染建議使用 ceftazidime-avibactam 或 meropenem-vaborbactam'\n"
    "WRONG polish (rewrote, added detail): 'Per IDSA guidelines for CRE infection, treatment "
    "options include ceftazidime-avibactam (2.5g q8h) or meropenem-vaborbactam (4g q8h), "
    "both of which demonstrate superior outcomes in registry data...'  ← DO NOT expand.\n"
    "RIGHT polish: 'Per IDSA guideline, ceftazidime-avibactam or meropenem-vaborbactam is "
    "recommended for CRE infection.'  ← only fix grammar, keep scope identical.\n\n"

    "[Good — no drug, no 'please consider']\n"
    "Draft P: 'monitor vanco trough before next dose'\n"
    "Polished P:\n"
    "- Monitor: vancomycin trough level before next dose.\n"
    "(No rationale and no 'please consider' added — the draft was pure monitoring.)\n\n"

    "=== SELF-CHECK (run before outputting) ===\n"
    "Verify:\n"
    "  a. Every drug name, dose, frequency, lab value from input exists in output.\n"
    "  b. Sentence count per section matches input ±1.\n"
    "  c. S and O sections appear verbatim.\n"
    "  d. No English-to-English paraphrasing.\n"
    "If any check fails, revise before emitting.\n\n"

    "=== OUTPUT ===\n"
    "Return JSON with keys: s, o, a, p (matching input structure). Output only the JSON."
),
```

#### 若暫時不拆 task（保守做法）

在 `clinical_polish` 的 `medication_advice →` 子區塊開頭加：
```
IGNORE the progress_note SOAP-filling rule above; this branch is PRESERVATION-FIRST.
```
並把 B1 的 `Concise` / `3–6 lines` / `at most ONE rationale` 整段刪除，同時在下方補入縮寫表、藥物 4 種格式範例、few-shot、self-check（內容同上）。

**驗收**: 跑 P2 階段的 Eval Case 1-9，全數 entity recall=100% 且 sentence count 偏差 ≤1。

---

### P0-B — REFINEMENT MODE 修正（不再吞掉格式規則）

**檔案**: `backend/app/llm.py`
**位置**: L212-218 的 REFINEMENT MODE 整段

**現況問題**（B6）：

```
CRITICAL — REFINEMENT MODE: When the input JSON has '"mode": "REFINEMENT"',
IGNORE all polish/format instructions above. ...
```

這會讓藥師按「再修一次」時，藥師 4 項格式全部消失。

**改寫為**：

```
CRITICAL — REFINEMENT MODE: When the input JSON has '"mode": "REFINEMENT"':
1. Apply 'user_instruction' ON TOP OF the polish_type / pharmacist_polish rules above —
   DO NOT discard them.
2. Take 'previous_polished' as the baseline and modify it per user_instruction.
3. For polish_type=medication_advice or task=pharmacist_polish:
   PRESERVE the P section bullet format, drug notation, polite tone, and Monitor line
   even after refinement — refinement is additive, not a reset.
4. Core preservation rules (no adding/removing clinical content) STILL APPLY.
5. Obey OUTPUT LANGUAGE RULES.
6. Output ONLY the revised text — no preamble.
```

**同時**：`backend/app/routers/clinical.py` L501-511 的 refinement `input_data` 再加一筆 `"format_constraints"`，顯式把藥師 4 項規則當資料傳入，避免 LLM 忘：

```python
if req.polish_type == "medication_advice":
    input_data["format_constraints"] = {
        "section_format": "SOAP",
        "p_rules": [
            "bullet_points",
            "brand_(generic_dose_unit)_dose_frequency",
            "reason_then_please_consider",
            "end_with_Monitor_line",
        ],
        "preservation": "strict",
    }
```

---

### P0-C — 藥師 role 走 4-Textarea 分段 UI（真正解決 S/O 不動）

**檔案**: `src/components/medical-records.tsx`
**位置**: 在 L629 那個 grid 做 role+recordType 分岔 render

#### 架構

```tsx
const isPharmacistSoapMode =
  user?.role === 'pharmacist' && recordType === 'medication-advice';

// 新增 state: 4-section drafts
type SoapDraft = { s: string; o: string; a: string; p: string };
const [soapDraft, setSoapDraft] = useState<SoapDraft>({ s: '', o: '', a: '', p: '' });
const [polishedSoap, setPolishedSoap] = useState<SoapDraft>({ s: '', o: '', a: '', p: '' });

// per-section polish handler
async function handlePolishSection(section: 'a' | 'p') {
  const result = await polishClinicalText({
    patientId,
    task: 'pharmacist_polish',
    soapSections: {
      s: soapDraft.s,                    // verbatim preserve
      o: soapDraft.o,                    // verbatim preserve
      a: section === 'a' ? soapDraft.a : polishedSoap.a || soapDraft.a,
      p: section === 'p' ? soapDraft.p : polishedSoap.p || soapDraft.p,
    },
    targetSection: section,              // only this section is polished
    polishMode: section === 'a' ? 'grammar_only' : 'full',
  });
  setPolishedSoap((prev) => ({ ...prev, [section]: result.polished[section] }));
}
```

#### UI 佈局（藥師模式）

```
┌─ S (Subjective) ────────────────── [灰底 · AI 不會動] ──┐
│ Textarea (font-mono, min-h 80)                       │
└──────────────────────────────────────────────────────┘
┌─ O (Objective) ─────────── [灰底 · AI 不會動] ────────┐
│ [插入最新 Lab ▾] [插入目前用藥 ▾]                    │ ← P1 功能
│ Textarea (font-mono, min-h 120)                      │
└──────────────────────────────────────────────────────┘
┌─ A (Assessment) ────────────── [藍底 · 送 AI 修飾] ──┐
│ Textarea                                             │
│ [AI 修飾 A 段（僅修文法）] 預設 polish_mode=grammar_only │
│ Polished A (可編輯)                                   │
└──────────────────────────────────────────────────────┘
┌─ P (Plan) ────────────────── [藍底 · 送 AI + 藥師格式] ─┐
│ Textarea                                                │
│ [AI 修飾 P 段（套藥師格式）] 預設 polish_mode=full        │
│ Polished P (可編輯)                                      │
└──────────────────────────────────────────────────────────┘
┌─ 最終輸出（自動拼接 S + O + polished_A + polished_P） ──┐
│ [複製貼到 HIS]  [顯示 diff]                          │
└──────────────────────────────────────────────────────┘
```

非藥師 role 或非 medication-advice 時維持原本單一 Textarea（向後相容）。

**draft 擴充**：`DraftEntry` 對藥師 SOAP 模式另存 `soap: SoapDraft | null`：

```ts
type DraftEntry = {
  input: string;
  polished: string;
  polishedFrom: string;
  templateName?: string;        // F8 修正
  soap?: SoapDraft;             // P0-C 新欄位
  polishedSoap?: SoapDraft;
  submittedAt?: number;         // F10 修正
};
```

---

### P1-A — 一鍵插入 Lab / 目前用藥（藥師 O 段省工）

**檔案**: `src/components/medical-records.tsx`
**位置**: O 段 Textarea 上方 toolbar

呼叫既有 hook / API：
- `patient-detail.tsx` 已有 labs / medications 資料流，抽出 utility `formatLabsForPaste(labs)` 與 `formatMedicationsForPaste(meds)` 成純文字
- 下拉選單讓藥師選「最近 6 hr / 24 hr / 全部」lab，直接 insert 到 O 段 cursor 位置
- 保留原始括號參考值、單位、採檢時間

```tsx
<div className="mb-2 flex gap-2">
  <Select onValueChange={insertLab}>
    <SelectTrigger size="sm">插入最新 Lab</SelectTrigger>
    <SelectContent>
      <SelectItem value="6h">最近 6 小時</SelectItem>
      <SelectItem value="24h">最近 24 小時</SelectItem>
      <SelectItem value="all">全部</SelectItem>
    </SelectContent>
  </Select>
  <Button size="sm" variant="outline" onClick={insertMedications}>
    插入目前用藥
  </Button>
</div>
```

---

### P1-B — 藥師 SOAP 模板（含 Allergy、四種藥物格式範例）

**檔案**: `src/components/medical-records.tsx`
**位置**: `BUILTIN_TEMPLATES['medication-advice']` L85-96

```ts
'medication-advice': {
  '藥師 SOAP': {
    // 藥師 SOAP 模式：四段分別預填
    soap: {
      s: '',
      o: 'Dx:\nAllergy:\nLabs:\nCurrent medications:\n',
      a: '',
      p: '1. \n   Monitor:\n2. \n   Monitor:',
    },
  },
  '劑量調整建議': `藥品名稱:\n目前劑量:\n建議調整:\n調整原因:\n監測項目:`,
  '新增藥品建議': `建議藥品:\n適應症:\n建議劑量:\n給藥途徑:\n注意事項:`,
},
```

**模板儲存邏輯**：若當前是藥師 SOAP 模式，`handleApplyTemplate` 改為把 `soap` 物件寫進 `soapDraft` state，而非把字串塞進單一 Textarea。

---

### P1-C — description / placeholder 修正

**檔案**: `src/components/medical-records.tsx`
**位置**: L58-64

```ts
'medication-advice': {
  label: '用藥建議',
  icon: Pill,
  description: '中英夾雜、破英文都 OK，AI 只修文法不增減你寫的內容',
  placeholder: '例：pt renal fx poor, sug D/C morphine d/t resp depress risk, change to fentanyl patch...',
  polishLabel: 'AI 修飾',
},
```

---

### P2-A — refinement chips（append + removable + 藥師 gate）

**檔案**: `src/components/medical-records.tsx`
**位置**: L750-763 refinement panel

```tsx
const PHARMACIST_REFINEMENT_CHIPS = [
  '改成條列式',
  '補禮貌語氣 (please consider...)',
  '結尾加追蹤項目 (Monitor:)',
  '藥物改為 商品名+(學名+劑量)+劑量+頻次',
];

// append 模式
const addChip = (s: string) =>
  setRefinementInstruction((prev) => (prev ? `${prev}; ${s}` : s));

{isPharmacistSoapMode && (
  <div className="flex flex-wrap gap-1.5 pb-1">
    {PHARMACIST_REFINEMENT_CHIPS.map((s) => (
      <Button key={s} size="sm" variant="outline"
        className="h-6 text-[11px]" disabled={isRefining}
        onClick={() => addChip(s)}>{s}</Button>
    ))}
  </div>
)}
```

**移除** 初版草擬的「只改 P 段」chip — 在 P0-C 分段 UI 下每段各自有自己的 polish 按鈕，這個 chip 失去意義。

---

### P2-B — 合併 `polish_mode` enum（避免兩個 IGNORE 互踩）

**檔案**: `backend/app/schemas/clinical.py` `PolishRequest`

```python
polish_mode: Optional[Literal[
    "full",                      # 預設，套完整格式規則
    "grammar_only",              # 只修文法、不動結構（藥師 A 段預設）
    "refinement",                # 再修一次（保留 polish_type 格式）
    "refinement_grammar_only",   # 再修一次、但只修文法
]] = "full"
```

**檔案**: `backend/app/llm.py`
**做法**: 移除現有 REFINEMENT MODE 與 GRAMMAR_ONLY MODE 的兩個 `IGNORE` 區塊，改寫為單一 switch：

```
=== MODE SWITCH (read polish_mode, apply ONE branch) ===
- polish_mode=full: apply polish_type / pharmacist_polish format rules below.
- polish_mode=grammar_only: fix grammar/spelling + translate only; preserve structure
  sentence-by-sentence; ignore format rules but STILL obey preservation rules.
- polish_mode=refinement: baseline=previous_polished; apply user_instruction ON TOP OF
  polish_type format rules; preservation still applies.
- polish_mode=refinement_grammar_only: baseline=previous_polished; apply user_instruction
  but limit to grammar/spelling/translation; no structural changes.
```

兩個 mode 永遠是 `polish_mode` 單一欄位決定，不用兩個 flag 疊加。

---

### P2-C — 前端細節總合

1. **左側 Textarea 加 `font-mono`** — `src/components/medical-records.tsx:645` 加 `font-mono text-sm`
2. **`selectedTemplate` 存進 `DraftEntry`** — L129-137 擴充 type，L260 `handleApplyTemplate` 寫入，L186 切病人時 restore
3. **複製後標記 submittedAt** — L331 `handleCopy` 成功分支加 `updateDraft(recordType, { submittedAt: Date.now() })`
4. **Top bar chip dot 狀態化** — L458-460 amber dot 改成：
   - `submittedAt` 有值 → 綠色（已送）
   - `input.length > 0 && !submittedAt` → 橘色（未送）
   - 均無 → 不顯示
5. **Diff view** — 右側 Polished Card 下方加「顯示 diff」toggle，用 `diff` 套件 highlight 原 vs 修後差異
   - 藥師可快速看 AI 改了哪些字、有無偷改劑量

---

## Eval case（強化 + 量化 rubric）

### Case list（9 條，取代初版 5 條）

| # | 情境 | 關鍵驗證 |
|---|------|---------|
| 1 | 中英夾雜破英文 P 段：`pt renal fx not good (CrCl ~20), sug D/C morphine ...` | 翻譯通順、條列、原因一句、禮貌語氣、Monitor 收尾、所有藥名/劑量保留 |
| 2 | A 段貼 500 字 IDSA guideline 中文 | **零增減**、只改文法、無摘要、無 bullet 化 |
| 3 | 完整 SOAP（S/O 含 HIS 貼文、A guideline、P 3 條建議） | S/O verbatim、A/P 套 P0-A 規則 |
| 4 | 只有 P 段、無 SOAP 結構 | 不強加 SOAP 框架、條列、套藥師格式 |
| 5 | 極短建議（`sug check vanco trough before next dose`） | **不擴寫成 SOAP、不加 rationale、不加 please consider** |
| **6** | Refinement 第二次修飾：先跑 Case 1、再按「再修一次」帶指令「改得更短」 | 藥師 4 項格式**仍在**（不被 REFINEMENT IGNORE 吞掉） |
| **7** | `grammar_only` mode + 中文 guideline | 零增減、僅翻譯 + 文法 |
| **8** | 含 lab 括號參考值：`Cr 1.8 (0.6-1.2), K 5.8 (3.5-5.0)` | 括號與數字**完全保留**、單位保留 |
| **9** | 含破英文縮寫：`pt s/p CABG d/t LM disease, d/c aspirin bcz GIB, f/u H&H q6h` | `d/c→discontinue`（非 discharge）、`s/p`、`d/t`、`bcz`、`f/u` 正確展開 |

### 量化 rubric（自動判定）

每個 case 跑完 polish 後計算：

#### 1. Sentence count preservation
- 輸入每個 section 的句數 vs 輸出每個 section 的句數
- **fail 條件**：差異 > 1

#### 2. Entity preservation（硬指標，必須 100%）

每個 case 標 `expected_entities`：

```yaml
case_1:
  expected_entities:
    drugs: [morphine, fentanyl]
    doses: [CrCl ~20]
    monitors: [RR, respiratory rate, sedation score]
    abbreviations_unresolved: []  # 不該殘留原始縮寫
    abbreviations_resolved: [discontinue, due to]

case_8:
  expected_entities:
    lab_values: ["Cr 1.8 (0.6-1.2)", "K 5.8 (3.5-5.0)"]  # value + reference range as one string
```

**fail 條件**：任一 expected_entity 在輸出中 missing。

#### 3. LLM-as-judge rubric

跑 judge prompt（Claude 或 GPT）對輸出打 4 題 Yes/No：

```
Given INPUT and OUTPUT of a pharmacist-draft polish, answer Yes/No:

Q1. Did the OUTPUT add clinical content (new drugs, new doses, new rationale,
    new guideline citations) that the INPUT did not contain?
Q2. Did the OUTPUT remove or compress content that the INPUT contained
    (e.g., dropped a monitoring item, removed a parenthetical reference range,
    summarized a paragraph)?
Q3. Did the OUTPUT change or reorder the S or O section content vs the INPUT
    (any change beyond fixing a typo)?
Q4. Did the OUTPUT ignore the pharmacist P format rules (bullets, drug notation
    BrandName (Generic, dose/unit) dose frequency, reason→please consider,
    Monitor: line)?

Any 'Yes' → FAIL.
```

每次改 prompt 前跑 9 cases × 3 rubric layers，建立 baseline 分數。目標：Case 1-9 的 pass rate ≥ 95%。

### Judge prompt 檔案位置

建議新增：`backend/tests/evals/pharmacist_polish_judge.md` 存 judge prompt 原文；`backend/tests/evals/pharmacist_polish_cases.yaml` 存 9 case 與 expected_entities。

---

## 開發順序與 To-Do List

### Phase 總覽

| Phase | 天數 | 內容 | 依賴 | 驗收標準 | 狀態 |
|-------|------|------|------|---------|------|
| **0** | 0.5d | 準備 / 蒐集藥師範例 / 分支 | — | branch 建立、3-5 筆真實範例進 evals 目錄 | ✅ DONE (0d51775) |
| **1** | 1d | 後端 prompt + schema + REFINEMENT 修正 | 0 | Case 1-9 baseline 跑完、pass rate 記錄 | ✅ DONE（待 commit） |
| **2** | 0.5d | Eval 框架（cases.yaml + judge + runner） + Phase 1 review carry-over | 1 | `pytest backend/tests/evals/test_pharmacist_polish.py` 可執行 | ✅ 框架完成（live baseline 待 opt-in）|
| **3** | 1.5d | 前端 4-Textarea 分段 UI + DraftEntry 擴充 | 1 | 藥師 role 下 medication-advice 顯示 4 段 + per-section polish | ✅ DONE（部署後 Playwright 驗證中）|
| **4** | 0.5d | 一鍵插入 Lab / 用藥 | 3 | O 段 toolbar 可插入 6h/24h/all lab + current meds | ⬜ |
| **5** | 0.5d | 藥師 SOAP 模板（含 Allergy）+ description / placeholder | 3 | 模板選單出現「藥師 SOAP」、預填 4 段 | ⬜ |
| **6** | 1d | 藥師實測 + 迭代 | 1-5 | 3 位藥師 × 5-10 筆，pass rate ≥ 95%、記錄 fail cases | ⬜ |
| **7** | 1-2d | UX 細節（chips、font-mono、diff、submittedAt、polish_mode enum） | 6 | L258 所列檢查全通過 | ⬜ |

**預估總工時**：6-7 天（1 位全端 + 0.5 位藥師）
**總 Commit 數**：預估 15-20 個 feature commit

---

### Phase 0 — 準備（0.5 day）  · **Status: ✅ DONE (2026-04-17, commit 0d51775)**

- [x] **P0.1** 建 feature branch `feat/pharmacist-soap-polish` ✅ 已切換
- [x] **P0.2** 建立 evals 目錄骨架 ✅
  - `backend/tests/evals/pharmacist_samples/`（含 README）
  - `backend/tests/evals/reports/`
  - `backend/tests/evals/pharmacist_polish_cases.yaml`（9 個 seed case）
  - `backend/tests/evals/pharmacist_polish_judge.md`（4 題 Yes/No judge prompt）
- [x] **P0.3** 備份現有 prompt baseline（對照用）✅
  - `backend/tests/evals/baseline_prompt_v1.txt`（複製自 `backend/app/llm.py` L184-219）
- [ ] **P0.4** 蒐集藥師真實範例 ⏸ **Blocked — 待使用者提供附件**
  - 目前 `pharmacist_polish_cases.yaml` 中 9 個 case 皆為 `status: seed`（合成樣本）
  - 藥師真實範例進來後替換為 `status: real`
  - 目標：3-5 筆含 S/O HIS 貼文、A guideline、P 3-5 條建議
  - 每筆含藥師手寫「理想版」作為 ground truth
- [x] **P0.5** 確認 scope 規則（本輪不動）✅
  - 其他 recordType（progress-note、nursing-record）行為不變
  - 非藥師 role 的 medication-advice 行為不變
  - `clinical_polish` task 的其他分支（progress_note、nursing_record、pharmacy_advice）不變
  - 本會話採「全端 session」解釋（跨 backend/src 皆可修改）
- [x] **P0.6** 首次 commit ✅ `0d51775`
  - 6 files, +1280 lines
  - pre-commit hooks（secrets、large files、merge conflicts、private key、main-branch block）全通過

---

### Phase 1 — 後端 prompt + schema + REFINEMENT 修正（1 day） · **Status: ✅ DONE (2026-04-17)**

實作摘要：schema 擴充、`pharmacist_polish` 新 task、REFINEMENT MODE 合併為單一 MODE SWITCH、router 支援 pharmacist_polish 路由並解析 JSON `{s,o,a,p}` 回傳。54 個既有 clinical 測試全數通過，無回歸。

#### 1A. Schema 擴充

- [x] **P1.1** 修改 `backend/app/schemas/clinical.py` 的 `PolishRequest` ✅
  - `content` 放寬為 `Field("", max_length=10000)`（允許空，讓 pharmacist_polish 用 soap_sections）
  - 新增 `task: Optional[Literal["clinical_polish","pharmacist_polish"]] = "clinical_polish"`
  - 新增 `polish_mode: Optional[Literal["full","grammar_only","refinement"]] = "full"`（合併為 3 分支，移除 `refinement_grammar_only` 以降低 LLM 分支複雜度）
  - 新增 `soap_sections: Optional[Dict[str, str]] = None`
  - 新增 `target_section: Optional[Literal["a","p","a_and_p","all"]] = None`
  - 新增 `format_constraints: Optional[Dict[str, Any]] = None`
  - Typing 導入更新：`Any, Dict, Literal` 全數加入

#### 1B. 新增 `pharmacist_polish` task

- [x] **P1.2** 在 `backend/app/llm.py` 的 `TASK_PROMPTS` 新增 `pharmacist_polish` ✅（長度 6254 字元）
  - 區塊順序：TOP PRIORITY PRESERVATION → ABBREVIATION TABLE → A-SECTION RULES → P-SECTION FORMAT RULES（含 4 種藥物格式範例：oral / IV / vanco LD+MD / noradrenaline drip）→ 3 組 FEW-SHOT EXAMPLES → MODE SWITCH → TARGET SECTION → SELF-CHECK（7 點靜默檢查）→ NEGATIVE CONSTRAINTS → OUTPUT FORMAT（JSON `{s,o,a,p}`）
  - 縮寫表涵蓋：d/c（強調 NEVER 'discharge'）、s/p、d/t、bcz、f/u、sug、pt、c/o、RR、H&H、OB、NKDA、CrCl、resp depress
- [x] **P1.3** `call_llm` 的 task routing：現有邏輯 `if task not in TASK_PROMPTS: raise` 為白名單制，已自動支援新 entry ✅

#### 1C. 修 REFINEMENT MODE

- [x] **P1.4** 改寫 `backend/app/llm.py` 原 L212-218 ✅
  - 移除原 `IGNORE all polish/format instructions above`
  - 新規則：`polish_type` 格式規則必須仍被遵守；使用者說「改短/改簡潔」時僅能調整措辭，不得移除 bullet / drug notation / monitor line / section structure

#### 1D. Mode switch 合併

- [x] **P1.5** 移除原 IGNORE 分支 ✅
- [x] **P1.6** 新增單一 `=== MODE SWITCH ===` 區塊（3 分支：full / grammar_only / refinement）✅
  - GRAMMAR_ONLY：zero content delta，僅修文法、翻譯；不套 polish_type 格式
  - REFINEMENT：baseline = `previous_polished`；必須保留格式規則
  - FULL（預設）：套完整 polish_type 規則
- [x] **P1.7** 驗證 mode 邏輯已以 prompt 內文明確聲明三分支職責；自動化驗證延至 Phase 2 的 eval runner

#### 1E. Router 整合

- [x] **P1.8** 修改 `backend/app/routers/clinical.py` `polish_clinical_text` ✅
  - 新增 `is_pharmacist = task_name == "pharmacist_polish"` 分支
  - `input_data` 帶入 `polish_mode`、`soap_sections`（預設 4 空字串）、`target_section`（預設 `a_and_p`）、`format_constraints`
  - Refinement 分支：當 `polish_mode == "refinement"` 或同時傳 `instruction + previous_polished` 時觸發
  - `call_llm` 改以動態 `task=task_name` 傳入
  - 回傳新增 `polished_sections: {s,o,a,p}`（經 `_try_parse_soap_json` 解析，失敗時不附）
  - 新增 helper `_try_parse_soap_json`（處理 markdown fence、缺鍵 fallback）
  - Audit log 新增 `task`、`polish_mode`、`target_section`

#### 1F. 煙霧測試

- [x] **P1.9** Python import + schema round-trip + JSON parser 三案例通過 ✅
  - 驗證 `pharmacist_polish` 已註冊進 TASK_PROMPTS
  - `PolishRequest(task='pharmacist_polish', polish_mode='full', soap_sections={...}, target_section='p')` 構造成功
  - Parser 驗證：純 JSON / ```json fence / 非 JSON / 缺鍵 四種輸入皆正確處理
  - `pytest tests/ -k clinical` 54 passed, 0 failed（無回歸）
- [x] **P1.11** （Phase 1 末追加）Schema mutual-exclusion validator ✅
  - `PolishRequest.@model_validator(mode='after')`：拒絕 `content + soap_sections + (previous_polished+instruction)` 三者皆空的呼叫
  - 修補 review agent 發現的 regression：原本 `content=""` 放寬後，舊客戶端若漏帶欄位會進 LLM 生垃圾
  - 驗證：4 組 case（空 / content / soap / refinement）全部行為正確；24 個既有測試全通過
- [ ] **P1.10** Commit 待 user 指示（feature branch 已在 `feat/pharmacist-soap-polish`，commit 訊息草稿見下）

---

### Phase 2 — Eval 框架（0.5 day） · **Status: 🟨 框架完成，live baseline 待用戶 opt-in**

- [x] **P2.1** `backend/tests/evals/pharmacist_polish_cases.yaml` 9 seed cases ✅（Phase 0 已完成）
- [x] **P2.2** `backend/tests/evals/pharmacist_polish_judge.md` 4-題 Yes/No rubric ✅（Phase 0 已完成）
- [x] **P2.3** Runner：拆成兩個檔 ✅
  - `backend/tests/evals/pharmacist_polish_runner.py`：純邏輯（sentence count / entity recall with synonyms / report render），無 LLM 依賴
  - `backend/tests/evals/test_pharmacist_polish.py`：pytest 入口，hermetic 子集一律跑（16 tests），live 子集需 `RUN_PHARMACIST_POLISH_EVALS=1 + OPENAI_API_KEY`
  - 計算三層分數（(a) sentence count ≤1 tolerance、(b) entity recall ≥1.0、(c) LLM-as-judge 尚未接，先記 "not-run"）
  - 輸出 Markdown 報告 `backend/tests/evals/reports/{timestamp}.md`
- [ ] **P2.4** 執行 live baseline run（需用戶提供 OPENAI_API_KEY 或在 Railway 環境跑）
  ```bash
  RUN_PHARMACIST_POLISH_EVALS=1 cd backend && python3 -m pytest tests/evals/test_pharmacist_polish.py -v -s
  ```
- [ ] **P2.5** 將 baseline 分數（Case 1-9 pass/fail）記錄到 docs/（待 P2.4 完成）
- [x] **P2.6** Commit 待合併（下列 Phase 2 全部一起 commit）

#### Phase 1 review carry-over（從 Phase 1 review agent 回報）

**MUST-FIX（在 Phase 2 內完成）：**
- [x] ~~P2.7 Schema validator：拒絕 `content="" AND soap_sections=None`~~ ✅ 已在 Phase 1 末補上（P1.11，`PolishRequest.@model_validator`）
- [x] **P2.8** Unit test：pharmacist refinement 路由保留 `previous_polished + user_instruction` ✅（`test_pharmacist_refinement_passes_previous_polished_to_llm`；mock 回傳含 bullets + Monitor 的 P 並斷言 response 仍含格式標記）
- [x] **P2.9** Unit test：`_try_parse_soap_json` 9 條邊界 ✅（fenced / unlabeled fence / partial keys / non-string value / plain prose / empty / whitespace / malformed / array）
- [x] **P2.10** Router 回傳 `polished_sections` 實測 ✅（`test_pharmacist_polish_populates_polished_sections`：當 LLM 回 JSON，S/O 欄位 byte-equivalent；degrade 測試：`test_pharmacist_polish_degrades_when_llm_returns_prose`）
- [x] **P2.11** Regression test：legacy `clinical_polish` refinement 進 REFINEMENT branch 並保留 `polish_type=progress_note` ✅（`test_legacy_refinement_routes_to_clinical_polish`）

**NICE-TO-HAVE（本輪處理）：**
- [x] **P2.12** 回傳 `metadata.parse_ok: boolean` ✅（router 對 pharmacist_polish 產出時設定，前端可據此顯示「格式未分段」警告）
- [x] **P2.13** Few-shot example 3 補全 drug notation ✅（`Bokey (Aspirin, 100 mg/tab)`、`Losec (Omeprazole, 40 mg/vial)` 完整示範）
- [ ] **P2.14** `soap_sections` 每個 value 加 `max_length`（延至 Phase 6 UAT 再評估 — 目前合計上限受 `content` 10000 char 與 Pydantic 預設保護）
- [ ] **P2.15** Audit log 加 `sha256(content + soap_sections)` 供 repro（延至 Phase 6；先用 audit log 現有欄位觀察）
- [ ] **P2.16** 分段 guardrail（延至 Phase 6；現有 guardrail 對 JSON 字串跑仍可抓出主要風險）

**Phase 2 測試彙總**：
- Hermetic tests：`tests/test_api/test_pharmacist_polish.py` 18 cases + `tests/evals/test_pharmacist_polish.py` 16 cases = **34 cases 全數通過**
- Live eval suite：9 parametrized cases（skip 預設），需 `RUN_PHARMACIST_POLISH_EVALS=1 + OPENAI_API_KEY` opt-in
- 既有 clinical tests：42 cases 未回歸

---

### Phase 3 — 前端 4-Textarea 分段 UI（1.5 day） · **Status: ✅ DONE (2026-04-17)**

**完成摘要**
- `src/lib/api/ai.ts`：新增 `PolishTask` / `PolishMode` / `SoapSection` / `TargetSection` / `SoapSections`；`polishClinicalText` 加 `task`、`soapSections`、`targetSection`、`polishMode` 參數並做 snake_case 轉換；`PolishResponse` 擴充 `polished_sections` + `metadata.parse_ok`
- `src/components/pharmacist-soap-editor.tsx`（新檔）：4 張 Card（S/O 灰底「AI 不會動這段」、A/P 天藍「送 AI」），A 段預設 `grammar_only`、P 段預設 `full` 並有「只修文法」次按鈕；per-section refinement 面板（⌘/Ctrl+Enter 送出）；最終輸出 Card 自動拼接 `[polishedSoap.x || soap.x].filter(…).join('\n\n')` + 複製到 HIS 按鈕
- `src/components/medical-records.tsx`：`DraftEntry` 加 `soap` / `polishedSoap` / `submittedAt`；`mergeDraft` helper 讓舊 localStorage 草稿向後相容；新增 `isPharmacistSoapMode = user?.role === 'pharmacist' && recordType === 'medication-advice'`；L629 加條件 render 切換
- `npm run build` 通過、`tsc --noEmit` 無錯誤
- Playwright 部署後驗證：詳見 P3.12 小節


#### 3A. 型別與 state 擴充

- [x] **P3.1** 修改 `src/components/medical-records.tsx` L129-137 `DraftEntry` 型別
  ```ts
  type SoapDraft = { s: string; o: string; a: string; p: string };
  type DraftEntry = {
    input: string;
    polished: string;
    polishedFrom: string;
    templateName?: string;
    soap?: SoapDraft;
    polishedSoap?: SoapDraft;
    submittedAt?: number;
  };
  ```
- [x] **P3.2** 更新 `loadDrafts` / `saveDrafts` 相容舊 localStorage 資料（缺欄位用 default）
- [x] **P3.3** 新增 helper `isPharmacistSoapMode = user?.role === 'pharmacist' && recordType === 'medication-advice'`

#### 3B. API client 擴充

- [x] **P3.4** 修改 `src/lib/api/ai.ts` 的 `polishClinicalText`
  - 加可選參數 `task?: 'clinical_polish' | 'pharmacist_polish'`
  - 加可選 `soapSections`、`targetSection`、`polishMode`
  - snake_case 轉換 送後端

#### 3C. 新元件 `PharmacistSoapEditor`

- [x] **P3.5** 新增 `src/components/pharmacist-soap-editor.tsx`
  - 4 個 Card：S / O / A / P
  - S、O：灰底 + 標籤「AI 不會動」、`font-mono`、min-h 80-120
  - A、P：藍底 + 標籤「送 AI」、各自的 polish 按鈕
  - 各段獨立 `polishedSoap[section]` state
  - A 段 polish 按鈕預設 `polishMode='grammar_only'`
  - P 段 polish 按鈕預設 `polishMode='full'`
  - 每段下方顯示該段 polished 結果（Textarea，可編輯）
- [x] **P3.6** 最終輸出區
  - 自動拼接：`{s}\n\n{o}\n\n{polishedA || a}\n\n{polishedP || p}`
  - 「複製貼到 HIS」按鈕 + 「顯示 diff」toggle（diff 放 P7 做）
  - 複製成功寫 `submittedAt = Date.now()`
- [x] **P3.7** 「再修一次」對 A/P 各自有 refinement panel（`polish_mode='refinement'`）
- [x] **P3.8** 草稿自動存：任一段 change 都 `saveDrafts`（patient+type+soap）

#### 3D. 整合到 `MedicalRecords`

- [x] **P3.9** `src/components/medical-records.tsx` L629 grid 前加 gate
  ```tsx
  if (isPharmacistSoapMode) {
    return <PharmacistSoapEditor {...props} />;
  }
  // 原本單 Textarea 渲染
  ```
- [x] **P3.10** 其他 role / recordType 維持原樣（向後相容驗證）

#### 3E. 驗證

- [x] **P3.11** 前端 `npm run build` 通過、TypeScript 無錯（12.44s, 2682 modules, no TS error）
- [x] **P3.12** Playwright MCP 部署後驗證（2026-04-17, Vercel bundle `patient-detail-6eWKsXnd.js`）
  - 藥師 `陳佩君 (A3266@tpech.gov.tw, role=pharmacist)` → 病歷記錄 tab → 用藥建議 → 渲染 5 張 Card（S/O「AI 不會動這段」灰底、A/P「送 AI」天藍、最終輸出），所有 `pharmacist-soap-*` data-testid 存在
  - 切到 Progress Note → SOAP test-id 全部消失，回到舊「你的草稿 | AI 修飾後」2-column UI（`isPharmacistSoapMode` gate 正確切換）
  - Polish API smoke test：input `sug add meropenem 1g IV q8h d/t CRE pneumonia. monitor: renal fx, CRP.` →
    - `POST /api/v1/clinical/polish` 200，payload 正確攜帶 `task: "pharmacist_polish"`、`target_section: "p"`、`soap_sections.p` 原文
    - 輸出：`- Due to CRE pneumonia, please consider adding Meropenem 1 g IV q8h.\n  Monitor: renal function, CRP.`（bullet、`d/t→Due to`、`sug→please consider`、藥名首字母大寫、單位空格、Monitor 標籤皆到位）
  - 螢幕截圖：`phase3-pharmacist-4textarea-verified.png`
- [x] **P3.13** Commit + push 完成（commit `c86a178`，pushed to `railway` remote → Vercel 已部署並驗證）
- [ ] **P3.12** 本地起 dev server 手測：
  - 登入藥師 → 進 patient-detail → 病例紀錄 → 用藥建議 → 看到 4-Textarea
  - 登入醫師 → 同路徑 → 看到原單 Textarea
  - 切換病人 → soapDraft 正確 reload
- [ ] **P3.13** Commit：
  ```
  feat(medical-records): add pharmacist SOAP split editor with per-section polish
  ```

---

### Phase 4 — 一鍵插入 Lab / 目前用藥（0.5 day）— ✅ DONE 2026-04-17

- [x] **P4.1** 抽 utility `src/lib/clinical/format-for-paste.ts`
  - `formatLabsForPaste(labs, window: '6h' | '24h' | 'all')` → 純文字多行
  - `formatMedicationsForPaste(meds)` → 純文字多行（品名 / 學名 / 劑量 / 頻次 / PRN）
  - 保留括號參考值、單位、採檢時間；異常值加 `*`
- [x] **P4.2** 透過 `labData` + 扁平化 `allMedications` prop 從 `patient-detail.tsx` → `MedicalRecords` → `PharmacistSoapEditor`
- [x] **P4.3** 在 `PharmacistSoapEditor` 的 O 段加 toolbar：
  - `<select data-testid="pharmacist-soap-lab-window">` (6h / 24h / 全部)
  - 兩顆 `Button`：插入 Labs、插入用藥（lucide `FlaskConical` / `Syringe` icon）
  - 使用 `useRef<HTMLTextAreaElement>` + `selectionStart` 在 cursor 位置插入；自動補 `\n` 分隔
- [x] **P4.4** Playwright 驗證（Vercel production `index-juUCLaNM.js`）：
  1. 以藥師 `陳佩君 (A3266@tpech.gov.tw, role=pharmacist)` 登入
  2. 病人 `pat_f09355f8 (楊梅鳳)` → 病歷記錄 → 用藥建議
  3. 所有 5 個 data-testid 存在：`pharmacist-soap-insert-toolbar / -lab-window / -insert-labs / -insert-meds / -input-o`
  4. 點擊 `插入 Labs`（window=24h）→ 最新 labs 為 2026-04-13 > 24h，正確輸出 fallback `Labs: 近 24h 無更新（最後一筆 2026-04-13 06:18）`
  5. 切換 window=all → 點 `插入 Labs`：3971 chars，含 header `Labs (2026-04-13 06:18):` + 11 類（生化 / 血液 / ABG / VBG / 發炎 / 凝血 / 心臟 / 荷爾蒙 / 其他等），括號參考值 + 單位 + 異常 `*` 都保留（例：`ALT 4 U/L (7-42 *)`、`K 3.9 mEq/L (3.5-5.1)`）
  6. focus O textarea → `selectionStart=length` → 點 `插入用藥`：總長 5228 chars，含 `Current meds:` header + 19 用藥（例：`- Acetal 500mg tab(Acetaminophen) (Acetal) 1.0 tab PO q6h PRN`）
  - 修正 hook order bug（P4 部署初期出現 React #310；`allMedications` 的 `useMemo` 被放在 `patientLoading` early return 之後）— commit `29ac75c`
- [x] **P4.5** Commit `d09bc1b feat(medical-records): Phase 4 — one-click insert labs/meds into O section`

---

### Phase 5 — 藥師 SOAP 模板（含 Allergy）+ description / placeholder（0.5 day）

- [ ] **P5.1** `src/components/medical-records.tsx` L58-64 改 `medication-advice` config 的 description / placeholder（內容見「P1-C」）
- [ ] **P5.2** L85-96 `BUILTIN_TEMPLATES['medication-advice']` 加「藥師 SOAP」模板
  - 結構：`{ soap: { s, o, a, p } }`（與字串模板混用需 schema 標記）
  - O 段預填 `Dx:\nAllergy:\nLabs:\nCurrent medications:\n`
- [ ] **P5.3** `handleApplyTemplate` L256-262 分岔：
  - 若 template 有 `soap` 欄位且 `isPharmacistSoapMode` → 寫入 `soapDraft` state
  - 否則走原路（寫入 `inputContent`）
- [ ] **P5.4** 手測：套用「藥師 SOAP」→ 4 段正確預填；套用舊「劑量調整建議」→ 若在藥師模式下給一個合理 fallback（建議塞 P 段）
- [ ] **P5.5** Commit：
  ```
  feat(medical-records): add pharmacist SOAP template and update prompts
  ```

---

### Phase 6 — 藥師實測 + 迭代（1 day）

- [ ] **P6.1** 部署到 staging（或本地 demo）
- [ ] **P6.2** 找 3 位藥師各跑 5-10 筆真實建議（合計 15-30 筆）
- [ ] **P6.3** 紀錄表（建議 `docs/evals/pharmacist-uat-YYYY-MM-DD.md`）：
  - 每筆輸入 / polished 輸出 / 藥師滿意度（1-5）/ 具體 fail 原因
- [ ] **P6.4** 對 fail cases 分類：
  - A. prompt 問題（加 few-shot / 改規則） → 進 P6.5
  - B. UX 問題（按鈕不好按、流程卡） → 進 P7
  - C. 超範圍（需要新功能，不在本輪） → 建新 issue
- [ ] **P6.5** Prompt 迭代（最多 2 輪，每輪跑全 eval suite）
  - 目標：Case 1-9 pass rate ≥ 95%、藥師滿意度平均 ≥ 4/5
- [ ] **P6.6** Commit（每輪迭代）：
  ```
  fix(pharmacist-polish): iterate prompt based on UAT feedback (round N)
  ```

---

### Phase 7 — UX 細節收尾（1-2 day）

- [ ] **P7.1** 左側 Textarea 加 `font-mono text-sm`（`src/components/medical-records.tsx:645`）— 單 Textarea 模式適用（分段模式已在 P3 處理）
- [ ] **P7.2** Refinement chips append 模式（`src/components/medical-records.tsx:750-763`）
  - 改為 `setRefinementInstruction((prev) => prev ? \`${prev}; ${s}\` : s)`
  - 加 藥師 gate (`isPharmacistSoapMode` 才顯示 chip 列)
  - 加 `<Badge>` 顯示已選條件、X 可移除單條
  - 移除「只改 P 段」chip（分段模式下無意義）
- [ ] **P7.3** Top bar chip dot 狀態化（L458-460）
  - `submittedAt` 有值 → 綠 dot
  - `input.length > 0 && !submittedAt` → 橘 dot
  - 均無 → 不顯示
  - 加 tooltip 說明
- [ ] **P7.4** Diff view（右側 Polished Card 下方）
  - 裝 `diff` 套件：`npm i diff`
  - Toggle「顯示 diff」，點擊後以顏色 highlight 原 vs 修後差異
  - 針對藥師模式：對 A/P 各有一個 diff 區塊
- [ ] **P7.5** localStorage 向後相容測試：用舊 `chaticu-draft-*` 資料（無 `soap` 欄位）開啟藥師模式，確認不 crash
- [ ] **P7.6** 部署驗證清單（按 CLAUDE.md 規範）
  - `git push personal main`（Railway 後端）
  - `git push railway main`（Vercel 前端）
  - `curl -s https://chaticu-production-8060.up.railway.app/health` 確認 healthy
  - 確認 Vercel bundle hash 更新
  - 以 Playwright / 瀏覽器登入測藥師流程
- [ ] **P7.7** 最終 commit：
  ```
  polish(medical-records): UX refinements (diff view, chip states, font-mono, append chips)
  ```

---

### 跨 Phase 驗收檢查清單

實測前必跑：

- [ ] `cd backend && python3 -m pytest tests/ -v --tb=short` 全綠
- [ ] `cd backend && python3 -m pytest tests/evals/test_pharmacist_polish.py -v` 9 case ≥ 8 pass
- [ ] `npm run build` 無 TypeScript 錯誤
- [ ] `npm run lint` 無新增 warning
- [ ] 手動走：藥師登入 → 病例紀錄 → 用藥建議 → 4 段 UI 出現 → O 段插入 lab → A 段 polish（grammar_only）→ P 段 polish（full）→ refinement → 複製 → 切病人回來草稿還在

---

### 回滾計畫

若 Phase 6 UAT 顯示藥師強烈不適應分段 UI：

- [ ] 加 feature flag `VITE_PHARMACIST_SOAP_EDITOR=on|off`
- [ ] 預設 on、若 UAT 失敗改 off → 藥師看到單 Textarea（舊行為 + P0-A 的新 prompt 改動仍保留）
- [ ] 後端 prompt 改動不 roll back（與舊 UI 相容）

---

## 風險與後續監控

| 風險 | 監控方式 | 備案 |
|------|---------|------|
| P0-A prompt 改完 entity recall 仍 < 100% | 自動跑 case 1-9，比對 expected_entities | 加 few-shot 範例、加 delimiter `<<<PRESERVE>>>`、改走 P2 grammar_only 路線 |
| P0-C 分段 UI 藥師不習慣 | 後續回饋、使用頻率監測 | 加 toggle「切回單一 Textarea 模式」 |
| Refinement 後 format 仍掉 | Case 6 回歸測試每次 prompt 改動都跑 | 在 refinement `input_data.format_constraints` 明列規則 |
| `d/c` 被誤譯為 discharge | Case 9 + LLM judge Q1 | Prompt 頂部明示 negative constraint；若仍翻錯，強制 post-process replace |

---

## 一句話總結

初版 `.md` 靠「單 Textarea + prompt 指令」想解決藥師需求，但三方獨立評審一致指出：**S/O 不被動要靠分段 UI（非 prompt）、AI 不增減要靠 few-shot + self-check（非 DO NOT）、REFINEMENT 不吞格式要改 MODE 寫法（非 IGNORE）**。強化版把 P3 分段 UI 提到 P0、加一鍵帶 lab/藥、補縮寫表與 few-shot、重寫 REFINEMENT MODE、加量化 rubric，才是能真正落地的版本。
