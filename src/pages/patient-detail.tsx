// Patient detail page
import { VitalSignCard } from '../components/vital-signs-card';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Lazy-load recharts-backed trend chart (H4: keep 411 KB charts-*.js off the critical path)
const LabTrendChart = lazy(() =>
  import('../components/lab-trend-chart').then((m) => ({ default: m.LabTrendChart }))
);

// Phase 3.4: Lazy-load non-default patient detail tabs to shrink first-paint payload.
// Chat tab stays statically imported because it is the default-visible tab; lazy-loading
// it would add a fetch round-trip to first paint.
const PatientMessagesTab = lazy(() =>
  import('../components/patient/patient-messages-tab').then((m) => ({ default: m.PatientMessagesTab }))
);
const MedicalRecords = lazy(() =>
  import('../components/medical-records').then((m) => ({ default: m.MedicalRecords }))
);
const PatientLabsTab = lazy(() =>
  import('../components/patient/patient-labs-tab').then((m) => ({ default: m.PatientLabsTab }))
);
const PatientMedicationsTab = lazy(() =>
  import('../components/patient/patient-medications-tab').then((m) => ({ default: m.PatientMedicationsTab }))
);
const PatientSummaryTab = lazy(() =>
  import('../components/patient/patient-summary-tab').then((m) => ({ default: m.PatientSummaryTab }))
);
import { useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  streamChatMessage,
  extractStreamMainContent,
  splitMainAndDetail,
  getChatSessions as fetchChatSessionsApi,
  getChatSession as fetchChatSessionApi,
  refreshChatSessionSnapshot,
  updateChatSessionTitle,
  updateMessageFeedback,
  deleteChatSession,
  type AdviceRef,
  type ChatResponse,
  type Citation as AiCitation,
  type DataFreshness,
} from '../lib/api/ai';
import { patientsApi, medicationsApi, messagesApi, ventilatorApi, type Patient, type LabData, type Medication, type PatientMessage, type VitalSigns, type VentilatorSettings, type WeaningAssessment } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard-utils';
import { maskPatientName } from '../lib/utils/patient-name';
import { useAuth } from '../lib/auth-context';
import { usePatientScores } from '../hooks/use-patient-scores';
import { useTrendChart, type TrendSource } from '../hooks/use-trend-chart';
import { refreshSharedPatientDataAfterMutation } from '../lib/patient-data-sync';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ButtonLoadingIndicator } from '../components/ui/button-loading-indicator';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { ScrollArea } from '../components/ui/scroll-area';
import { Alert, AlertDescription } from '../components/ui/alert';
import { toast } from 'sonner';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../components/ui/state-display';
import { AiMarkdown, SafetyWarnings } from '../components/ui/ai-markdown';
import { LabDataSkeleton, MedicationsSkeleton, MessageListSkeleton } from '../components/ui/skeletons';
import { PatientEditDialog } from '../components/patient/dialogs/patient-edit-dialog';
import { PatientChatTab } from '../components/patient/patient-chat-tab';
import { respondToAdvice } from '../lib/api/pharmacy';
import {
  ArrowLeft,
  Calendar,
  User,
  Heart,
  Droplet,
  Wind,
  TrendingUp,
  MessageSquare,
  MessagesSquare,
  Pill,
  Activity,
  TestTube,
  FileText,
  AlertCircle,
  Clock,
  Send,
  Copy,
  Download,
  CheckCircle2,
  XCircle,
  Shield,
  Syringe,
  Brain,
  Stethoscope,
  Info,
  RefreshCw,
  Plus,
  Save,
  History,
  BookOpen,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowDown,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle
} from 'lucide-react';
import { LabDataDisplay } from '../components/lab-data-display';
import chatBotAvatar from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';
import { getAirwayStatusLabel } from '../lib/patient-airway';

// 預設空的 labData 結構（用於 API 載入前）
const defaultLabData: LabData = {
  id: '',
  patientId: '',
  timestamp: '',
  biochemistry: {},
  hematology: {},
  coagulation: {},
  bloodGas: {},
  inflammatory: {}
};

// 檢驗項目中文名稱對照
const LAB_CHINESE_NAMES_MAP: Record<string, string> = {
  RespiratoryRate: '呼吸速率', Temperature: '體溫',
  BloodPressureSystolic: '收縮壓 SBP', BloodPressureDiastolic: '舒張壓 DBP',
  HeartRate: '心率', SpO2: '血氧飽和度', EtCO2: '呼氣末二氧化碳',
  CVP: '中心靜脈壓', ICP: '顱內壓', FiO2: '吸入氧濃度',
  PEEP: '呼氣末正壓', TidalVolume: '潮氣量', VentRR: '呼吸器設定呼吸速率',
  PIP: '尖峰吸氣壓', Plateau: '平台壓', Compliance: '肺順應性',
  Na: '鈉', K: '鉀', Cl: '氯', BUN: '血中尿素氮', Scr: '肌酐酸',
  WBC: '白血球', Hb: '血紅素', PLT: '血小板', CRP: 'C反應蛋白',
  pH: '酸鹼值', PCO2: '二氧化碳分壓', PO2: '氧分壓', Lactate: '乳酸',
  BodyWeight: '體重',
};

// 擴展 Patient 類型以包含前端需要的額外欄位
interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}

// 對話會話介面（前端管理用）
interface ChatSession {
  id: string;
  patientId: string;
  sessionDate: string;
  sessionTime: string;
  title: string;
  messages: ChatMessage[];
  lastUpdated: string;
  messageCount?: number;
  labDataSnapshot?: {
    K?: number;
    Na?: number;
    Scr?: number;
    eGFR?: number;
    CRP?: number;
    WBC?: number;
  };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  messageId?: string;
  explanation?: string | null;
  timestamp?: string;
  references?: AiCitation[];
  warnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  feedback?: 'up' | 'down' | null;
  /** F-PARITY (2026-05-03): live-only deep-link refs from this turn's
   *  prefetch (currently pharmacy advice). Empty/undefined when reload
   *  reads from DB or when no advice prefetch fired. */
  adviceRefs?: AdviceRef[];
}

interface MedicationGroups {
  sedation: Medication[];
  analgesia: Medication[];
  nmb: Medication[];
  other: Medication[];
  outpatient: Medication[];
}

const EMPTY_MEDICATION_GROUPS: MedicationGroups = {
  sedation: [],
  analgesia: [],
  nmb: [],
  other: [],
  outpatient: [],
};

const MED_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  antibiotic: { label: '抗生素', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  antifungal: { label: '抗黴菌', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  antiviral: { label: '抗病毒', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  vasopressor: { label: '升壓劑', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  anticoagulant: { label: '抗凝血', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' },
  steroid: { label: '類固醇', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  ppi: { label: 'PPI', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
  h2_blocker: { label: 'H2 Blocker', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
  diuretic: { label: '利尿劑', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300' },
  insulin: { label: '胰島素', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  electrolyte: { label: '電解質', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  bronchodilator: { label: '支氣管擴張', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  antiarrhythmic: { label: '抗心律不整', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300' },
  antiepileptic: { label: '抗癲癇', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  laxative: { label: '緩瀉劑', color: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300' },
  antiemetic: { label: '止吐', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
};

function formatAiDegradedReason(reason?: string | null, upstreamStatus?: string | null): string {
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

function getDisplayFreshnessHints(dataFreshness?: DataFreshness | null): string[] {
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

function formatCitationPageText(citation: AiCitation): string {
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

function compactSnippet(snippet?: string): string {
  const text = String(snippet || '').trim();
  if (!text) return '';
  return text;
}

function extractLabNumericValue(value: unknown): number | undefined {
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

function formatSnapshotValue(value: number | undefined): string {
  return value !== undefined ? String(value) : 'N/A';
}

function formatDisplayValue(value: unknown): string {
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
function formatDoseValue(dose: unknown): string {
  if (dose === null || dose === undefined) return '';
  const raw = typeof dose === 'string' ? dose.trim() : String(dose);
  if (raw === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return String(num);
}

function formatDisplayTimestamp(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW');
}


function normalizeSanCategory(raw: unknown): 'S' | 'A' | 'N' | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'S' || normalized === 'A' || normalized === 'N') {
    return normalized;
  }
  return null;
}

function formatMedicationRegimen(med: Medication): string {
  const doseValue = formatDoseValue(med.dose);
  const dose = doseValue === '' ? '-' : doseValue;
  const unit = formatDisplayValue(med.unit);
  const frequency = formatDisplayValue(med.frequency);
  const route = formatDisplayValue(med.route);

  const dosePart = [dose, unit].filter((part) => part !== '-').join(' ');
  const parts = [dosePart || '-', frequency, med.prn ? 'PRN' : '', route].filter(Boolean);
  return parts.join(' ');
}

function deriveMedicationGroups(items: Medication[]): MedicationGroups {
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



export function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('chat');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [expandedExplanations, setExpandedExplanations] = useState<number[]>([]);
  const [expandedReferences, setExpandedReferences] = useState<number[]>([]);
  const [expandedDataQuality, setExpandedDataQuality] = useState<number[]>([]);
  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isDeletingSessions, setIsDeletingSessions] = useState(false);
  const [feedbackingMessageIndex, setFeedbackingMessageIndex] = useState<number | null>(null);
  const [regeneratingMessageIndex, setRegeneratingMessageIndex] = useState<number | null>(null);

  // F-PARITY (F2 in patient-detail): same snapshot freshness pill the
  // sidebar /ai-chat page already has. Pharmacists almost always enter
  // chat from this page, so without this here the F2 button effectively
  // doesn't exist for them.
  const [snapshotTakenAt, setSnapshotTakenAt] = useState<string | null>(null);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);

  // RAG layer removed — AI features are always available, no readiness gating.

  // 病人資料狀態
  const [patient, setPatient] = useState<PatientWithFrontendFields | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError, setPatientError] = useState<string | null>(null);

  // 編輯病人資料
  const [editingPatient, setEditingPatient] = useState<PatientWithFrontendFields | null>(null);
  const [savingPatient, setSavingPatient] = useState(false);
  const handleEditSave = async () => {
    if (!editingPatient || !patient) return;
    setSavingPatient(true);
    try {
      const updated = await patientsApi.updatePatient(patient.id, editingPatient);
      await refreshSharedPatientDataAfterMutation();
      setPatient(updated as PatientWithFrontendFields);
      setEditingPatient(null);
      toast.success('病人資料已更新');
    } catch {
      toast.error('更新失敗，請稍後再試');
    } finally {
      setSavingPatient(false);
    }
  };

  // 檢驗數據狀態
  const [labData, setLabData] = useState<LabData>(defaultLabData);
  const [labDataLoading, setLabDataLoading] = useState(false);

  // 用藥數據狀態
  const [medicationGroups, setMedicationGroups] = useState<MedicationGroups>(EMPTY_MEDICATION_GROUPS);
  // drugInteractions state removed — DDI auto-banner no longer lives on the
  // 用藥 tab; use /pharmacy/interactions for on-demand lookup.
  const [medicationsLoading, setMedicationsLoading] = useState(false);

  // 臨床評分（hook）
  const scores = usePatientScores(id);

  // 留言板狀態
  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [presetTags, setPresetTags] = useState<string[]>([]);
  const [pharmacyTagCategories, setPharmacyTagCategories] = useState<{ category: string; tags: string[] }[]>([]);
  const [customTags, setCustomTags] = useState<{ id: string; name: string; createdByName: string }[]>([]);

  // 生命徵象狀態
  const [vitalSigns, setVitalSigns] = useState<VitalSigns | null>(null);
  const [vitalSignsLoading, setVitalSignsLoading] = useState(false);

  // 呼吸器設定狀態
  const [ventilator, setVentilator] = useState<VentilatorSettings | null>(null);
  const [ventilatorLoading, setVentilatorLoading] = useState(false);
  const [weaningAssessment, setWeaningAssessment] = useState<WeaningAssessment | null>(null);
  const [isRefreshingPatientData, setIsRefreshingPatientData] = useState(false);

  // 對話記錄相關狀態
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [showSessionList, setShowSessionList] = useState(true);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);
  const [chatSessionsLoaded, setChatSessionsLoaded] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messageTagsLoaded, setMessageTagsLoaded] = useState(false);
  const [scoresLoaded, setScoresLoaded] = useState(false);
  const [weaningLoaded, setWeaningLoaded] = useState(false);

  // 趨勢圖表（hook）
  const { selectedTrendMetric, setSelectedTrendMetric, trendChartData } = useTrendChart(id);

  // Flattened medication list for the pharmacist SOAP editor (Phase 4)
  const allMedications = useMemo(
    () => [
      ...(medicationGroups.analgesia || []),
      ...(medicationGroups.sedation || []),
      ...(medicationGroups.nmb || []),
      ...(medicationGroups.other || []),
      ...(medicationGroups.outpatient || []),
    ],
    [medicationGroups],
  );
  const metricGridStyle = {
    gridTemplateColumns: 'repeat(auto-fit, minmax(var(--metric-card-size, 124px), 1fr))',
    gap: 'var(--metric-card-gap, 10px)',
    alignItems: 'stretch',
  } as const;

  const loadPatientBundle = useCallback(async (mode: 'initial' | 'refresh') => {
    if (!id) return;
    try {
      if (mode === 'initial') {
        setPatientLoading(true);
        setPatientError(null);
        setMessages([]);
        setPresetTags([]);
        setPharmacyTagCategories([]);
        setCustomTags([]);
        setChatSessions([]);
        setSelectedSession(null);
        setChatMessages([]);
        setSessionTitle('');
        setWeaningAssessment(null);
        setMessagesLoaded(false);
        setMessageTagsLoaded(false);
        setChatSessionsLoaded(false);
        setScoresLoaded(false);
        setWeaningLoaded(false);
      } else {
        setIsRefreshingPatientData(true);
      }

      setMedicationsLoading(true);
      setVitalSignsLoading(true);
      setVentilatorLoading(true);
      setLabDataLoading(true);

      const bundle = await patientsApi.getPatientBootstrap(id);

      setPatient(bundle.patient as PatientWithFrontendFields);
      setLabData(bundle.latestLab ?? defaultLabData);
      setMedicationGroups(
        bundle.medications.grouped || deriveMedicationGroups(bundle.medications.medications),
      );
      setVitalSigns(bundle.latestVitals);
      setVentilator(bundle.latestVentilator);

      if (mode === 'refresh') {
        toast.success('已更新患者數值');
      }
    } catch (err) {
      console.error('載入病人資料失敗:', err);
      if (mode === 'initial') {
        setPatientError('無法載入病人資料');
      } else {
        toast.error('更新患者數值失敗，請確認網路與後端服務狀態');
      }
    } finally {
      if (mode === 'initial') {
        setPatientLoading(false);
      } else {
        setIsRefreshingPatientData(false);
      }
      setMedicationsLoading(false);
      setVitalSignsLoading(false);
      setVentilatorLoading(false);
      setLabDataLoading(false);
    }
  }, [id]);

  const refreshMessagesOnly = useCallback(async () => {
    if (!id) return;
    try {
      setMessagesLoading(true);
      const res = await messagesApi.getMessages(id);
      setMessages(res.messages);
      setMessagesLoaded(true);
    } catch (err) {
      console.error('重新載入留言失敗:', err);
      toast.error('重新載入留言失敗');
    } finally {
      setMessagesLoading(false);
    }
  }, [id]);

  const refreshChatSessions = useCallback(async () => {
    if (!id) return;
    setChatSessionsLoading(true);
    try {
      const sessionsData = await fetchChatSessionsApi({ patientId: id });
      setChatSessions(sessionsData.sessions.map(s => ({
        id: s.id,
        patientId: s.patientId || id,
        sessionDate: new Date(s.createdAt).toISOString().split('T')[0],
        sessionTime: new Date(s.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        title: s.title,
        messages: [],
        lastUpdated: new Date(s.updatedAt).toLocaleString('zh-TW'),
        messageCount: s.messageCount,
      })));
      setChatSessionsLoaded(true);
    } catch {
      setChatSessions([]);
      setChatSessionsLoaded(true);
    } finally {
      setChatSessionsLoading(false);
    }
  }, [id]);

  const refreshTags = useCallback(async () => {
    if (!id) return;
    const [preset, custom] = await Promise.all([
      messagesApi.getPresetTags(id).catch(() => [] as string[]),
      messagesApi.getCustomTags(id).catch(() => [] as { id: string; name: string; createdById: string; createdByName: string; createdAt: string }[]),
    ]);
    setPresetTags(preset);
    setCustomTags(custom);
    setMessageTagsLoaded(true);
  }, [id]);

  const refreshPharmacyTags = useCallback(async () => {
    if (!id) return;
    const categories = await messagesApi.getPharmacyTags(id).catch(() => []);
    setPharmacyTagCategories(categories);
  }, [id]);

  // 載入病人資料、檢驗數據、用藥數據、留言、生命徵象和呼吸器數據
  useEffect(() => {
    loadPatientBundle('initial');
  }, [loadPatientBundle]);

  useEffect(() => {
    if (!id || !patient || activeTab !== 'chat' || chatSessionsLoaded) return;
    void refreshChatSessions();
  }, [activeTab, chatSessionsLoaded, id, patient, refreshChatSessions]);

  useEffect(() => {
    if (!id || !patient || activeTab !== 'messages') return;
    if (!messagesLoaded) {
      void refreshMessagesOnly();
    }
    if (!messageTagsLoaded) {
      void Promise.all([refreshTags(), refreshPharmacyTags()]).then(() => {
        setMessageTagsLoaded(true);
      });
    }
  }, [
    activeTab,
    id,
    messageTagsLoaded,
    messagesLoaded,
    patient,
    refreshMessagesOnly,
    refreshPharmacyTags,
    refreshTags,
  ]);

  useEffect(() => {
    if (!id || !patient || activeTab !== 'meds' || scoresLoaded) return;
    void scores.loadLatestScores().finally(() => setScoresLoaded(true));
  }, [activeTab, id, patient, scores.loadLatestScores, scoresLoaded]);

  useEffect(() => {
    if (!id || !patient || activeTab !== 'labs' || weaningLoaded) return;
    void ventilatorApi.getWeaningAssessment(id)
      .then(setWeaningAssessment)
      .catch(() => setWeaningAssessment(null))
      .finally(() => setWeaningLoaded(true));
  }, [activeTab, id, patient, weaningLoaded]);

  // Auto-scroll to bottom when chat messages update (including during streaming)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Scroll detection: show "jump to latest" button when scrolled up >200px from bottom
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distFromBottom > 200);
  }, []);

  const handleRefreshMedications = useCallback(async () => {
    if (!id) return;
    setMedicationsLoading(true);
    try {
      const result = await medicationsApi.getMedications(id, { status: 'all' });
      setMedicationGroups(result.grouped || deriveMedicationGroups(result.medications));
    } catch { /* ignore */ } finally {
      setMedicationsLoading(false);
    }
  }, [id]);

  const handleCreateCustomTag = useCallback(async (name: string) => {
    if (!id) return;
    try {
      await messagesApi.createCustomTag(id, name);
      await refreshTags();
    } catch { /* toast handled in component */ }
  }, [id, refreshTags]);

  const handleDeleteCustomTag = useCallback(async (tagId: string) => {
    if (!id) return;
    try {
      await messagesApi.deleteCustomTag(id, tagId);
      await refreshTags();
    } catch { /* toast handled in component */ }
  }, [id, refreshTags]);

  // 發送留言板留言
  const handleSendBoardMessage = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[], mentionedUserIds?: string[]) => {
    if (!messageInput.trim() || !id) return;

    try {
      const newMessage = await messagesApi.sendMessage(id, {
        content: messageInput.trim(),
        messageType: 'general',
        replyToId,
        tags,
        mentionedRoles,
        mentionedUserIds,
      });
      if (replyToId) {
        await refreshMessagesOnly();
      } else {
        setMessages(prev => [newMessage, ...prev]);
      }
      setMessageInput('');
      toast.success('留言發送成功');
    } catch (err) {
      console.error('發送留言失敗:', err);
      toast.error('發送留言失敗');
    }
  }, [messageInput, id, refreshMessagesOnly]);

  // 發送用藥建議
  const handleSendMedicationAdvice = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[], mentionedUserIds?: string[]) => {
    if (!messageInput.trim() || !id) return;
    if (user?.role !== 'pharmacist') {
      toast.error('只有藥師可以發送用藥建議');
      return;
    }
    try {
      const newMessage = await messagesApi.sendMessage(id, {
        content: messageInput.trim(),
        messageType: 'medication-advice',
        replyToId,
        tags,
        mentionedRoles,
        mentionedUserIds,
      });
      if (replyToId) {
        await refreshMessagesOnly();
      } else {
        setMessages(prev => [newMessage, ...prev]);
      }
      setMessageInput('');
      toast.success('用藥建議發送成功');
    } catch (err) {
      console.error('發送用藥建議失敗:', err);
      toast.error('發送用藥建議失敗');
    }
  }, [messageInput, id, user?.role, refreshMessagesOnly]);

  // 更新留言標籤
  const handleUpdateMessageTags = useCallback(async (messageId: string, data: { add?: string[]; remove?: string[] }) => {
    if (!id) return;
    try {
      await messagesApi.updateMessageTags(id, messageId, data);
      await refreshMessagesOnly();
      toast.success('標籤已更新');
    } catch (err) {
      console.error('更新標籤失敗:', err);
      toast.error('更新標籤失敗');
    }
  }, [id, refreshMessagesOnly]);

  // 回覆藥事建議
  const handleRespondToAdvice = useCallback(async (adviceRecordId: string, accepted: boolean) => {
    try {
      await respondToAdvice(adviceRecordId, { accepted });
      toast.success(accepted ? '已接受藥事建議' : '已拒絕藥事建議');
      await refreshMessagesOnly();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('此建議已有回覆，無法重複操作');
      } else {
        toast.error('回覆藥事建議失敗');
      }
    }
  }, [refreshMessagesOnly]);

  // 標記單則已讀
  const handleMarkMessageRead = useCallback(async (messageId: string) => {
    if (!id) return;
    try {
      await messagesApi.markMessageRead(id, messageId);
      toast.success('已標記為已讀');
      await refreshMessagesOnly();
    } catch (err) {
      console.error('標記已讀失敗:', err);
      toast.error('標記已讀失敗');
    }
  }, [id, refreshMessagesOnly]);

  // 刪除留言（admin only）
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!id) return;
    try {
      await messagesApi.deletePatientMessage(id, messageId);
      toast.success('留言已刪除');
      await refreshMessagesOnly();
    } catch (err) {
      console.error('刪除留言失敗:', err);
      toast.error('刪除留言失敗');
    }
  }, [id, refreshMessagesOnly]);

  // 全部標為已讀
  const handleMarkAllRead = useCallback(async () => {
    if (!id) return;
    const unread = messages.filter(m => !m.isRead);
    if (unread.length === 0) return;
    try {
      await Promise.all(unread.map(m => messagesApi.markMessageRead(id, m.id).catch(() => null)));
      toast.success(`已標記 ${unread.length} 則留言為已讀`);
      await refreshMessagesOnly();
    } catch (err) {
      console.error('全部標為已讀失敗:', err);
      toast.error('全部標為已讀失敗');
    }
  }, [id, messages, refreshMessagesOnly]);

  // 格式化時間戳記
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return timestamp;
    }
  };

  // Loading 狀態
  if (patientLoading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-6">
        <LoadingSpinner size="lg" text="載入病人資料中..." />
      </div>
    );
  }

  // 錯誤狀態
  if (patientError) {
    return (
      <div className="p-6">
        <ErrorDisplay
          type="server"
          title="載入失敗"
          message={patientError}
          onRetry={() => window.location.reload()}
        />
        <div className="flex justify-center mt-4">
          <Button onClick={() => navigate('/patients')} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回病人清單
          </Button>
        </div>
      </div>
    );
  }

  // 找不到病患
  if (!patient) {
    return (
      <div className="p-6">
        <ErrorDisplay
          type="notFound"
          title="找不到病患"
          message="您所查詢的病患資料不存在或已被刪除"
        />
        <div className="flex justify-center mt-4">
          <Button onClick={() => navigate('/patients')} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回病人清單
          </Button>
        </div>
      </div>
    );
  }

  // 取得 S/A/N 資料（支援兩種格式）
  const getSedation = () => patient.sedation || patient.sanSummary?.sedation || [];
  const getAnalgesia = () => patient.analgesia || patient.sanSummary?.analgesia || [];
  const getNmb = () => patient.nmb || patient.sanSummary?.nmb || [];
  const canSendAiChat = true;
  const aiChatGateReason = '';
  const unreadMessageCount = messages.filter(m => !m.isRead).length;
  const showUnreadBadge = unreadMessageCount > 0 || (messages.length === 0 && !!patient.hasUnreadMessages);
  const unreadBadgeLabel = messages.length > 0 ? String(unreadMessageCount) : '新';

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm('確定要刪除此對話記錄嗎？')) return;
    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(sessionId);
      if (selectedSession?.id === sessionId) {
        setSelectedSession(null);
        setChatMessages([]);
        setSessionTitle('');
      }
      await refreshChatSessions();
      toast.success('對話記錄已刪除');
    } catch {
      toast.error('刪除對話記錄失敗');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedSessionIds.length === 0) return;
    if (!confirm(`確定要刪除所選的 ${selectedSessionIds.length} 筆對話記錄嗎？`)) return;
    setIsDeletingSessions(true);
    try {
      const ids = [...selectedSessionIds];
      await Promise.all(ids.map(id => deleteChatSession(id)));
      if (selectedSession && selectedSessionIds.includes(selectedSession.id)) {
        setSelectedSession(null);
        setChatMessages([]);
        setSessionTitle('');
      }
      setSelectedSessionIds([]);
      setIsSelectMode(false);
      await refreshChatSessions();
      toast.success(`已刪除 ${ids.length} 筆對話記錄`);
    } catch {
      toast.error('部分對話記錄刪除失敗');
    } finally {
      setIsDeletingSessions(false);
    }
  };

  const handleStartNewSession = async () => {
    setIsStartingSession(true);
    try {
      setSelectedSession(null);
      setChatMessages([]);
      setSessionTitle('');
      setSnapshotTakenAt(null);
    } finally {
      setIsStartingSession(false);
    }
  };

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds(prev =>
      prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
    );
  };

  const handleToggleSelectMode = () => {
    setIsSelectMode(prev => !prev);
    setSelectedSessionIds([]);
  };

  const handleSelectAllSessions = () => {
    if (selectedSessionIds.length === chatSessions.length) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(chatSessions.map(s => s.id));
    }
  };

  const handleToggleSessionList = () => {
    setShowSessionList(prev => !prev);
  };

  const handleJumpToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Open a session: load messages from API and update chat state.
  // Lifted out of the inline JSX (was inside the session-row onClick) so
  // PatientChatTab can stay purely presentational.
  const handleOpenSession = async (session: ChatSession) => {
    setSelectedSession(session);
    setSessionTitle(session.title);
    setSnapshotTakenAt(null);
    try {
      const detail = await fetchChatSessionApi(session.id);
      setChatMessages((detail.messages || []).map(m => {
        let ts: string | undefined;
        if (m.timestamp) {
          try { ts = new Date(m.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }); } catch { ts = undefined; }
        }
        return {
          role: (m.role === 'assistant' ? 'assistant' : 'user'),
          content: m.content,
          explanation: m.explanation || null,
          timestamp: ts,
          references: m.citations || [],
          warnings: m.safetyWarnings || null,
          requiresExpertReview: m.requiresExpertReview || false,
          degraded: m.degraded || false,
          degradedReason: m.degradedReason || null,
          upstreamStatus: m.upstreamStatus || null,
          dataFreshness: m.dataFreshness || null,
        };
      }));
      // F-PARITY: pick up the same snapshotTakenAt the sidebar version uses
      // so the freshness pill renders here too.
      setSnapshotTakenAt(detail.session?.snapshotTakenAt ?? null);
    } catch {
      toast.error('載入對話內容失敗');
      setChatMessages([]);
    }
  };

  // F-PARITY: same handler as ai-chat.tsx — calls the F2 backend endpoint
  // to rebuild critical snapshot + queue deferred fill, then bumps the
  // local timestamp so the pill reads "剛剛".
  const handleRefreshSnapshot = async () => {
    if (!selectedSession) return;
    if (isSending) {
      toast.error('請先按停止才能重新整理快照');
      return;
    }
    setRefreshingSnapshot(true);
    try {
      const result = await refreshChatSessionSnapshot(selectedSession.id);
      setSnapshotTakenAt(result.snapshotTakenAt);
      toast.success('已重新整理病患快照');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '重新整理快照失敗';
      toast.error(msg);
    } finally {
      setRefreshingSnapshot(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return;
    if (!canSendAiChat) {
      toast.error(aiChatGateReason);
      return;
    }

    const userMessage = chatInput.trim();
    const nowTime = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const messagesWithUser = [
      ...chatMessages,
      { role: 'user' as const, content: userMessage, timestamp: nowTime }
    ];
    setChatMessages(messagesWithUser);
    setChatInput('');
    setIsSending(true);

    // Optimistically add a temporary session to the left list so the user sees
    // the new conversation immediately instead of waiting for the stream to finish.
    // When the stream completes, refreshChatSessions() wipes and refetches, which
    // replaces this tmp entry with the real one from the backend.
    const optimisticSessionId = selectedSession ? null : `tmp-${Date.now()}`;
    if (optimisticSessionId) {
      const now = new Date();
      const optimisticTitle = sessionTitle.trim() || userMessage.slice(0, 50);
      setChatSessions(prev => [
        {
          id: optimisticSessionId,
          patientId: id || patient?.id || '',
          sessionDate: now.toISOString().split('T')[0],
          sessionTime: now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
          title: optimisticTitle,
          messages: [],
          lastUpdated: now.toLocaleString('zh-TW'),
          messageCount: 1,
        },
        ...prev,
      ]);
    }

    try {
      setChatMessages([
        ...messagesWithUser,
        {
          role: 'assistant',
          content: '',
        },
      ]);

      const response = await new Promise<ChatResponse>((resolve, reject) => {
        let rawBuffer = '';
        // Coalesce delta paints on rAF so we re-render at most once per frame (~60fps)
        // instead of once per token — keeps the streaming cursor smooth on long answers.
        let pendingRaf: number | null = null;
        const flush = () => {
          pendingRaf = null;
          const mainContent = extractStreamMainContent(rawBuffer);
          setChatMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (last?.role !== 'assistant') return prev;
            next[lastIndex] = { ...last, content: mainContent };
            return next;
          });
        };
        streamChatMessage({
          message: userMessage,
          patientId: id,
          sessionId: selectedSession?.id,
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
            if (pendingRaf != null) return;
            pendingRaf = requestAnimationFrame(flush);
          },
          onComplete: (streamResult) => {
            if (pendingRaf != null) {
              cancelAnimationFrame(pendingRaf);
              pendingRaf = null;
            }
            flush();
            resolve(streamResult);
          },
          onError: (error) => {
            if (pendingRaf != null) {
              cancelAnimationFrame(pendingRaf);
              pendingRaf = null;
            }
            reject(error);
          },
        });
      });

      // Backend currently returns main + 【說明/補充】 concatenated in `content`
      // and `explanation: null`. Until backend splits server-side, do it here
      // as a fallback so the expandable detail panel actually gets populated.
      // Prefer backend's explanation if it ever arrives non-empty.
      const rawContent = response.message.content || '';
      const backendExplanation = response.message.explanation;
      let mainContent = rawContent;
      let detailContent: string | null = backendExplanation || null;
      if (!detailContent) {
        const split = splitMainAndDetail(rawContent);
        mainContent = split.main;
        detailContent = split.detail;
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: mainContent,
        messageId: response.message.id,
        explanation: detailContent,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        feedback: null,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        // F-PARITY: F3 deep-link refs from this turn's prefetch (currently
        // pharmacy advice). Live-only — same pattern as ai-chat.tsx.
        adviceRefs: response.prefetchRefs?.adviceRefs ?? [],
      };

      const finalMessages = [
        ...messagesWithUser,
        assistantMsg,
      ];
      setChatMessages(finalMessages);

      // F-PARITY: first turn just built the snapshot — show the freshness
      // pill immediately at "剛剛" so users see the baseline. Server-side
      // timestamp differs by a few ms but doesn't matter for "N 分鐘前".
      if (!snapshotTakenAt) {
        setSnapshotTakenAt(new Date().toISOString());
      }

      // If this is a new session, persist the user-provided title (optional)
      if (!selectedSession) {
        if (sessionTitle.trim()) {
          try {
            await updateChatSessionTitle(response.sessionId, sessionTitle.trim());
          } catch {
            // Non-blocking: chat still works even if title update fails
          }
        }
	        await refreshChatSessions();
	        setSelectedSession({
	          id: response.sessionId,
	          patientId: id || patient.id,
	          sessionDate: new Date().toISOString().split('T')[0],
	          sessionTime: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
	          // Keep title consistent with backend default (first user message) unless user provided one.
	          title: sessionTitle.trim() || userMessage.slice(0, 50),
	          messages: [],
	          lastUpdated: new Date().toLocaleString('zh-TW'),
	        });
      } else {
        // Keep list metadata fresh
        await refreshChatSessions();
      }
    } catch (err) {
      // Roll back the optimistic session entry — the backend did not persist it
      if (optimisticSessionId) {
        setChatSessions(prev => prev.filter(s => s.id !== optimisticSessionId));
      }
      console.error('AI 回覆失敗:', err);
      let errorMessage = 'AI 助手目前無法回應，請確認後端服務是否正常運行，稍後再試。';
      if (isAxiosError(err)) {
        const data = err.response?.data as { message?: unknown; detail?: unknown } | undefined;
        const detail = (data?.message ?? data?.detail);
        if (typeof detail === 'string' && detail.trim()) {
          errorMessage = `AI 服務暫時不可用：${detail}`;
        } else if (err.response) {
          errorMessage = `AI 服務錯誤（HTTP ${err.response.status}）`;
        }
      } else if (err instanceof Error && err.message) {
        errorMessage = `AI 回覆失敗：${err.message}`;
      }
      setChatMessages([
        ...messagesWithUser,
        {
          role: 'assistant',
          content: errorMessage
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSetMessageFeedback = async (msgIndex: number, feedback: 'up' | 'down' | null) => {
    const msg = chatMessages[msgIndex];
    if (!msg || msg.role !== 'assistant' || !msg.messageId) return;
    if (feedbackingMessageIndex !== null || regeneratingMessageIndex !== null) return;

    const newFeedback = msg.feedback === feedback ? null : feedback;
    setChatMessages((prev) => {
      const next = [...prev];
      next[msgIndex] = { ...next[msgIndex], feedback: newFeedback };
      return next;
    });
    setFeedbackingMessageIndex(msgIndex);
    try {
      await updateMessageFeedback(msg.messageId, newFeedback);
    } catch {
      setChatMessages((prev) => {
        const next = [...prev];
        next[msgIndex] = { ...next[msgIndex], feedback: msg.feedback };
        return next;
      });
      toast.error('回饋儲存失敗');
    } finally {
      setFeedbackingMessageIndex(null);
    }
  };

  const handleRegenerateMessage = async (msgIndex: number) => {
    if (isSending || feedbackingMessageIndex !== null || regeneratingMessageIndex !== null) return;
    const assistantMsg = chatMessages[msgIndex];
    if (!assistantMsg || assistantMsg.role !== 'assistant') return;

    let userMsgIndex = msgIndex - 1;
    while (userMsgIndex >= 0 && chatMessages[userMsgIndex].role !== 'user') {
      userMsgIndex--;
    }
    if (userMsgIndex < 0) return;

    const userMessage = chatMessages[userMsgIndex].content;
    if (!id) return;

    const messagesBeforeAssistant = chatMessages.slice(0, msgIndex);
    setChatMessages([...messagesBeforeAssistant, { role: 'assistant', content: '' }]);
    setIsSending(true);
    setRegeneratingMessageIndex(msgIndex);

    try {
      const response = await new Promise<ChatResponse>((resolve, reject) => {
        let rawBuffer = '';
        // Coalesce delta paints on rAF — same rationale as handleSendMessage.
        let pendingRaf: number | null = null;
        const flush = () => {
          pendingRaf = null;
          const mainContent = extractStreamMainContent(rawBuffer);
          setChatMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (last?.role !== 'assistant') return prev;
            next[lastIndex] = { ...last, content: mainContent };
            return next;
          });
        };
        streamChatMessage({
          message: userMessage,
          patientId: id,
          sessionId: selectedSession?.id,
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
            if (pendingRaf != null) return;
            pendingRaf = requestAnimationFrame(flush);
          },
          onComplete: (streamResult) => {
            if (pendingRaf != null) {
              cancelAnimationFrame(pendingRaf);
              pendingRaf = null;
            }
            flush();
            resolve(streamResult);
          },
          onError: (error) => {
            if (pendingRaf != null) {
              cancelAnimationFrame(pendingRaf);
              pendingRaf = null;
            }
            reject(error);
          },
        });
      });

      // Same local split fallback as handleSendMessage (see that function for why)
      const rawRegenContent = response.message.content || '';
      const backendRegenExplanation = response.message.explanation;
      let regenMain = rawRegenContent;
      let regenDetail: string | null = backendRegenExplanation || null;
      if (!regenDetail) {
        const split = splitMainAndDetail(rawRegenContent);
        regenMain = split.main;
        regenDetail = split.detail;
      }

      const newAssistantMsg: ChatMessage = {
        role: 'assistant',
        content: regenMain,
        messageId: response.message.id,
        explanation: regenDetail,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        feedback: null,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessages([...messagesBeforeAssistant, newAssistantMsg]);
    } catch {
      setChatMessages([
        ...messagesBeforeAssistant,
        { role: 'assistant', content: '重新生成失敗，請稍後再試。' },
      ]);
    } finally {
      setIsSending(false);
      setRegeneratingMessageIndex(null);
    }
  };

  const daysAdmitted = Math.floor(
    (new Date().getTime() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const painMedications = medicationGroups.analgesia;
  const sedationMedications = medicationGroups.sedation;
  const nmbMedications = medicationGroups.nmb;
  const otherMedications = medicationGroups.other;
  const outpatientMedications = medicationGroups.outpatient || [];

  const nmbIndication = nmbMedications[0]?.indication;

  const respiratoryRate = vitalSigns?.respiratoryRate;
  const temperature = vitalSigns?.temperature;
  const systolicBP = vitalSigns?.bloodPressure?.systolic;
  const diastolicBP = vitalSigns?.bloodPressure?.diastolic;
  const heartRate = vitalSigns?.heartRate;
  const spo2 = vitalSigns?.spo2;
  const etco2 = vitalSigns?.etco2;
  const cvp = vitalSigns?.cvp;
  const icp = vitalSigns?.icp;
  const bodyWeight = patient?.weight;

  const ventTimestamp = ventilator?.timestamp;
  const ventMode = ventilator?.mode;
  const ventFiO2 = ventilator?.fio2;
  const ventPeep = ventilator?.peep;
  const ventTidalVolume = ventilator?.tidalVolume;
  const ventRespRate = ventilator?.respiratoryRate;
  const ventPip = ventilator?.pip;
  const ventPlateau = ventilator?.plateau;
  const ventCompliance = ventilator?.compliance;

  const handleVitalSignClick = (labName: string, value: number, unit: string, source: TrendSource = 'vital') => {
    setSelectedTrendMetric({
      name: labName,
      nameChinese: LAB_CHINESE_NAMES_MAP[labName] || labName,
      unit,
      value,
      source,
    });
  };

  return (
    <div className="p-4 space-y-4">
      {/* 頁首資訊條 */}
      <Card className="border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/patients')} className="hover:bg-slate-50 dark:hover:bg-slate-800" title="返回病人清單">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-brand text-white flex items-center justify-center font-bold text-2xl shadow-lg">
                  {patient.bedNumber || '-'}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-bold text-[#3c7acb]">{maskPatientName(patient.name)}</h1>
                    <span className="text-base text-slate-500 dark:text-slate-400">
                      {patient.age}歲 / {patient.gender === 'M' || patient.gender === '男' ? '男' : '女'}
                    </span>
                    {patient.bloodType && (
                      <Badge variant="outline" className="border-red-200 text-red-700 font-semibold dark:border-red-700 dark:text-red-300">
                        <Droplet className="mr-1 h-3 w-3" />{patient.bloodType}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
                    {patient.medicalRecordNumber && (
                      <span className="text-slate-500 dark:text-slate-400">病歷號 {patient.medicalRecordNumber}</span>
                    )}
                    {patient.department && (
                      <span className="text-slate-500 dark:text-slate-400">{patient.department}</span>
                    )}
                    {patient.attendingPhysician && (
                      <span className="text-slate-500 dark:text-slate-400">主治：{patient.attendingPhysician}</span>
                    )}
                    <span className="flex items-center gap-1 bg-white dark:bg-slate-800 px-3 py-1 rounded-full">
                      <Clock className="h-3.5 w-3.5" />
                      住院 {daysAdmitted} 天
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* 臨床旗標 badges */}
              {patient.intubated && (
                <Badge className="bg-[#d1cbf7] text-brand hover:bg-[#d1cbf7]/90 dark:bg-[#4a2f5c] dark:text-[#efe3ff] dark:hover:bg-[#4a2f5c]/90">
                  {getAirwayStatusLabel(patient)}
                </Badge>
              )}
              {patient.hasDNR && (
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100/90 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700">
                  <Shield className="mr-1 h-3 w-3" />DNR
                </Badge>
              )}
              {patient.isIsolated && (
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100/90 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                  隔離中
                </Badge>
              )}
              {user?.role === 'admin' && (
                <Button className="bg-brand hover:bg-brand-hover" onClick={() => setEditingPatient({ ...patient })}>編輯基本資料</Button>
              )}
            </div>
          </div>
          {/* 過敏 + 診斷 + alerts */}
          {((patient.allergies && patient.allergies.length > 0) || patient.diagnosis || (patient.alerts && patient.alerts.length > 0)) && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
              {patient.allergies && patient.allergies.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-md bg-red-50 border border-red-200 dark:bg-red-900/30 dark:border-red-800">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-xs font-semibold text-red-700 dark:text-red-300">過敏：</span>
                  {patient.allergies.map((allergy: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="border-red-300 bg-red-100 text-red-800 text-xs font-semibold dark:bg-red-900/50 dark:text-red-200 dark:border-red-700">
                      {allergy}
                    </Badge>
                  ))}
                </div>
              )}
              {patient.diagnosis && patient.diagnosis !== '待確認' && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">診斷：</span>{patient.diagnosis}
                </p>
              )}
              {patient.alerts && patient.alerts.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  {patient.alerts.map((alert: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                      {alert}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分頁內容 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 h-[44px] bg-slate-50 dark:bg-slate-800 border border-border gap-0.5 p-0.5">
          <TabsTrigger value="chat" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white rounded-md">
            <MessageSquare className="mr-1.5 h-4 w-4" />
            對話助手
          </TabsTrigger>
          <TabsTrigger value="messages" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white relative rounded-md">
            <MessagesSquare className="mr-1.5 h-4 w-4" />
            留言板
            {showUnreadBadge && (
              <Badge className="ml-2 bg-[#ff3975] text-white px-2 py-0.5 text-xs">
                {unreadBadgeLabel}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="records" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white rounded-md">
            <FileText className="mr-1.5 h-4 w-4" />
            病歷記錄
          </TabsTrigger>
          <TabsTrigger value="labs" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white rounded-md">
            <TestTube className="mr-1.5 h-4 w-4" />
            檢驗數據
          </TabsTrigger>
          <TabsTrigger value="meds" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white rounded-md">
            <Pill className="mr-1.5 h-4 w-4" />
            用藥
          </TabsTrigger>
          <TabsTrigger value="summary" className="text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-white rounded-md">
            <FileText className="mr-1.5 h-4 w-4" />
            病歷摘要
          </TabsTrigger>
        </TabsList>

        {/* 對話助手 — 已抽出至 PatientChatTab (Phase 3.2) */}
        <PatientChatTab
          chatSessions={chatSessions}
          chatSessionsLoading={chatSessionsLoading}
          selectedSession={selectedSession}
          showSessionList={showSessionList}
          onToggleSessionList={handleToggleSessionList}
          isSelectMode={isSelectMode}
          onToggleSelectMode={handleToggleSelectMode}
          selectedSessionIds={selectedSessionIds}
          onToggleSessionSelection={toggleSessionSelection}
          onSelectAllSessions={handleSelectAllSessions}
          onBatchDelete={handleBatchDelete}
          isDeletingSessions={isDeletingSessions}
          isStartingSession={isStartingSession}
          onStartNewSession={handleStartNewSession}
          onOpenSession={handleOpenSession}
          onDeleteSession={handleDeleteSession}
          deletingSessionId={deletingSessionId}
          chatMessages={chatMessages}
          isSending={isSending}
          feedbackingMessageIndex={feedbackingMessageIndex}
          regeneratingMessageIndex={regeneratingMessageIndex}
          expandedExplanations={expandedExplanations}
          expandedReferences={expandedReferences}
          expandedDataQuality={expandedDataQuality}
          onSetExpandedExplanations={setExpandedExplanations}
          onSetExpandedReferences={setExpandedReferences}
          onSetExpandedDataQuality={setExpandedDataQuality}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          showScrollToBottom={showScrollToBottom}
          onMessagesScroll={handleMessagesScroll}
          onJumpToLatest={handleJumpToLatest}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          chatInputRef={chatInputRef}
          onSendMessage={handleSendMessage}
          canSendAiChat={canSendAiChat}
          onSetMessageFeedback={handleSetMessageFeedback}
          onRegenerateMessage={handleRegenerateMessage}
          formatSnapshotValue={formatSnapshotValue}
          formatCitationPageText={formatCitationPageText}
          formatAiDegradedReason={formatAiDegradedReason}
          getDisplayFreshnessHints={getDisplayFreshnessHints}
          compactSnippet={compactSnippet}
          chatBotAvatar={chatBotAvatar}
          snapshotTakenAt={snapshotTakenAt}
          refreshingSnapshot={refreshingSnapshot}
          onRefreshSnapshot={handleRefreshSnapshot}
        />

        {/* 留言板 — Phase 3.4: lazy-loaded, only mount when active to avoid Suspense flash. */}
        {activeTab === 'messages' && (
          <Suspense fallback={<TabsContent value="messages" className="py-12"><LoadingSpinner size="lg" text="載入中..." /></TabsContent>}>
            <PatientMessagesTab
              patientId={id}
              userId={user?.id}
              userRole={user?.role}
              messages={messages}
              messagesLoading={messagesLoading}
              messageInput={messageInput}
              onMessageInputChange={setMessageInput}
              onSendGeneralMessage={handleSendBoardMessage}
              onSendMedicationAdvice={handleSendMedicationAdvice}
              onMarkAllRead={handleMarkAllRead}
              onMarkMessageRead={handleMarkMessageRead}
              formatTimestamp={formatTimestamp}
              presetTags={presetTags}
              pharmacyTagCategories={pharmacyTagCategories}
              customTags={customTags}
              onCreateCustomTag={handleCreateCustomTag}
              onDeleteCustomTag={handleDeleteCustomTag}
              onUpdateTags={handleUpdateMessageTags}
              onRespondToAdvice={handleRespondToAdvice}
              onDeleteMessage={handleDeleteMessage}
            />
          </Suspense>
        )}

        {/* 病歷記錄 — Phase 3.4: lazy-loaded; Suspense sits inside TabsContent so fallback only fires on activation. */}
        <TabsContent value="records" className="space-y-4">
          <Suspense fallback={<LoadingSpinner size="lg" text="載入中..." className="py-12" />}>
            <MedicalRecords
              patientId={patient.id}
              patientName={maskPatientName(patient.name)}
              labData={labData}
              medications={allMedications}
            />
          </Suspense>
        </TabsContent>

        {/* 檢驗數據 */}
        {/* 檢驗 + 微生物 — Phase 3.4: lazy-loaded, only mount when active. */}
        {activeTab === 'labs' && (
          <Suspense fallback={<TabsContent value="labs" className="py-12"><LoadingSpinner size="lg" text="載入中..." /></TabsContent>}>
            <PatientLabsTab
              patientId={patient.id}
              patientIntubated={!!patient.intubated}
              labData={labData}
              vitalSignsLoading={vitalSignsLoading}
              vitalSignsTimestamp={vitalSigns?.timestamp}
              respiratoryRate={respiratoryRate}
              temperature={temperature}
              systolicBP={systolicBP}
              diastolicBP={diastolicBP}
              heartRate={heartRate}
              spo2={spo2}
              cvp={cvp}
              icp={icp}
              bodyWeight={bodyWeight}
              bodyHeight={patient?.height}
              ventilatorLoading={ventilatorLoading}
              ventTimestamp={ventTimestamp}
              ventMode={ventMode}
              ventFiO2={ventFiO2}
              ventPeep={ventPeep}
              ventTidalVolume={ventTidalVolume}
              ventRespRate={ventRespRate}
              ventPip={ventPip}
              ventPlateau={ventPlateau}
              ventCompliance={ventCompliance}
              weaningAssessment={weaningAssessment}
              formatDisplayTimestamp={formatDisplayTimestamp}
              formatDisplayValue={formatDisplayValue}
              onVitalSignClick={handleVitalSignClick}
              isAdmin={user?.role === 'admin'}
              onVitalSignsUpdate={(vs) => setVitalSigns(vs)}
              onVentilatorUpdate={(v) => setVentilator(v)}
            />
          </Suspense>
        )}

        {/* 用藥 — Phase 3.4: lazy-loaded, only mount when active. */}
        {activeTab === 'meds' && (
          <Suspense fallback={<TabsContent value="meds" className="py-12"><LoadingSpinner size="lg" text="載入中..." /></TabsContent>}>
            <PatientMedicationsTab
              patientId={id}
              userRole={user?.role}
              medicationsLoading={medicationsLoading}
              nmbIndication={nmbIndication}
              painMedications={painMedications}
              sedationMedications={sedationMedications}
              nmbMedications={nmbMedications}
              otherMedications={otherMedications}
              outpatientMedications={outpatientMedications}
              formatDisplayValue={formatDisplayValue}
              formatMedicationRegimen={formatMedicationRegimen}
              painScoreValue={scores.painScoreValue}
              rassScoreValue={scores.rassScoreValue}
              painScoreTimestamp={scores.painScoreTimestamp}
              rassScoreTimestamp={scores.rassScoreTimestamp}
              onRecordScore={scores.handleRecordScore}
              onOpenScoreTrend={scores.handleOpenScoreTrend}
              scoreTrendOpen={scores.scoreTrendOpen}
              scoreTrendType={scores.scoreTrendType}
              scoreTrendData={scores.scoreTrendData}
              scoreEntries={scores.scoreEntries}
              onDeleteScoreEntry={scores.handleDeleteScoreEntry}
              onCloseScoreTrend={scores.closeScoreTrend}
              onRefreshMedications={handleRefreshMedications}
            />
          </Suspense>
        )}

        {/* 病歷摘要 — Phase 3.4: lazy-loaded; Suspense sits inside TabsContent so fallback only fires on activation. */}
        <TabsContent value="summary" className="space-y-4">
          <Suspense fallback={<LoadingSpinner size="lg" text="載入中..." className="py-12" />}>
            <PatientSummaryTab
              patient={patient}
              userRole={user?.role}
              onNavigateToMeds={() => setActiveTab('meds')}
            />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* 檢驗數據頁折線圖對話框 */}
      {selectedTrendMetric && (
        <Suspense fallback={null}>
          <LabTrendChart
            isOpen={!!selectedTrendMetric}
            onClose={() => setSelectedTrendMetric(null)}
            labName={selectedTrendMetric.name}
            labNameChinese={selectedTrendMetric.nameChinese}
            unit={selectedTrendMetric.unit}
            trendData={trendChartData}
          />
        </Suspense>
      )}

      {/* 編輯病人資料對話框 */}
      <PatientEditDialog
        patient={editingPatient}
        onPatientChange={setEditingPatient}
        onCancel={() => setEditingPatient(null)}
        onSave={handleEditSave}
        isSaving={savingPatient}
      />
    </div>
  );
}
