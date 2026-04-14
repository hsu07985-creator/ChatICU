import type { Medication, VentilatorSettings, VitalSigns } from '../lib/api';
import type { PatientMessage } from '../lib/api/messages';
import type { AIReadiness, Citation as AiCitation, DataFreshness } from '../lib/api/ai';

const LAB_CHINESE_NAMES_MAP: Record<string, string> = {
  RespiratoryRate: '呼吸速率', Temperature: '體溫',
  BloodPressureSystolic: '收縮壓 SBP', BloodPressureDiastolic: '舒張壓 DBP',
  HeartRate: '心率', SpO2: '血氧飽和度',
  CVP: '中心靜脈壓', ICP: '顱內壓', FiO2: '吸入氧濃度',
  PEEP: '呼氣末正壓', TidalVolume: '潮氣量', VentRR: '呼吸器設定呼吸速率',
  PIP: '尖峰吸氣壓', Plateau: '平台壓', Compliance: '肺順應性',
  Na: '鈉', K: '鉀', Cl: '氯', BUN: '血中尿素氮', Scr: '肌酐酸',
  WBC: '白血球', Hb: '血紅素', PLT: '血小板', CRP: 'C反應蛋白',
  pH: '酸鹼值', PCO2: '二氧化碳分壓', PO2: '氧分壓', Lactate: '乳酸',
  BodyWeight: '體重',
};

export function getLabChineseName(labName: string): string {
  return LAB_CHINESE_NAMES_MAP[labName] || labName;
}

export function formatAiDegradedReason(reason?: string | null, upstreamStatus?: string | null): string {
  if (reason === 'insufficient_evidence') {
    return '目前可用證據有限';
  }
  if (reason === 'insufficient_patient_data') {
    return '病患關鍵資料不足（已改為部分回覆）';
  }
  if (reason === 'llm_unavailable') {
    return 'LLM 服務不可用';
  }
  return reason || upstreamStatus || 'unknown';
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

  const sections = dataFreshness.sections || ({} as DataFreshness['sections']);
  if (sections.vital_signs?.status === 'missing') {
    pushHint('目前缺少生命徵象資料，建議先補抓最新數值。');
  } else if (sections.vital_signs?.status === 'stale') {
    pushHint('生命徵象資料較舊，解讀時請先確認最新量測。');
  }

  if (sections.lab_data?.status === 'missing') {
    pushHint('目前缺少檢驗資料。');
  } else if (sections.lab_data?.status === 'stale') {
    pushHint('檢驗資料較舊，請留意時效性。');
  }

  if (sections.medications?.status === 'missing') {
    pushHint('目前缺少用藥資料。');
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
  const pages = Array.isArray(citation.pages)
    ? citation.pages.filter((p): p is number => Number.isFinite(Number(p))).map((p) => Number(p))
    : [];
  if (pages.length > 1) {
    const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
    return `第 ${uniq.join('、')} 頁`;
  }
  if (typeof citation.page === 'number') {
    return `第 ${citation.page} 頁`;
  }
  if (pages.length === 1) {
    return `第 ${pages[0]} 頁`;
  }
  return '頁碼待補';
}

export function compactSnippet(snippet?: string): string {
  const text = String(snippet || '').trim();
  if (!text) return '';
  return text;
}

export function formatSnapshotValue(value: number | undefined): string {
  return value !== undefined ? String(value) : 'N/A';
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

export function formatDisplayTimestamp(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW');
}

export function formatMessageTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

export function formatTrendAxisLabel(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getVitalTrendValue(record: VitalSigns, itemName: string): number | undefined {
  switch (itemName) {
    case 'RespiratoryRate':
      return record.respiratoryRate ?? undefined;
    case 'Temperature':
      return record.temperature ?? undefined;
    case 'BloodPressureSystolic':
      return record.bloodPressure?.systolic ?? undefined;
    case 'BloodPressureDiastolic':
      return record.bloodPressure?.diastolic ?? undefined;
    case 'HeartRate':
      return record.heartRate ?? undefined;
    case 'SpO2':
      return record.spo2 ?? undefined;
    case 'CVP':
      return record.cvp ?? undefined;
    case 'ICP':
      return record.icp ?? undefined;
    default:
      return undefined;
  }
}

export function getVentilatorTrendValue(record: VentilatorSettings, itemName: string): number | undefined {
  switch (itemName) {
    case 'FiO2':
      return record.fio2;
    case 'PEEP':
      return record.peep;
    case 'TidalVolume':
      return record.tidalVolume;
    case 'VentRR':
      return record.respiratoryRate;
    case 'PIP':
      return record.pip ?? undefined;
    case 'Plateau':
      return record.plateau ?? undefined;
    case 'Compliance':
      return record.compliance ?? undefined;
    default:
      return undefined;
  }
}

/**
 * 正規化藥物劑量顯示值：
 *   "1.0"   → "1"       （整數數值不顯示小數點）
 *   "0.5"   → "0.5"     （保留有意義的小數）
 *   "0.25"  → "0.25"
 *   "適量"  → "適量"    （非純數字不動）
 *   ""/null → ""
 * 目的：避免 1.0 被誤讀成 10。
 */
export function formatDoseValue(dose: unknown): string {
  if (dose === null || dose === undefined) return '';
  const raw = typeof dose === 'string' ? dose.trim() : String(dose);
  if (raw === '') return '';
  // Only rewrite plain numeric strings like "1", "1.0", "0.25"
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  // Number("1.00") → 1, Number("0.50") → 0.5, Number("0.25") → 0.25
  return String(num);
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

// ── 留言板按週分組 ──

export interface MessageWeekGroup {
  key: string;
  label: string;
  isRecent: boolean;
  messages: PatientMessage[];
  unreadCount: number;
  medicationAdviceCount: number;
  alertCount: number;
}

function getMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  d.setDate(d.getDate() - diff);
  return d;
}

function formatWeekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fm = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fm(monday)} – ${fm(sunday)}`;
}

function computeGroupStats(msgs: PatientMessage[]) {
  let unreadCount = 0;
  let medicationAdviceCount = 0;
  let alertCount = 0;
  for (const m of msgs) {
    if (!m.isRead) unreadCount++;
    if (m.messageType === 'medication-advice') medicationAdviceCount++;
    if (m.messageType === 'alert') alertCount++;
  }
  return { unreadCount, medicationAdviceCount, alertCount };
}

export function groupMessagesByWeek(messages: PatientMessage[]): MessageWeekGroup[] {
  if (messages.length === 0) return [];

  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - 7);

  const recentMessages: PatientMessage[] = [];
  const olderByWeek = new Map<string, PatientMessage[]>();

  for (const msg of messages) {
    const ts = new Date(msg.timestamp);
    if (ts >= cutoff) {
      recentMessages.push(msg);
    } else {
      const monday = getMonday(ts);
      const key = monday.toISOString().slice(0, 10);
      const bucket = olderByWeek.get(key);
      if (bucket) {
        bucket.push(msg);
      } else {
        olderByWeek.set(key, [msg]);
      }
    }
  }

  const groups: MessageWeekGroup[] = [];

  if (recentMessages.length > 0) {
    groups.push({
      key: 'recent',
      label: '最近 7 天',
      isRecent: true,
      messages: recentMessages,
      ...computeGroupStats(recentMessages),
    });
  }

  const sortedWeeks = Array.from(olderByWeek.entries()).sort(
    (a, b) => b[0].localeCompare(a[0]), // DESC by week key
  );

  for (const [key, msgs] of sortedWeeks) {
    const monday = new Date(key + 'T00:00:00');
    groups.push({
      key,
      label: formatWeekLabel(monday),
      isRecent: false,
      messages: msgs,
      ...computeGroupStats(msgs),
    });
  }

  return groups;
}

export function createReadinessFallback(reason: string): AIReadiness {
  return {
    overall_ready: false,
    checked_at: new Date().toISOString(),
    llm: {
      ready: false,
      provider: 'unknown',
      model: 'unknown',
      reason: 'READINESS_CHECK_FAILED',
    },
    evidence: {
      reachable: false,
      ready: false,
      reason: 'READINESS_CHECK_FAILED',
      last_error: reason,
    },
    rag: {
      ready: false,
      is_indexed: false,
      total_chunks: 0,
      total_documents: 0,
      engine: 'unknown',
      clinical_rules_loaded: false,
    },
    feature_gates: {
      chat: false,
      clinical_summary: false,
      patient_explanation: false,
      guideline_interpretation: false,
      decision_support: false,
      clinical_polish: false,
      dose_calculation: false,
      drug_interactions: false,
      clinical_query: false,
    },
    blocking_reasons: ['READINESS_CHECK_FAILED'],
    display_reasons: ['AI 服務狀態檢查失敗，已暫時停用 AI 功能。'],
  };
}
