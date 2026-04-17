import type { LabData, LabItem } from '../api/lab-data';
import type { Medication } from '../api/medications';

export type LabWindow = '6h' | '24h' | 'all';

const WINDOW_MS: Record<LabWindow, number> = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

const CATEGORY_LABEL: Record<string, string> = {
  biochemistry: '生化',
  hematology: '血液',
  bloodGas: 'ABG',
  venousBloodGas: 'VBG',
  inflammatory: '發炎',
  coagulation: '凝血',
  cardiac: '心臟',
  lipid: '血脂',
  thyroid: '甲狀腺',
  hormone: '荷爾蒙',
  other: '其他',
};

const CATEGORY_ORDER: Array<keyof LabData> = [
  'biochemistry',
  'hematology',
  'bloodGas',
  'venousBloodGas',
  'inflammatory',
  'coagulation',
  'cardiac',
  'lipid',
  'thyroid',
  'hormone',
  'other',
];

function formatLabItem(name: string, item: LabItem): string {
  const parts = [`${name} ${item.value}`];
  if (item.unit) parts.push(item.unit);
  const tail = [];
  if (item.referenceRange) tail.push(item.referenceRange);
  if (item.isAbnormal) tail.push('*');
  const suffix = tail.length ? ` (${tail.join(' ')})` : '';
  return `${parts.join(' ')}${suffix}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLabsForPaste(
  labs: LabData | null | undefined,
  window: LabWindow = '24h',
  now: Date = new Date(),
): string {
  if (!labs || !labs.timestamp) return '';
  const ts = new Date(labs.timestamp);
  if (Number.isNaN(ts.getTime())) return '';
  const ageMs = now.getTime() - ts.getTime();
  const limit = WINDOW_MS[window];
  if (ageMs > limit) {
    return `Labs: 近 ${window} 無更新（最後一筆 ${formatTimestamp(labs.timestamp)}）`;
  }

  const lines: string[] = [`Labs (${formatTimestamp(labs.timestamp)}):`];
  for (const key of CATEGORY_ORDER) {
    const section = labs[key] as Record<string, LabItem> | undefined;
    if (!section) continue;
    const entries = Object.entries(section).filter(([, v]) => v && v.value !== undefined && v.value !== null);
    if (!entries.length) continue;
    const label = CATEGORY_LABEL[key as string] || String(key);
    const rendered = entries.map(([name, item]) => formatLabItem(name, item)).join(', ');
    lines.push(`- ${label}: ${rendered}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatMedicationLine(m: Medication): string {
  const parts: string[] = [];
  const name = m.genericName && m.genericName !== m.name
    ? `${m.name} (${m.genericName})`
    : m.name;
  parts.push(name);
  const dose = [m.dose, m.unit].filter(Boolean).join(' ');
  if (dose) parts.push(dose);
  if (m.route) parts.push(m.route);
  if (m.frequency) parts.push(m.frequency);
  if (m.prn) parts.push('PRN');
  if (m.indication) parts.push(`(${m.indication})`);
  return `- ${parts.join(' ')}`;
}

export function formatMedicationsForPaste(
  medications: Medication[] | null | undefined,
): string {
  if (!medications || !medications.length) return '';
  const active = medications.filter((m) => m.status === 'active');
  const pool = active.length ? active : medications;
  if (!pool.length) return '';
  return ['Current meds:', ...pool.map(formatMedicationLine)].join('\n');
}
