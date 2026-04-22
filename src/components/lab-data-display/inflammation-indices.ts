import type { LabData, LabItem } from '../../lib/api/lab-data';

export type InflammationKey = 'NLR' | 'PLR' | 'SIRI' | 'SII';

export interface InflammationInputs {
  wbc: number | null;
  segmentPct: number | null;
  lymphPct: number | null;
  monoPct: number | null;
  plt: number | null;
}

export interface InflammationResult {
  value: number | null;
  missing: string[];
}

const REQUIRED_FIELDS: Record<InflammationKey, (keyof InflammationInputs)[]> = {
  NLR: ['segmentPct', 'lymphPct'],
  PLR: ['plt', 'wbc', 'lymphPct'],
  SIRI: ['wbc', 'segmentPct', 'monoPct', 'lymphPct'],
  SII: ['plt', 'segmentPct', 'lymphPct'],
};

const FIELD_LABEL: Record<keyof InflammationInputs, string> = {
  wbc: 'WBC',
  segmentPct: 'Segment%',
  lymphPct: 'Lymph%',
  monoPct: 'Mono%',
  plt: 'PLT',
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readValue(section: Record<string, LabItem> | undefined, key: string): number | null {
  if (!section) return null;
  return finiteOrNull(section[key]?.value);
}

function readTimestamp(section: Record<string, LabItem> | undefined, key: string): string | null {
  const item = section?.[key] as (LabItem & { _ts?: string }) | undefined;
  return item?._ts ?? null;
}

export function extractInputs(labData: LabData): InflammationInputs {
  const h = labData.hematology;
  return {
    wbc: readValue(h, 'WBC'),
    segmentPct: readValue(h, 'Segment'),
    lymphPct: readValue(h, 'Lymph'),
    monoPct: readValue(h, 'Mono'),
    plt: readValue(h, 'PLT'),
  };
}

export function extractInputTimestamps(labData: LabData): Record<keyof InflammationInputs, string | null> {
  const h = labData.hematology;
  return {
    wbc: readTimestamp(h, 'WBC'),
    segmentPct: readTimestamp(h, 'Segment'),
    lymphPct: readTimestamp(h, 'Lymph'),
    monoPct: readTimestamp(h, 'Mono'),
    plt: readTimestamp(h, 'PLT'),
  };
}

function missingFields(
  inputs: InflammationInputs,
  required: (keyof InflammationInputs)[],
): string[] {
  return required.filter((f) => inputs[f] === null).map((f) => FIELD_LABEL[f]);
}

function absoluteCount(wbc: number, pct: number): number {
  return (wbc * pct) / 100;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function computeNLR(inputs: InflammationInputs): InflammationResult {
  const missing = missingFields(inputs, REQUIRED_FIELDS.NLR);
  if (missing.length > 0) return { value: null, missing };
  const value = safeDivide(inputs.segmentPct as number, inputs.lymphPct as number);
  return { value, missing: value === null ? ['Lymph% = 0'] : [] };
}

export function computePLR(inputs: InflammationInputs): InflammationResult {
  const missing = missingFields(inputs, REQUIRED_FIELDS.PLR);
  if (missing.length > 0) return { value: null, missing };
  const alc = absoluteCount(inputs.wbc as number, inputs.lymphPct as number);
  const value = safeDivide(inputs.plt as number, alc);
  return { value, missing: value === null ? ['Lymph% = 0'] : [] };
}

export function computeSIRI(inputs: InflammationInputs): InflammationResult {
  const missing = missingFields(inputs, REQUIRED_FIELDS.SIRI);
  if (missing.length > 0) return { value: null, missing };
  const wbc = inputs.wbc as number;
  const anc = absoluteCount(wbc, inputs.segmentPct as number);
  const amc = absoluteCount(wbc, inputs.monoPct as number);
  const alc = absoluteCount(wbc, inputs.lymphPct as number);
  const value = safeDivide(anc * amc, alc);
  return { value, missing: value === null ? ['Lymph% = 0'] : [] };
}

export function computeSII(inputs: InflammationInputs): InflammationResult {
  const missing = missingFields(inputs, REQUIRED_FIELDS.SII);
  if (missing.length > 0) return { value: null, missing };
  const value = safeDivide(
    (inputs.plt as number) * (inputs.segmentPct as number),
    inputs.lymphPct as number,
  );
  return { value, missing: value === null ? ['Lymph% = 0'] : [] };
}

export function computeAll(
  labData: LabData,
): Record<InflammationKey, InflammationResult> & { inputs: InflammationInputs } {
  const inputs = extractInputs(labData);
  return {
    inputs,
    NLR: computeNLR(inputs),
    PLR: computePLR(inputs),
    SIRI: computeSIRI(inputs),
    SII: computeSII(inputs),
  };
}

export const INFLAMMATION_META: Record<
  InflammationKey,
  { label: string; fullName: string; unit: string; formula: string; decimals: number }
> = {
  NLR: {
    label: 'NLR',
    fullName: 'Neutrophil-to-Lymphocyte Ratio',
    unit: '',
    formula: 'Segment% / Lymph%',
    decimals: 2,
  },
  PLR: {
    label: 'PLR',
    fullName: 'Platelet-to-Lymphocyte Ratio',
    unit: '',
    formula: 'PLT / ALC',
    decimals: 1,
  },
  SIRI: {
    label: 'SIRI',
    fullName: 'Systemic Inflammation Response Index',
    unit: '×10³/μL',
    formula: '(ANC × AMC) / ALC',
    decimals: 2,
  },
  SII: {
    label: 'SII',
    fullName: 'Systemic Immune-Inflammation Index',
    unit: '×10³/μL',
    formula: '(PLT × ANC) / ALC',
    decimals: 0,
  },
};

export function formatIndex(value: number | null, key: InflammationKey): string {
  if (value === null) return '-';
  return value.toFixed(INFLAMMATION_META[key].decimals);
}
