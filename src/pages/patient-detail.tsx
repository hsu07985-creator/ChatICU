import { MedicalRecords } from '../components/medical-records';
import { LabTrendChart, LabTrendData } from '../components/lab-trend-chart';
import { VitalSignCard } from '../components/vital-signs-card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  streamChatMessage,
  getChatSessions as fetchChatSessionsApi,
  getChatSession as fetchChatSessionApi,
  updateChatSessionTitle,
  deleteChatSession,
  getRAGStatus,
  getAIReadiness,
  getReadinessReason,
  type AIReadiness,
  type ChatResponse,
  type Citation as AiCitation,
  type DataFreshness,
  type RAGStatus,
} from '../lib/api/ai';
import { patientsApi, labDataApi, medicationsApi, messagesApi, vitalSignsApi, ventilatorApi, type Patient, type LabData, type Medication, type PatientMessage, type VitalSigns, type VentilatorSettings, type WeaningAssessment } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard-utils';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
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
import { PatientSummaryTab } from '../components/patient/patient-summary-tab';
import { PatientLabsTab } from '../components/patient/patient-labs-tab';
import { PatientMedicationsTab } from '../components/patient/patient-medications-tab';
import { getLatestScores, recordScore, getScoreTrends } from '../lib/api/scores';
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
  ArrowDown
} from 'lucide-react';
import { LabDataDisplay } from '../components/lab-data-display';
import chatBotAvatar from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';

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
  pH: '酸鹼值', PCO2: '二氧化碳分壓', PO2: '氧分壓', Lactate: '乳酸'
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
  explanation?: string | null;
  timestamp?: string;
  references?: AiCitation[];
  warnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
}

interface MedicationGroups {
  sedation: Medication[];
  analgesia: Medication[];
  nmb: Medication[];
  other: Medication[];
}

const EMPTY_MEDICATION_GROUPS: MedicationGroups = {
  sedation: [],
  analgesia: [],
  nmb: [],
  other: [],
};

const MED_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  antibiotic: { label: '抗生素', color: 'bg-amber-100 text-amber-800' },
  antifungal: { label: '抗黴菌', color: 'bg-amber-100 text-amber-800' },
  antiviral: { label: '抗病毒', color: 'bg-amber-100 text-amber-800' },
  vasopressor: { label: '升壓劑', color: 'bg-red-100 text-red-800' },
  anticoagulant: { label: '抗凝血', color: 'bg-rose-100 text-rose-800' },
  steroid: { label: '類固醇', color: 'bg-orange-100 text-orange-800' },
  ppi: { label: 'PPI', color: 'bg-sky-100 text-sky-800' },
  h2_blocker: { label: 'H2 Blocker', color: 'bg-sky-100 text-sky-800' },
  diuretic: { label: '利尿劑', color: 'bg-cyan-100 text-cyan-800' },
  insulin: { label: '胰島素', color: 'bg-teal-100 text-teal-800' },
  electrolyte: { label: '電解質', color: 'bg-emerald-100 text-emerald-800' },
  bronchodilator: { label: '支氣管擴張', color: 'bg-indigo-100 text-indigo-800' },
  antiarrhythmic: { label: '抗心律不整', color: 'bg-pink-100 text-pink-800' },
  antiepileptic: { label: '抗癲癇', color: 'bg-purple-100 text-purple-800' },
  laxative: { label: '緩瀉劑', color: 'bg-lime-100 text-lime-800' },
  antiemetic: { label: '止吐', color: 'bg-green-100 text-green-800' },
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function formatDisplayTimestamp(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW');
}

type TrendSource = 'vital' | 'ventilator';

function formatTrendAxisLabel(timestamp?: string | null): string {
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

function getVitalTrendValue(record: VitalSigns, itemName: string): number | undefined {
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
    case 'EtCO2':
      return record.etco2 ?? undefined;
    case 'CVP':
      return record.cvp ?? undefined;
    case 'ICP':
      return record.icp ?? undefined;
    default:
      return undefined;
  }
}

function getVentilatorTrendValue(record: VentilatorSettings, itemName: string): number | undefined {
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

function normalizeSanCategory(raw: unknown): 'S' | 'A' | 'N' | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'S' || normalized === 'A' || normalized === 'N') {
    return normalized;
  }
  return null;
}

function formatMedicationRegimen(med: Medication): string {
  const dose = formatDisplayValue(med.dose);
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
  };

  for (const med of items) {
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

  return grouped;
}

function createReadinessFallback(reason: string): AIReadiness {
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
  const [expandedExplanations, setExpandedExplanations] = useState<Set<number>>(new Set());
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(new Set());
  const [expandedDataQuality, setExpandedDataQuality] = useState<Set<number>>(new Set());
  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // RAG 索引狀態
  const [ragStatus, setRagStatus] = useState<RAGStatus | null>(null);
  const [aiReadiness, setAiReadiness] = useState<AIReadiness | null>(null);
  const [isCheckingAiReadiness, setIsCheckingAiReadiness] = useState(false);

  // 病人資料狀態
  const [patient, setPatient] = useState<PatientWithFrontendFields | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError, setPatientError] = useState<string | null>(null);

  // 檢驗數據狀態
  const [labData, setLabData] = useState<LabData>(defaultLabData);
  const [labDataLoading, setLabDataLoading] = useState(false);

  // 用藥數據狀態
  const [medicationGroups, setMedicationGroups] = useState<MedicationGroups>(EMPTY_MEDICATION_GROUPS);
  const [medicationsLoading, setMedicationsLoading] = useState(false);

  // 臨床評分狀態
  const [painScoreValue, setPainScoreValue] = useState<number | null>(null);
  const [rassScoreValue, setRassScoreValue] = useState<number | null>(null);
  const [scoreTrendOpen, setScoreTrendOpen] = useState(false);
  const [scoreTrendType, setScoreTrendType] = useState<'pain' | 'rass'>('pain');
  const [scoreTrendData, setScoreTrendData] = useState<{ date: string; value: number }[]>([]);

  // 留言板狀態
  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

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

  // 檢驗數據頁折線圖狀態（生命徵象 / 呼吸器）
  const [selectedTrendMetric, setSelectedTrendMetric] = useState<{
    name: string;
    nameChinese: string;
    unit: string;
    value: number;
    source: TrendSource;
  } | null>(null);

  // 趨勢資料狀態
  const [trendChartData, setTrendChartData] = useState<LabTrendData[]>([]);
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
      } else {
        setIsRefreshingPatientData(true);
      }

      setMedicationsLoading(true);
      setMessagesLoading(true);
      setVitalSignsLoading(true);
      setVentilatorLoading(true);
      setLabDataLoading(true);

      // 同時載入所有數據
      const [patientData, labDataResult, medicationsResult, messagesResult, vitalSignsResult, ventilatorResult, weaningResult] = await Promise.all([
        patientsApi.getPatient(id),
        labDataApi.getLatestLabData(id).catch(() => defaultLabData),
        medicationsApi.getMedications(id, { status: 'active' }).catch(() => ({ medications: [], grouped: EMPTY_MEDICATION_GROUPS, interactions: [] })),
        messagesApi.getMessages(id).catch(() => ({ messages: [], total: 0, unreadCount: 0 })),
        vitalSignsApi.getLatestVitalSigns(id).catch(() => null),
        ventilatorApi.getLatestVentilatorSettings(id).catch(() => null),
        ventilatorApi.getWeaningAssessment(id).catch(() => null)
      ]);

      setPatient(patientData as PatientWithFrontendFields);
      setLabData(labDataResult);
      setMedicationGroups(medicationsResult.grouped || deriveMedicationGroups(medicationsResult.medications));
      setMessages(messagesResult.messages);
      setUnreadCount(messagesResult.unreadCount);
      setVitalSigns(vitalSignsResult);
      setVentilator(ventilatorResult);
      setWeaningAssessment(weaningResult);

      // 載入臨床評分
      try {
        const latest = await getLatestScores(id);
        setPainScoreValue(latest.pain?.value ?? null);
        setRassScoreValue(latest.rass?.value ?? null);
      } catch {
        // scores endpoint may not exist yet — ignore
      }

      // 載入對話記錄
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
      } catch {
        setChatSessions([]);
      }

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
      setMessagesLoading(false);
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
      setUnreadCount(res.unreadCount);
    } catch (err) {
      console.error('重新載入留言失敗:', err);
      toast.error('重新載入留言失敗');
    } finally {
      setMessagesLoading(false);
    }
  }, [id]);

  // 載入病人資料、檢驗數據、用藥數據、留言、生命徵象和呼吸器數據
  useEffect(() => {
    loadPatientBundle('initial');
  }, [loadPatientBundle]);

  const refreshAiReadiness = useCallback(async () => {
    setIsCheckingAiReadiness(true);
    try {
      const readiness = await getAIReadiness();
      setAiReadiness(readiness);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[INTG][AI][API][AO-01] readiness check failed:', reason);
      setAiReadiness(createReadinessFallback(reason));
    } finally {
      setIsCheckingAiReadiness(false);
    }
  }, []);

  useEffect(() => {
    refreshAiReadiness();
  }, [refreshAiReadiness]);

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

  // P3-6: 載入 RAG 索引狀態
  useEffect(() => {
    getRAGStatus().then(setRagStatus).catch(() => setRagStatus(null));
  }, []);

  // 檢驗數據頁：選取生命徵象/呼吸器項目時，從對應 API 載入趨勢資料
  useEffect(() => {
    if (!selectedTrendMetric || !id) {
      setTrendChartData([]);
      return;
    }

    const fetchTrend = async () => {
      try {
        const points: LabTrendData[] = [];

        if (selectedTrendMetric.source === 'vital') {
          const response = await vitalSignsApi.getVitalSignsTrends(id, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVitalTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({
                date: formatTrendAxisLabel(record.timestamp),
                value: trendValue,
              });
            }
          }
        } else if (selectedTrendMetric.source === 'ventilator') {
          const response = await ventilatorApi.getVentilatorTrends(id, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVentilatorTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({
                date: formatTrendAxisLabel(record.timestamp),
                value: trendValue,
              });
            }
          }
        }

        if (points.length === 0) {
          points.push({
            date: '目前',
            value: selectedTrendMetric.value,
          });
        }

        setTrendChartData(points);
      } catch {
        setTrendChartData([
          {
            date: '目前',
            value: selectedTrendMetric.value,
          },
        ]);
      }
    };

    fetchTrend();
  }, [selectedTrendMetric, id]);

  // 發送留言板留言
  const handleSendBoardMessage = async () => {
    if (!messageInput.trim() || !id) return;

    try {
      const newMessage = await messagesApi.sendMessage(id, {
        content: messageInput.trim(),
        messageType: 'general'
      });
      setMessages(prev => [newMessage, ...prev]);
      setMessageInput('');
      toast.success('留言發送成功');
    } catch (err) {
      console.error('發送留言失敗:', err);
      toast.error('發送留言失敗');
    }
  };

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
  const canSendAiChat = aiReadiness ? aiReadiness.feature_gates.chat : true;
  const aiChatGateReason = getReadinessReason(aiReadiness, 'chat');

  const refreshChatSessions = async () => {
    if (!id) return;
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
    } catch {
      setChatSessions([]);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm('確定要刪除此對話記錄嗎？')) return;
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
    // Force clear via DOM ref as safety net (prevents stale textarea state)
    requestAnimationFrame(() => {
      if (chatInputRef.current) {
        chatInputRef.current.value = '';
        chatInputRef.current.focus();
      }
    });
    setIsSending(true);

    try {
      setChatMessages([
        ...messagesWithUser,
        {
          role: 'assistant',
          content: '',
        },
      ]);

      const response = await new Promise<ChatResponse>((resolve, reject) => {
        streamChatMessage({
          message: userMessage,
          patientId: id,
          sessionId: selectedSession?.id,
          onMessage: (chunk) => {
            if (!chunk) return;
            setChatMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = {
                ...last,
                content: `${last.content || ''}${chunk}`,
              };
              return next;
            });
          },
          onComplete: (streamResult) => resolve(streamResult),
          onError: (error) => reject(error),
        });
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.message.content,
        explanation: response.message.explanation || null,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      };

      const finalMessages = [
        ...messagesWithUser,
        assistantMsg,
      ];
      setChatMessages(finalMessages);

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
      console.error('AI 回覆失敗:', err);
      let errorMessage = 'AI 助手目前無法回應，請確認後端服務是否正常運行，稍後再試。';
      if (isAxiosError(err)) {
        const data = err.response?.data as { message?: unknown; detail?: unknown } | undefined;
        const detail = (data?.message ?? data?.detail);
        if (typeof detail === 'string' && detail.trim()) {
          errorMessage = `AI 服務暫時不可用：${detail}`;
        }
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

  const daysAdmitted = Math.floor(
    (new Date().getTime() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const painMedications = medicationGroups.analgesia;
  const sedationMedications = medicationGroups.sedation;
  const nmbMedications = medicationGroups.nmb;
  const otherMedications = medicationGroups.other;

  const painIndication = painMedications[0]?.indication;
  const sedationIndication = sedationMedications[0]?.indication;
  const nmbIndication = nmbMedications[0]?.indication;

  const handleRecordScore = useCallback(async (scoreType: 'pain' | 'rass', value: number) => {
    if (!id) return;
    await recordScore(id, { score_type: scoreType, value });
    if (scoreType === 'pain') setPainScoreValue(value);
    else setRassScoreValue(value);
    toast.success(`已記錄 ${scoreType === 'pain' ? 'Pain' : 'RASS'} = ${value}`);
  }, [id]);

  const handleOpenScoreTrend = useCallback(async (scoreType: 'pain' | 'rass') => {
    if (!id) return;
    setScoreTrendType(scoreType);
    setScoreTrendOpen(true);
    try {
      const result = await getScoreTrends(id, scoreType, 72);
      setScoreTrendData(
        result.trends.map((t) => ({
          date: new Date(t.timestamp).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
          value: t.value,
        }))
      );
    } catch {
      setScoreTrendData([]);
    }
  }, [id]);

  const handleRefreshMedications = useCallback(async () => {
    if (!id) return;
    setMedicationsLoading(true);
    try {
      const result = await medicationsApi.getMedications(id, { status: 'active' });
      setMedicationGroups(result.grouped || deriveMedicationGroups(result.medications));
    } catch { /* ignore */ } finally {
      setMedicationsLoading(false);
    }
  }, [id]);

  const respiratoryRate = vitalSigns?.respiratoryRate;
  const temperature = vitalSigns?.temperature;
  const systolicBP = vitalSigns?.bloodPressure?.systolic;
  const diastolicBP = vitalSigns?.bloodPressure?.diastolic;
  const heartRate = vitalSigns?.heartRate;
  const spo2 = vitalSigns?.spo2;
  const etco2 = vitalSigns?.etco2;
  const cvp = vitalSigns?.cvp;
  const icp = vitalSigns?.icp;

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
    <div className="p-6 space-y-6">
      {/* 頁首資訊條 */}
      <Card className="border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/patients')} className="hover:bg-[#f8f9fa]" title="返回病人清單">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-[#7f265b] text-white flex items-center justify-center font-bold text-2xl shadow-lg">
                  {patient.bedNumber}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-bold text-[#3c7acb]">{patient.name}</h1>
                    {patient.intubated && (
                      <Badge className="bg-[#d1cbf7] text-[#7f265b] hover:bg-[#d1cbf7]/90">
                        插管中
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1 bg-white px-3 py-1 rounded-full">
                      <Clock className="h-4 w-4" />
                      住院 {daysAdmitted} 天
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {user?.role === 'admin' && (
                <Button className="bg-[#7f265b] hover:bg-[#631e4d]">編輯基本資料</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 分頁內容 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 h-[44px] bg-[#f8f9fa] border border-[#e5e7eb] gap-0.5 p-0.5">
          <TabsTrigger value="chat" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
            <MessageSquare className="mr-1.5 h-4 w-4" />
            對話助手
          </TabsTrigger>
          <TabsTrigger value="messages" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white relative rounded-md">
            <MessagesSquare className="mr-1.5 h-4 w-4" />
            留言板
            {messages.filter(m => !m.isRead).length > 0 && (
              <Badge className="ml-2 bg-[#ff3975] text-white px-2 py-0.5 text-xs">
                {messages.filter(m => !m.isRead).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="records" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
            <FileText className="mr-1.5 h-4 w-4" />
            病歷記錄
          </TabsTrigger>
          <TabsTrigger value="labs" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
            <TestTube className="mr-1.5 h-4 w-4" />
            檢驗數據
          </TabsTrigger>
          <TabsTrigger value="meds" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
            <Pill className="mr-1.5 h-4 w-4" />
            用藥
          </TabsTrigger>
          <TabsTrigger value="summary" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
            <FileText className="mr-1.5 h-4 w-4" />
            病歷摘要
          </TabsTrigger>
        </TabsList>

        {/* 對話助手 */}
        <TabsContent value="chat" className="space-y-2">
          <div className="grid grid-cols-12 gap-2">
            {/* 左側對話記錄列表 */}
            {showSessionList && (
              <div className="col-span-3">
                <Card className="border">
                  <CardHeader className="bg-[#f8f9fa] border-b py-1.5 px-3" style={{ paddingBottom: '6px' }}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[12px] font-semibold text-[#374151]">
                        <History className="h-3.5 w-3.5 text-[#6b7280]" />
                        對話記錄
                      </span>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[10px] bg-gray-700 hover:bg-gray-700 text-white"
                        onClick={() => {
                          setSelectedSession(null);
                          setChatMessages([]);
                          setSessionTitle('');
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        新對話
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
                      {chatSessions.length === 0 ? (
                        <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                          <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                          <p className="text-sm font-medium text-[#6b7280]">尚無對話記錄</p>
                          <p className="text-xs text-[#9ca3af] leading-relaxed">點擊「新對話」開始<br/>向 AI 詢問照護問題</p>
                        </div>
                      ) : (
                        <div className="space-y-1 p-2">
	                          {chatSessions.map((session) => (
	                            <div
	                              role="button"
	                              tabIndex={0}
	                              key={session.id}
	                              onClick={async () => {
	                                setSelectedSession(session);
	                                setSessionTitle(session.title);
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
			                                } catch {
	                                  toast.error('載入對話內容失敗');
	                                  setChatMessages([]);
	                                }
	                              }}
	                              className={`group w-full text-left px-2.5 py-2 rounded-lg border transition-all hover:bg-[#f8f9fa] ${
	                                selectedSession?.id === session.id
	                                  ? 'bg-[#f8f9fa] border-[#e5e7eb]'
	                                  : 'border-transparent'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm text-[#1a1a1a] truncate">
                                    {session.title}
                                  </p>
                                  <span className="text-[10px] text-[#b0b0b0] mt-0.5">
                                    {session.sessionDate === new Date().toISOString().slice(0, 10) ? session.sessionTime : `${session.sessionDate} ${session.sessionTime}`}
                                  </span>
                                  {session.labDataSnapshot && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      K: {formatSnapshotValue(session.labDataSnapshot.K)} • eGFR: {formatSnapshotValue(session.labDataSnapshot.eGFR)}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
	                                <Badge className="text-xs bg-gray-100 text-[#374151] border border-[#e5e7eb]">
	                                  {session.messageCount ?? session.messages.length}
	                                </Badge>
                                  <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 text-muted-foreground hover:text-red-600"
                                    title="刪除對話"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* 右側對話區 */}
            <div className={showSessionList ? "col-span-9" : "col-span-12"}>
              <Card className="border">
                <CardHeader className="bg-[#f8f9fa] border-b py-1 px-3" style={{ paddingBottom: '4px' }}>
                  <div className="flex items-center gap-1.5">
                    {/* Disclaimer inline */}
                    {disclaimerCollapsed ? (
                      <button
                        onClick={() => setDisclaimerCollapsed(false)}
                        className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                      >
                        <Info className="h-3 w-3" />
                        <span>AI 僅供參考</span>
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#6b7280] bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        <Info className="h-3 w-3 shrink-0 text-amber-600" />
                        <span>AI 輔助產生，僅供臨床參考，不可取代醫師專業判斷。</span>
                        <button onClick={() => setDisclaimerCollapsed(true)} className="shrink-0 text-[#9CA3AF] hover:text-[#6B7280]">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-1">
	                      {aiReadiness && (
	                        <Badge
	                          variant="outline"
	                          className={`text-[10px] px-1.5 py-0 ${
	                            canSendAiChat
	                              ? 'border-green-300 bg-green-50 text-green-700'
	                              : 'border-amber-300 bg-amber-50 text-amber-700'
	                          }`}
	                        >
	                          {canSendAiChat ? 'AI 就緒' : 'AI 未就緒'}
	                        </Badge>
	                      )}
	                      <Button variant="ghost" size="icon" className="h-6 w-6 text-[#6b7280] hover:text-[#7f265b]"
	                        onClick={refreshAiReadiness} disabled={isCheckingAiReadiness} title="檢查 AI 狀態">
	                        <Activity className={`h-3 w-3 ${isCheckingAiReadiness ? 'animate-spin' : ''}`} />
	                      </Button>
	                      <Button variant="ghost" size="icon" className="h-6 w-6 text-[#6b7280] hover:text-[#7f265b]"
	                        onClick={() => loadPatientBundle('refresh')} disabled={isRefreshingPatientData} title="更新患者數值">
	                        <RefreshCw className={`h-3 w-3 ${isRefreshingPatientData ? 'animate-spin' : ''}`} />
	                      </Button>
	                      <Button variant="ghost" size="icon" className="h-6 w-6 text-[#6b7280] hover:text-[#7f265b]"
	                        onClick={() => setShowSessionList(!showSessionList)} title={showSessionList ? '隱藏記錄列表' : '顯示記錄列表'}>
	                        <History className="h-3 w-3" />
	                      </Button>
	                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex flex-col" style={{ height: 'max(calc(100vh - 260px), 480px)' }}>
                  {/* AI 未就緒 warning */}
                  {!canSendAiChat && (
                    <div className="flex-none mx-4 mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">AI 對話功能暫時無法使用</p>
                        <p className="text-amber-700 mt-0.5">請聯繫系統管理員或稍後重試。</p>
                      </div>
                    </div>
                  )}

                  {/* 對話區 */}
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="relative flex-1 overflow-y-auto space-y-2 px-4 py-2"
                  >
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30 text-[#9ca3af]" />
                        <p className="text-[17px] font-medium">開始對話以獲得 AI 協助</p>
                        <p className="text-sm text-[#6b7280] mt-2">可以詢問檢驗數據、用藥建議、治療指引等</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => {
                        const isStreamingThis = isSending && idx === chatMessages.length - 1;
                        const isWaiting = isStreamingThis && !msg.content;
                        const displayContent = isStreamingThis && msg.content ? msg.content + '▌' : msg.content;
                        const references = msg.role === 'assistant' ? (msg.references || []) : [];
                        const freshnessHints = msg.role === 'assistant' ? getDisplayFreshnessHints(msg.dataFreshness) : [];
                        const hasDataQuality = msg.role === 'assistant' && (msg.degraded || freshnessHints.length > 0);
                        const isDetailExpanded = expandedExplanations.has(idx);
                        const isRefsExpanded = expandedReferences.has(idx);
                        const isQualityExpanded = expandedDataQuality.has(idx);
                        const isFirstOfRound = idx > 0 && msg.role === 'user' && chatMessages[idx - 1].role === 'assistant';
                        return (
                          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}${isFirstOfRound ? ' mt-3' : ''}`}>
                            {msg.role === 'user' ? (
                              <div className="max-w-[65%] w-fit rounded-2xl px-4 py-2.5 bg-white border border-[#e5e7eb]">
                                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#1F2937]">{msg.content}</p>
                                {msg.timestamp && (
                                  <p className="text-[11px] text-[#9ca3af] mt-1.5 text-right">{msg.timestamp}</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-start gap-2 max-w-[92%]">
                                {/* AI avatar */}
                                <img src={chatBotAvatar} alt="AI" className="h-8 w-8 rounded-full shadow-sm shrink-0 mt-0.5 object-cover" />
                              <div className="flex flex-1 min-w-0 rounded-2xl bg-white border border-[#e5e7eb] overflow-hidden">
                                {/* Accent bar */}
                                <div className="w-[3px] shrink-0 rounded-l-full" style={{ backgroundColor: '#d1d5db' }} />
                                {/* Content */}
                                <div className="flex-1 min-w-0 px-3 py-2.5">
                                  {/* Summary / waiting state */}
                                  {isWaiting ? (
                                    <div className="flex items-center gap-1.5 py-1">
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '0ms' }} />
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '160ms' }} />
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '320ms' }} />
                                    </div>
                                  ) : (
                                    <p className="text-[14px] leading-relaxed text-[#1F2937]">{displayContent}</p>
                                  )}

                                  {/* Expandable panels — shown after streaming */}
                                  {!isStreamingThis && (<>
                                    {/* Detail / explanation panel */}
                                    {isDetailExpanded && msg.explanation && msg.explanation.trim().length > 0 && (
                                      <div className="mt-2 rounded-md bg-[#F7F8F9] border border-[#E5E7EB] px-3 py-2.5">
                                        <AiMarkdown content={msg.explanation} className="text-[13px]" />
                                        <SafetyWarnings warnings={msg.warnings} />
                                        {msg.requiresExpertReview && (
                                          <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                            此回覆包含潛在高風險資訊，建議醫師/藥師覆核。
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* References panel */}
                                    {isRefsExpanded && (
                                      <div className="mt-2 rounded-md bg-[#f8f9fa] border border-[#e5e7eb] p-2.5">
                                        {references.length === 0 ? (
                                          <p className="text-xs text-[#6b7280]">本次回答未擷取到可顯示的文獻段落，可改用更具體關鍵詞再詢問。</p>
                                        ) : (
                                          <ul className="space-y-2">
                                            {references.map((ref, refIdx) => (
                                              <li key={`${ref.id || 'ref'}-${refIdx}`} className="text-xs text-muted-foreground">
                                                <div className="flex items-start gap-1">
                                                  <span className="mt-0.5 text-[#6b7280]">•</span>
                                                  <div className="flex-1">
                                                    <p className="font-medium text-[#374151]">{ref.title || ref.sourceFile || 'unknown'}</p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                      {(ref.sourceFile || ref.source || 'unknown')}
                                                      {' • '}
                                                      {formatCitationPageText(ref)}
                                                      {' • '}
                                                      相關度 {Number.isFinite(Number(ref.relevance)) ? Number(ref.relevance).toFixed(3) : 'N/A'}
                                                    </p>
                                                    {ref.summary ? (
                                                      <div className="mt-1 space-y-1">
                                                        <p className="text-[11px] text-[#374151] leading-relaxed">
                                                          <span className="font-medium text-[#374151]">重點：</span>{ref.summary}
                                                        </p>
                                                        {ref.keyQuote && (
                                                          <div className="rounded border border-[#d1d5db] bg-white px-2 py-1.5 text-[11px] leading-relaxed text-[#6b7280] italic">
                                                            「{ref.keyQuote}」
                                                          </div>
                                                        )}
                                                        {ref.relevanceNote && (
                                                          <p className="text-[10px] text-[#9ca3af]">{ref.relevanceNote}</p>
                                                        )}
                                                      </div>
                                                    ) : Array.isArray(ref.snippets) && ref.snippets.length > 1 ? (
                                                      <div className="mt-1 space-y-1.5">
                                                        {ref.snippets.map((s, si) => (
                                                          <div key={si} className="rounded border border-[#d1d5db] bg-white p-2 text-[11px] leading-relaxed text-[#374151] whitespace-pre-wrap">
                                                            <span className="inline-block text-[10px] font-medium mb-0.5 text-[#6b7280]">段落 {si + 1}</span>
                                                            <div>{compactSnippet(s)}</div>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : ref.snippet && ref.snippet.trim().length > 0 ? (
                                                      <div className="mt-1 rounded border border-[#d1d5db] bg-white p-2 text-[11px] leading-relaxed text-[#374151] whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                        {compactSnippet(ref.snippet)}
                                                      </div>
                                                    ) : (
                                                      <p className="text-[11px] text-[#9ca3af] mt-1">未提供原文段落。</p>
                                                    )}
                                                  </div>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    )}

                                    {/* Data quality panel */}
                                    {isQualityExpanded && hasDataQuality && (
                                      <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-700 flex items-start gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        <div className="space-y-0.5">
                                          {msg.degraded && <p>系統狀態：{formatAiDegradedReason(msg.degradedReason, msg.upstreamStatus)}</p>}
                                          {freshnessHints.length > 0 && <p>資料品質：{freshnessHints.join(' ')}</p>}
                                        </div>
                                      </div>
                                    )}
                                  </>)}

                                  {/* Inline toolbar */}
                                  {!isStreamingThis && (
                                    <div className="flex items-center gap-2.5 mt-2 pt-1.5 border-t border-[#F0F0F0] text-[12px] text-[#9CA3AF]">
                                      {msg.explanation && msg.explanation.trim().length > 0 && (
                                        <button
                                          onClick={() => setExpandedExplanations(prev => { const n = new Set(prev); isDetailExpanded ? n.delete(idx) : n.add(idx); return n; })}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                          aria-label={isDetailExpanded ? '收合說明' : '展開說明'}
                                        >
                                          {isDetailExpanded ? <><ChevronDown className="h-3 w-3" />收合</> : <><ChevronRight className="h-3 w-3" />詳細</>}
                                        </button>
                                      )}
                                      {references.length > 0 && (
                                        <button
                                          onClick={() => setExpandedReferences(prev => { const n = new Set(prev); isRefsExpanded ? n.delete(idx) : n.add(idx); return n; })}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] cursor-pointer transition-colors"
                                          aria-label="參考依據"
                                        >
                                          <BookOpen className="h-3 w-3" />
                                          {references.length}
                                        </button>
                                      )}
                                      {hasDataQuality && (
                                        <button
                                          onClick={() => setExpandedDataQuality(prev => { const n = new Set(prev); isQualityExpanded ? n.delete(idx) : n.add(idx); return n; })}
                                          className="flex items-center gap-0.5 text-amber-500 hover:text-amber-700 transition-colors"
                                          aria-label="資料品質警告"
                                        >
                                          <AlertCircle className="h-3 w-3" />
                                        </button>
                                      )}
                                      {msg.timestamp && (
                                        <span className="flex items-center gap-0.5 text-[11px] text-[#9ca3af]">
                                          <Clock className="h-3 w-3" />
                                          {msg.timestamp}
                                        </span>
                                      )}
                                      <div className="flex-1" />
                                      <button
                                        onClick={async () => {
                                          const success = await copyToClipboard(msg.content);
                                          if (success) toast.success('已複製到剪貼簿');
                                          else toast.error('複製失敗，請手動複製');
                                        }}
                                        className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                        aria-label="複製回覆"
                                      >
                                        <Copy className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                    {showScrollToBottom && (
                      <button
                        onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                        className="sticky bottom-2 ml-auto flex items-center gap-1 text-white text-xs rounded-full px-3 py-1.5 shadow-lg transition-colors z-10 bg-gray-700 hover:bg-gray-700"
                        aria-label="跳到最新訊息"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        跳到最新
                      </button>
                    )}
                  </div>

                  {/* 輸入區 */}
                  <div className="flex-none px-4 pb-1.5 pt-0 border-t border-[#e5e7eb] bg-white">
                    <div className="flex gap-2 pt-1.5 items-end">
                      <Textarea
                        ref={chatInputRef}
                        placeholder={canSendAiChat ? "例如：這位病患的鎮靜深度是否適當？" : "AI 功能未就緒"}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className={`min-h-[36px] border text-[13px] transition-colors rounded-xl ${
                          canSendAiChat
                            ? 'border-[#e5e7eb]'
                            : 'border-[#e5e7eb] bg-[#f8f9fa] text-[#9ca3af] cursor-not-allowed'
                        }`}
                        disabled={!canSendAiChat}
                      />
                      <Button
                        onClick={handleSendMessage}
                        size="icon"
                        className={`h-[36px] w-[36px] shrink-0 transition-colors rounded-xl ${
                          canSendAiChat
                            ? 'bg-gray-700 hover:bg-gray-700'
                            : 'bg-[#d1d5db] cursor-not-allowed'
                        }`}
                        disabled={isSending || !chatInput.trim() || !canSendAiChat}>
                        <Send className={`h-4.5 w-4.5 ${isSending ? 'opacity-40' : ''}`} />
                      </Button>
                    </div>
                    <p className="text-[9px] text-[#d0d0d0] mt-1">Enter 發送 · Shift+Enter 換行</p>
                  </div>
                  </div>{/* end flex column */}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Progress Note 功能已統一至「病歷記錄」tab */}

          {/* RAG 來源側欄 - 已移除 */}
        </TabsContent>

        {/* 留言板 */}
        <TabsContent value="messages" className="space-y-4">
          <Card>
            <CardHeader className="bg-[#f8f9fa] border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessagesSquare className="h-6 w-6 text-[#7f265b]" />
                    病患留言板
                  </CardTitle>
                  <CardDescription className="text-[15px] mt-2">
                    團隊成員的照護溝通與用藥建議，避免重要訊息遺漏
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {messages.filter(m => !m.isRead).length > 0 && (
                    <Badge className="bg-[#ff3975] text-white px-3 py-1.5">
                      {messages.filter(m => !m.isRead).length} 則未讀
                    </Badge>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={async () => {
                      if (!id) return;
                      const unread = messages.filter(m => !m.isRead);
                      if (unread.length === 0) return;
                      try {
                        await Promise.all(
                          unread.map(m => messagesApi.markMessageRead(id, m.id).catch(() => null))
                        );
                        toast.success(`已標記 ${unread.length} 則留言為已讀`);
                        await refreshMessagesOnly();
                      } catch (err) {
                        console.error('全部標為已讀失敗:', err);
                        toast.error('全部標為已讀失敗');
                      }
                    }}
                  >
                    全部標為已讀
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 新增留言輸入區 */}
              <div className="space-y-2 p-4 bg-[#f8f9fa] rounded-lg border border-[#e5e7eb]">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-[#7f265b]" />
                  <label className="font-semibold text-[#1a1a1a]">新增留言</label>
                </div>
                <Textarea
                  placeholder="輸入照護相關訊息或用藥建議..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="min-h-[80px] border border-[#7f265b] focus:border-[#7f265b] focus:ring-2 focus:ring-[#7f265b]/20 text-[17px]"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSendBoardMessage}
                    size="lg"
                    className="bg-[#7f265b] hover:bg-[#5f1e45]"
                    disabled={!messageInput.trim()}
                  >
                    <Send className="mr-2 h-5 w-5" />
                    發送留言
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={async () => {
                      if (!messageInput.trim() || !id) return;
                      if (user?.role !== 'pharmacist') {
                        toast.error('只有藥師可以發送用藥建議');
                        return;
                      }
                      try {
                        const newMessage = await messagesApi.sendMessage(id, {
                          content: messageInput.trim(),
                          messageType: 'medication-advice'
                        });
                        setMessages(prev => [newMessage, ...prev]);
                        setMessageInput('');
                        toast.success('用藥建議發送成功');
                      } catch (err) {
                        console.error('發送用藥建議失敗:', err);
                        toast.error('發送用藥建議失敗');
                      }
                    }}
                    disabled={!messageInput.trim() || user?.role !== 'pharmacist'}
                  >
                    <Pill className="mr-2 h-5 w-5" />
                    標記為用藥建議
                  </Button>
                </div>
              </div>

              <Separator />

              {/* 留言列表 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">團隊留言 ({messages.length})</h3>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <Pill className="h-3 w-3 mr-1" />
                      {messages.filter(m => m.messageType === 'medication-advice').length} 用藥建議
                    </Badge>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {messages.filter(m => m.messageType === 'alert').length} 警示
                    </Badge>
                  </div>
                </div>

                {messagesLoading ? (
                  <MessageListSkeleton count={3} />
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={MessagesSquare}
                    title="尚無留言"
                    description="開始新增第一則留言，與團隊分享照護資訊"
                  />
                ) : (
                  messages.map((message) => {
                    const getRoleIcon = () => {
                      switch (message.authorRole) {
                        case 'pharmacist':
                          return <Pill className="h-5 w-5 text-green-600" />;
                        case 'doctor':
                          return <Stethoscope className="h-5 w-5 text-blue-600" />;
                        case 'nurse':
                          return <Activity className="h-5 w-5 text-purple-600" />;
                        case 'admin':
                          return <Shield className="h-5 w-5 text-orange-600" />;
                        default:
                          return <User className="h-5 w-5 text-gray-600" />;
                      }
                    };

                    const getRoleLabel = () => {
                      switch (message.authorRole) {
                        case 'pharmacist': return '藥師';
                        case 'doctor': return '醫師';
                        case 'nurse': return '護理師';
                        case 'admin': return '管理者';
                        default: return '使用者';
                      }
                    };

                    const getMessageTypeColor = () => {
                      switch (message.messageType) {
                        case 'medication-advice':
                          return 'border-green-200 bg-green-50';
                        case 'alert':
                          return 'border-red-200 bg-red-50';
                        default:
                          return 'border-blue-200 bg-blue-50';
                      }
                    };

                    return (
                      <Card 
                        key={message.id} 
                        className={`${getMessageTypeColor()} ${!message.isRead ? 'shadow-md' : ''}`}
                      >
                        <CardHeader className="pb-2 pt-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-white rounded-full border">
                                {getRoleIcon()}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-[#1a1a1a]">{message.authorName}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {getRoleLabel()}
                                  </Badge>
                                  {message.messageType === 'medication-advice' && (
                                    <Badge className="bg-green-600 text-white text-xs">
                                      <Pill className="h-3 w-3 mr-1" />
                                      用藥建議
                                    </Badge>
                                  )}
                                  {message.messageType === 'alert' && (
                                    <Badge className="bg-red-600 text-white text-xs">
                                      <AlertCircle className="h-3 w-3 mr-1" />
                                      警示
                                    </Badge>
                                  )}
                                  {!message.isRead && (
                                    <Badge className="bg-[#ff3975] text-white text-xs">
                                      未讀
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  <span>{formatTimestamp(message.timestamp)}</span>
                                  {message.linkedMedication && (
                                    <>
                                      <span>•</span>
                                      <span className="text-[#7f265b] font-medium">
                                        關聯藥品：{message.linkedMedication}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {!message.isRead && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (!id) return;
                                  try {
                                    await messagesApi.markMessageRead(id, message.id);
                                    toast.success('已標記為已讀');
                                    await refreshMessagesOnly();
                                  } catch (err) {
                                    console.error('標記已讀失敗:', err);
                                    toast.error('標記已讀失敗');
                                  }
                                }}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                標為已讀
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0 pb-3">
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 病歷記錄 */}
        <TabsContent value="records" className="space-y-4">
          <MedicalRecords patientId={patient.id} patientName={patient.name} aiReadiness={aiReadiness} />
        </TabsContent>

        {/* 檢驗數據 */}
        {/* 檢驗 + 微生物 */}
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
        />

        {/* 用藥 */}
        <PatientMedicationsTab
          patientId={id}
          userRole={user?.role}
          medicationsLoading={medicationsLoading}
          painIndication={painIndication}
          sedationIndication={sedationIndication}
          nmbIndication={nmbIndication}
          painMedications={painMedications}
          sedationMedications={sedationMedications}
          nmbMedications={nmbMedications}
          otherMedications={otherMedications}
          formatDisplayValue={formatDisplayValue}
          formatMedicationRegimen={formatMedicationRegimen}
          painScoreValue={painScoreValue}
          rassScoreValue={rassScoreValue}
          onRecordScore={handleRecordScore}
          onOpenScoreTrend={handleOpenScoreTrend}
          scoreTrendOpen={scoreTrendOpen}
          scoreTrendType={scoreTrendType}
          scoreTrendData={scoreTrendData}
          onCloseScoreTrend={() => setScoreTrendOpen(false)}
          onRefreshMedications={handleRefreshMedications}
        />

        {/* 病歷摘要 */}
        <TabsContent value="summary" className="space-y-4">
          <PatientSummaryTab
            patient={patient}
            userRole={user?.role}
            ragStatus={ragStatus}
            aiReadiness={aiReadiness}
          />
        </TabsContent>
      </Tabs>

      {/* 檢驗數據頁折線圖對話框 */}
      {selectedTrendMetric && (
        <LabTrendChart
          isOpen={!!selectedTrendMetric}
          onClose={() => setSelectedTrendMetric(null)}
          labName={selectedTrendMetric.name}
          labNameChinese={selectedTrendMetric.nameChinese}
          unit={selectedTrendMetric.unit}
          trendData={trendChartData}
        />
      )}
    </div>
  );
}
