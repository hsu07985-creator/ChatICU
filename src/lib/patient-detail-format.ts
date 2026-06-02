// Pure, stateless formatters extracted from src/pages/patient-detail.tsx.
//
// IMPORTANT — why these live here and NOT in src/pages/patient-detail-utils.ts:
// patient-detail-utils.ts already exports same-named helpers, but those are the
// *non-i18n* variants (hardcoded zh-TW copy, e.g. '目前可用證據有限'). The
// patient-detail page renders the *i18n* variants that resolve strings through
// i18n.t(..., { ns: 'patient-detail' }) and respect i18n.language. Importing the
// utils versions would silently revert displayed copy and locale handling, so we
// keep the page's exact implementations here to preserve behavior 1:1.
import i18n from '../i18n/config';
import type { Citation as AiCitation, DataFreshness } from './api/ai';
import type { Medication } from './api';

export function formatAiDegradedReason(reason?: string | null, upstreamStatus?: string | null): string {
  const tr = (k: string) => i18n.t(k, { ns: 'patient-detail' });
  if (reason === 'insufficient_evidence') return tr('degradedReason.insufficientEvidence');
  if (reason === 'insufficient_patient_data') return tr('degradedReason.insufficientPatientData');
  if (reason === 'llm_unavailable') return tr('degradedReason.llmUnavailable');
  return reason || upstreamStatus || tr('degradedReason.unknown');
}

export function getDisplayFreshnessHints(dataFreshness?: DataFreshness | null): string[] {
  if (!dataFreshness) {
    return [];
  }

  const hints: string[] = [];
  const seen = new Set<string>();
  const pushHint = (value: string) => {
    const text = value.trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    hints.push(text);
  };

  const tr = (k: string) => i18n.t(k, { ns: 'patient-detail' });
  const sections = dataFreshness.sections || ({} as DataFreshness['sections']);
  if (sections.vital_signs?.status === 'missing') {
    pushHint(tr('freshnessHints.vitalsMissing'));
  } else if (sections.vital_signs?.status === 'stale') {
    pushHint(tr('freshnessHints.vitalsStale'));
  }

  if (sections.lab_data?.status === 'missing') {
    pushHint(tr('freshnessHints.labMissing'));
  } else if (sections.lab_data?.status === 'stale') {
    pushHint(tr('freshnessHints.labStale'));
  }

  if (sections.medications?.status === 'missing') {
    pushHint(tr('freshnessHints.medsMissing'));
  }

  if (hints.length > 0) {
    return hints;
  }

  for (const raw of dataFreshness.hints || []) {
    const hint = String(raw || '').trim();
    if (!hint) {
      continue;
    }
    if (hint.includes('JSON 離線模式') || hint.includes('資料快照時間')) {
      continue;
    }
    pushHint(hint);
  }

  return hints;
}

export function formatCitationPageText(citation: AiCitation): string {
  const tr = (k: string, opts?: Record<string, unknown>) => i18n.t(k, { ns: 'patient-detail', ...(opts ?? {}) }) as string;
  const pages = Array.isArray(citation.pages)
    ? citation.pages.filter((p): p is number => Number.isFinite(Number(p))).map((p) => Number(p))
    : [];
  if (pages.length > 1) {
    const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
    return tr('citation.pages', { pages: uniq.join('、') });
  }
  if (typeof citation.page === 'number') {
    return tr('citation.page', { page: citation.page });
  }
  if (pages.length === 1) {
    return tr('citation.page', { page: pages[0] });
  }
  return tr('citation.pageMissing');
}

export function compactSnippet(snippet?: string): string {
  const text = String(snippet || '').trim();
  if (!text) return '';
  return text;
}

export function extractLabNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (value && typeof value === 'object' && 'value' in value) {
    const nestedValue = (value as { value?: unknown }).value;
    if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) {
      return nestedValue;
    }
    if (typeof nestedValue === 'string' && nestedValue.trim() !== '') {
      const parsedNested = Number(nestedValue);
      if (Number.isFinite(parsedNested)) {
        return parsedNested;
      }
    }
  }

  return undefined;
}

export function formatSnapshotValue(value: number | undefined): string {
  return value !== undefined ? String(value) : 'N/A';
}

export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? '-' : trimmed;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '-';
  }
  return String(value);
}

/**
 * 正規化藥物劑量顯示值：整數值去掉 .0（避免 1.0 被看成 10），
 * 有意義的小數（0.5、0.25）保留。非數字（「適量」）原樣返回。
 */
export function formatDoseValue(dose: unknown): string {
  if (dose === null || dose === undefined) return '';
  const raw = typeof dose === 'string' ? dose.trim() : String(dose);
  if (raw === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return String(num);
}

export function formatDisplayTimestamp(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString(i18n.language);
}

export function normalizeSanCategory(raw: unknown): 'S' | 'A' | 'N' | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'S' || normalized === 'A' || normalized === 'N') {
    return normalized;
  }
  return null;
}

export function formatMedicationRegimen(med: Medication): string {
  const doseValue = formatDoseValue(med.dose);
  const dose = doseValue === '' ? '-' : doseValue;
  const unit = formatDisplayValue(med.unit);
  const frequency = formatDisplayValue(med.frequency);
  const route = formatDisplayValue(med.route);

  const dosePart = [dose, unit].filter((part) => part !== '-').join(' ');
  const parts = [dosePart || '-', frequency, med.prn ? 'PRN' : '', route].filter(Boolean);
  return parts.join(' ');
}

export interface MedicationGroups {
  sedation: Medication[];
  analgesia: Medication[];
  nmb: Medication[];
  other: Medication[];
  outpatient: Medication[];
}

export function deriveMedicationGroups(items: Medication[]): MedicationGroups {
  const grouped: MedicationGroups = {
    sedation: [],
    analgesia: [],
    nmb: [],
    other: [],
    outpatient: [],
  };

  for (const med of items) {
    if (med.sourceType === 'outpatient' || med.sourceType === 'self-supplied') {
      grouped.outpatient.push(med);
    } else {
      const san = normalizeSanCategory(med.sanCategory);
      if (san === 'S') {
        grouped.sedation.push(med);
      } else if (san === 'A') {
        grouped.analgesia.push(med);
      } else if (san === 'N') {
        grouped.nmb.push(med);
      } else {
        grouped.other.push(med);
      }
    }
  }

  return grouped;
}
