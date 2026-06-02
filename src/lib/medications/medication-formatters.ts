// Pure, stateless formatters + color maps extracted from
// src/components/patient/patient-medications-tab.tsx (behavior-preserving split).
//
// formatDoseValue lives in src/lib/patient-detail-format.ts (the canonical copy);
// it is re-exported here so existing call sites inside the medications views keep
// a single import surface.
import i18n from '../../i18n/config';
import type { Medication } from '../api';
import { formatDoseValue } from '../patient-detail-format';

export { formatDoseValue };

const PRN_FREQ_PATTERN = /PRN|STAT/i;

/** 判定門診藥物是否已過期（endDate 已過） */
export function isOutpatientExpired(med: Medication): boolean {
  if (!med.endDate) return false;
  const end = new Date(med.endDate);
  if (isNaN(end.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

/** 取得門診藥物的服用狀態（key 用於 t() lookup） */
export function getOutpatientStatus(med: Medication): { labelKey: 'discontinued' | 'expired' | 'active'; color: string } {
  if (med.status === 'discontinued') return { labelKey: 'discontinued', color: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300' };
  if (isOutpatientExpired(med)) return { labelKey: 'expired', color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' };
  return { labelKey: 'active', color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' };
}

export function isPrnOrStat(med: Medication): boolean {
  if (med.prn) return true;
  if (med.frequency && PRN_FREQ_PATTERN.test(med.frequency)) return true;
  return false;
}

export function formatMedDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(i18n.language, { month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatMedDateFromDate(date?: Date | null): string {
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString(i18n.language, { month: '2-digit', day: '2-digit' })
    + ' ' + date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function parseMedicationTime(dateStr?: string | null): number {
  if (!dateStr) return Number.NEGATIVE_INFINITY;
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function formatOutpatientGroupDate(dateStr?: string | null, fallback: string = '未標示日期'): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return fallback;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function getMedicationEndDate(medication: Medication): Date | null {
  if (medication.endDate) {
    const explicitEnd = new Date(medication.endDate);
    if (!isNaN(explicitEnd.getTime())) return explicitEnd;
  }
  if (!medication.startDate || medication.daysSupply == null || medication.daysSupply <= 0) {
    return null;
  }
  const start = new Date(medication.startDate);
  if (isNaN(start.getTime())) return null;
  const calculatedEnd = new Date(start);
  calculatedEnd.setDate(calculatedEnd.getDate() + medication.daysSupply - 1);
  return calculatedEnd;
}

export function formatCalendarDate(date?: Date | null): string {
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString(i18n.language);
}

export function formatMedicationConcentration(medication: Medication): string | null {
  if (!medication.concentration) return null;
  return [medication.concentration, medication.concentrationUnit].filter(Boolean).join(' ');
}

// Color only — labels come from t('medications:tab.categories.<key>')
export const MED_CATEGORY_COLORS: Record<string, string> = {
  antibiotic: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  antifungal: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  antiviral: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  vasopressor: 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-300',
  anticoagulant: 'bg-rose-100 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300',
  steroid: 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300',
  ppi: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300',
  h2_blocker: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300',
  diuretic: 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300',
  insulin: 'bg-teal-100 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300',
  electrolyte: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300',
  bronchodilator: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300',
  antiarrhythmic: 'bg-pink-100 dark:bg-pink-950/30 text-pink-800 dark:text-pink-300',
  antiepileptic: 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-300',
  laxative: 'bg-lime-100 dark:bg-lime-950/30 text-lime-800 dark:text-lime-300',
  antiemetic: 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300',
};

/** Pain 0-10 色階：綠→黃→橙→紅 */
export function painColor(v: number): string {
  if (v <= 1) return 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
  if (v <= 3) return 'bg-lime-100 dark:bg-lime-950/30 text-lime-700 dark:text-lime-400 border-lime-200 dark:border-lime-800';
  if (v <= 5) return 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
  if (v <= 7) return 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800';
  return 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
}

/** RASS -5~+4 色階：深藍(深鎮靜)→淡藍→綠(平靜)→橙→紅(躁動) */
export function rassColor(v: number): string {
  if (v <= -3) return 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800';
  if (v <= -1) return 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800';
  if (v === 0) return 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
  if (v <= 2) return 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
  return 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
}

export function formatScoreTimestamp(ts: string): string {
  return new Date(ts).toLocaleString(i18n.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
