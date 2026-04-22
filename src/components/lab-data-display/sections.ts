/**
 * Section configuration and pure grouping helper for the lab-data display.
 *
 * Extracted as Step 1 of the lab-display refactor (see
 * `docs/lab-display-refactor-plan.md`). This module is intentionally pure —
 * no React / JSX — so it can be unit-tested independently and consumed by
 * the refactored `<LabDataDisplay />` in a later step.
 */

import { type LabData } from '../../lib/api';

// ---------------------------------------------------------------------------
// 2.2 Section definition (UI layer)
// ---------------------------------------------------------------------------

export type SectionId =
  | 'electrolytes'    // 電解質
  | 'hematology'      // 血液學檢查
  | 'inflammatory'    // 發炎指標
  | 'abg'             // 動脈血氣體分析
  | 'vbg'             // 靜脈血氣體分析
  | 'liverRenal'      // 肝腎功能
  | 'coagulation'     // 凝血功能
  | 'biochemExtra'    // 其他生化 (Glucose/Uric/HbA1C ...)
  | 'endocrine'       // 內分泌 (TSH/freeT4/Cortisol/ACTH)
  | 'cardiac'         // 心臟
  | 'lipid'           // 脂質
  | 'other';          // 其他檢驗 (含 U_ / ST_ / PF_ / misc 子分組)

export const SECTION_ORDER: SectionId[] = [
  'electrolytes',
  'hematology',
  'inflammatory',
  'abg',
  'vbg',
  'liverRenal',
  'coagulation',
  'biochemExtra',
  'endocrine',
  'cardiac',
  'lipid',
  'other',
];

/**
 * Rich section metadata: title + optional subtitle/variant.
 *
 * `variant === 'optional'` flags the section as "selectively tracked":
 *   - header is rendered in amber (text-[#f59e0b]) instead of text-brand
 *   - all items inside render with `isOptional` (amber card styling)
 *
 * This replaces the old practice of inferring `isOptional` from
 * `pinned && value === undefined`, which conflated two orthogonal concerns:
 *   - `pinned`     = always reserve the slot (render card even when value missing)
 *   - `isOptional` = visual "selectively tracked" hint (section-level only)
 */
export interface SectionMeta {
  title: string;
  subtitle?: string;
  variant?: 'default' | 'optional';
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  electrolytes: { title: '電解質與礦物質' },
  hematology:   { title: '血液學檢查' },
  inflammatory: { title: '發炎指標' },
  abg:          { title: '動脈血氣體分析' },
  vbg:          { title: '靜脈血氣體分析' },
  liverRenal:   { title: '肝腎功能' },
  coagulation:  { title: '凝血功能' },
  biochemExtra: { title: '其他生化' },
  endocrine:    { title: '內分泌', subtitle: '（選擇性追蹤）', variant: 'optional' },
  cardiac:      { title: '心臟酵素' },
  lipid:        { title: '脂質' },
  other:        { title: '其他檢驗' },
};

// Back-compat: derived from SECTION_META so legacy imports keep working.
export const SECTION_TITLE: Record<SectionId, string> =
  Object.fromEntries(
    (Object.entries(SECTION_META) as [SectionId, SectionMeta][]).map(
      ([k, v]) => [k, v.title],
    ),
  ) as Record<SectionId, string>;

// ---------------------------------------------------------------------------
// 2.3 Category → Section default mapping
// ---------------------------------------------------------------------------

export const CATEGORY_DEFAULT_SECTION: Record<string, SectionId> = {
  hematology:     'hematology',
  bloodGas:       'abg',
  venousBloodGas: 'vbg',
  inflammatory:   'inflammatory',
  coagulation:    'coagulation',
  cardiac:        'cardiac',
  thyroid:        'endocrine',
  hormone:        'endocrine',
  lipid:          'lipid',
  biochemistry:   'biochemExtra', // default; overridden per item
  other:          'other',        // 含 U_ / ST_ / PF_ / 折入的 serology/tdm
};

// ---------------------------------------------------------------------------
// 2.4 Item override table (second layer — only for keys needing fine-tuning)
// ---------------------------------------------------------------------------

export interface ItemOverride {
  section?: SectionId; // override target section
  order?: number;      // within-section order (smaller = earlier)
  label?: string;      // display label (default = itemName)
  unit?: string;       // fallback unit
  pinned?: boolean;    // render card even when value missing
}

export const ITEM_OVERRIDE: Record<string, ItemOverride> = {
  // ── 電解質 ───────────────────────────────
  'biochemistry:Na':       { section: 'electrolytes', order: 1, unit: 'mmol/L', pinned: true },
  'biochemistry:K':        { section: 'electrolytes', order: 2, unit: 'mmol/L', pinned: true },
  'biochemistry:Ca':       { section: 'electrolytes', order: 3, unit: 'mg/dL' },
  'biochemistry:freeCa':   { section: 'electrolytes', order: 4, unit: 'mmol/L' },
  'biochemistry:Mg':       { section: 'electrolytes', order: 5, unit: 'mg/dL' },
  'biochemistry:Cl':       { section: 'electrolytes', order: 6, unit: 'mmol/L' },
  'biochemistry:Phos':     { section: 'electrolytes', order: 7, unit: 'mg/dL' },

  // ── 肝腎功能 ──────────────────────────────
  'biochemistry:AST':      { section: 'liverRenal', order: 1, unit: 'U/L' },
  'biochemistry:ALT':      { section: 'liverRenal', order: 2, unit: 'U/L' },
  'biochemistry:TBil':     { section: 'liverRenal', order: 3, unit: 'mg/dL' },
  'biochemistry:DBil':     { section: 'liverRenal', order: 4, unit: 'mg/dL' },
  'biochemistry:AlkP':     { section: 'liverRenal', order: 5, unit: 'U/L' },
  'biochemistry:rGT':      { section: 'liverRenal', order: 6, unit: 'U/L' },
  'biochemistry:BUN':      { section: 'liverRenal', order: 7, unit: 'mg/dL', pinned: true },
  'biochemistry:Scr':      { section: 'liverRenal', order: 8, unit: 'mg/dL', pinned: true },
  'biochemistry:eGFR':     { section: 'liverRenal', order: 9, unit: 'mL/min' },
  'biochemistry:Clcr':     { section: 'liverRenal', order: 10, unit: 'mL/min' },

  // ── 發炎 (biochemistry 入發炎) ────────────
  'biochemistry:Alb':      { section: 'inflammatory', order: 1, unit: 'g/dL' },
  'biochemistry:Ferritin': { section: 'inflammatory', order: 10, unit: 'ng/mL' },
  'biochemistry:LDH':      { section: 'inflammatory', order: 11, unit: 'U/L' },
  'bloodGas:Lactate':      { section: 'inflammatory', order: 2, unit: 'mmol/L' },

  // ── 其他生化 (Glucose/Uric/HbA1C) ─────────
  'biochemistry:Glucose':  { section: 'biochemExtra', order: 1, unit: 'mg/dL' },
  'biochemistry:Uric':     { section: 'biochemExtra', order: 2, unit: 'mg/dL' },
  'other:HbA1C':           { section: 'biochemExtra', order: 3, unit: '%' },
  'other:NH3':             { section: 'biochemExtra', order: 4, unit: 'μg/dL' },
  'other:Amylase':         { section: 'biochemExtra', order: 5, unit: 'U/L' },
  'other:Lipase':          { section: 'biochemExtra', order: 6, unit: 'U/L' },

  // ── 內分泌排序 ────────────────────────────
  'thyroid:TSH':           { section: 'endocrine', order: 1 },
  'thyroid:freeT4':        { section: 'endocrine', order: 2 },
  'hormone:Cortisol':      { section: 'endocrine', order: 3 },
  'hormone:ACTH':          { section: 'endocrine', order: 4 },

  // ── 血液學排序（常用 pinned 在前） ────────
  'hematology:WBC':        { section: 'hematology', order: 1, pinned: true },
  'hematology:Hb':         { section: 'hematology', order: 2, pinned: true },
  'hematology:Hct':        { section: 'hematology', order: 3 },
  'hematology:PLT':        { section: 'hematology', order: 4, pinned: true },
  'hematology:RBC':        { section: 'hematology', order: 5 },
  'hematology:MCV':        { section: 'hematology', order: 10 },
  'hematology:MCH':        { section: 'hematology', order: 11 },
  'hematology:MCHC':       { section: 'hematology', order: 12 },
  'hematology:RDW_CV':     { section: 'hematology', order: 13 },
  'hematology:RDW_SD':     { section: 'hematology', order: 14 },
  'hematology:Segment':    { section: 'hematology', order: 20 },
  'hematology:Lymph':      { section: 'hematology', order: 21 },
  'hematology:Mono':       { section: 'hematology', order: 22 },
  'hematology:Eos':        { section: 'hematology', order: 23 },
  'hematology:Baso':       { section: 'hematology', order: 24 },
  'hematology:Band':       { section: 'hematology', order: 25 },
  'hematology:Myelo':      { section: 'hematology', order: 26 },
  'hematology:NRBC':       { section: 'hematology', order: 27 },
};

// ---------------------------------------------------------------------------
// 2.5 Grouping function
// ---------------------------------------------------------------------------

export interface RenderItem {
  category: keyof LabData;              // original category (for trend API etc.)
  itemName: string;
  key: string;                          // `${category}:${itemName}`
  order: number;
  label: string;
  unit: string;
  pinned: boolean;
  subGroup?: 'U' | 'ST' | 'PF' | 'misc'; // only meaningful for section='other'
}

export function detectSubGroup(name: string): 'U' | 'ST' | 'PF' | 'misc' {
  if (name.startsWith('U_')) return 'U';
  if (name.startsWith('ST_')) return 'ST';
  if (name.startsWith('PF_')) return 'PF';
  return 'misc';
}

export function groupLabData(
  labData: LabData | null,
): Map<SectionId, RenderItem[]> {
  const result = new Map<SectionId, RenderItem[]>();
  if (!labData) return result;

  for (const category of Object.keys(labData) as (keyof LabData)[]) {
    const bucket = (labData as unknown as Record<string, unknown>)[
      category as string
    ];
    if (!bucket || typeof bucket !== 'object') continue;

    for (const itemName of Object.keys(bucket as Record<string, unknown>)) {
      if (itemName.startsWith('_')) continue; // skip meta keys
      const key = `${String(category)}:${itemName}`;
      const override = ITEM_OVERRIDE[key];
      const defaultSection =
        CATEGORY_DEFAULT_SECTION[String(category)] ?? 'other';
      const section: SectionId = override?.section ?? defaultSection;

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

  // Sort within each section: explicit order first, then itemName A→Z.
  for (const [, items] of result) {
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.itemName.localeCompare(b.itemName);
    });
  }

  return result;
}
