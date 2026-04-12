// Patient detail page
import { MedicalRecords } from '../components/medical-records';
import { LabTrendChart } from '../components/lab-trend-chart';
import { VitalSignCard } from '../components/vital-signs-card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  streamChatMessage,
  extractStreamMainContent,
  getChatSessions as fetchChatSessionsApi,
  getChatSession as fetchChatSessionApi,
  updateChatSessionTitle,
  updateMessageFeedback,
  deleteChatSession,
  getReadinessReason,
  type ChatResponse,
  type Citation as AiCitation,
  type DataFreshness,
} from '../lib/api/ai';
import { patientsApi, labDataApi, medicationsApi, messagesApi, vitalSignsApi, ventilatorApi, type Patient, type LabData, type Medication, type PatientMessage, type VitalSigns, type VentilatorSettings, type WeaningAssessment } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard-utils';
import { useAuth } from '../lib/auth-context';
import { usePatientScores } from '../hooks/use-patient-scores';
import { useAiReadiness } from '../hooks/use-ai-readiness';
import { useTrendChart, type TrendSource } from '../hooks/use-trend-chart';
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
import { PatientEditDialog } from '../components/patient/dialogs/patient-edit-dialog';
import { PatientLabsTab } from '../components/patient/patient-labs-tab';
import { PatientMedicationsTab } from '../components/patient/patient-medications-tab';
import { PatientMessagesTab } from '../components/patient/patient-messages-tab';
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
  ThumbsDown
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

  // AI 狀態（hook）
  const { ragStatus, aiReadiness, isCheckingAiReadiness, refreshAiReadiness } = useAiReadiness();

  // 病人資料狀態
  const [patient, setPatient] = useState<PatientWithFrontendFields | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError, setPatientError] = useState<string | null>(null);

  // 編輯病人資料
  const [editingPatient, setEditingPatient] = useState<PatientWithFrontendFields | null>(null);
  const handleEditSave = async () => {
    if (!editingPatient || !patient) return;
    try {
      const updated = await patientsApi.updatePatient(patient.id, editingPatient);
      setPatient(updated as PatientWithFrontendFields);
      setEditingPatient(null);
      toast.success('病人資料已更新');
    } catch {
      toast.error('更新失敗，請稍後再試');
    }
  };

  // 檢驗數據狀態
  const [labData, setLabData] = useState<LabData>(defaultLabData);
  const [labDataLoading, setLabDataLoading] = useState(false);

  // 用藥數據狀態
  const [medicationGroups, setMedicationGroups] = useState<MedicationGroups>(EMPTY_MEDICATION_GROUPS);
  const [drugInteractions, setDrugInteractions] = useState<import('../lib/api/medications').DrugInteraction[]>([]);
  const [medicationsLoading, setMedicationsLoading] = useState(false);

  // 臨床評分（hook）
  const scores = usePatientScores(id);

  // 留言板狀態
  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
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

  // 趨勢圖表（hook）
  const { selectedTrendMetric, setSelectedTrendMetric, trendChartData } = useTrendChart(id);
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
        medicationsApi.getMedications(id, { status: 'all' }).catch(() => ({ medications: [], grouped: EMPTY_MEDICATION_GROUPS, interactions: [] })),
        messagesApi.getMessages(id).catch(() => ({ messages: [], total: 0, unreadCount: 0 })),
        vitalSignsApi.getLatestVitalSigns(id).catch(() => null),
        ventilatorApi.getLatestVentilatorSettings(id).catch(() => null),
        ventilatorApi.getWeaningAssessment(id).catch(() => null)
      ]);

      setPatient(patientData as PatientWithFrontendFields);
      setLabData(labDataResult);
      setMedicationGroups(medicationsResult.grouped || deriveMedicationGroups(medicationsResult.medications));
      setDrugInteractions(medicationsResult.interactions || []);
      setMessages(messagesResult.messages);
      setUnreadCount(messagesResult.unreadCount);
      setVitalSigns(vitalSignsResult);
      setVentilator(ventilatorResult);
      setWeaningAssessment(weaningResult);

      // 載入臨床評分（via hook）
      await scores.loadLatestScores();

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
      setDrugInteractions(result.interactions || []);
    } catch { /* ignore */ } finally {
      setMedicationsLoading(false);
    }
  }, [id]);

  // 載入預設標籤
  const refreshTags = useCallback(async () => {
    if (!id) return;
    const [preset, custom] = await Promise.all([
      messagesApi.getPresetTags(id).catch(() => [] as string[]),
      messagesApi.getCustomTags(id).catch(() => [] as { id: string; name: string; createdById: string; createdByName: string; createdAt: string }[]),
    ]);
    setPresetTags(preset);
    setCustomTags(custom);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void refreshTags();
    messagesApi.getPharmacyTags(id).then(setPharmacyTagCategories).catch(() => setPharmacyTagCategories([]));
  }, [id, refreshTags]);

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
  const handleSendBoardMessage = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => {
    if (!messageInput.trim() || !id) return;

    try {
      const newMessage = await messagesApi.sendMessage(id, {
        content: messageInput.trim(),
        messageType: 'general',
        replyToId,
        tags,
        mentionedRoles,
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
  const handleSendMedicationAdvice = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => {
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

  const handleBatchDelete = async () => {
    if (selectedSessionIds.length === 0) return;
    if (!confirm(`確定要刪除所選的 ${selectedSessionIds.length} 筆對話記錄嗎？`)) return;
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
    }
  };

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds(prev =>
      prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
    );
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
        streamChatMessage({
          message: userMessage,
          patientId: id,
          sessionId: selectedSession?.id,
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
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
          },
          onComplete: (streamResult) => resolve(streamResult),
          onError: (error) => reject(error),
        });
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.message.content,
        messageId: response.message.id,
        explanation: response.message.explanation || null,
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

    const newFeedback = msg.feedback === feedback ? null : feedback;
    setChatMessages((prev) => {
      const next = [...prev];
      next[msgIndex] = { ...next[msgIndex], feedback: newFeedback };
      return next;
    });
    try {
      await updateMessageFeedback(msg.messageId, newFeedback);
    } catch {
      setChatMessages((prev) => {
        const next = [...prev];
        next[msgIndex] = { ...next[msgIndex], feedback: msg.feedback };
        return next;
      });
      toast.error('回饋儲存失敗');
    }
  };

  const handleRegenerateMessage = async (msgIndex: number) => {
    if (isSending) return;
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

    try {
      const response = await new Promise<ChatResponse>((resolve, reject) => {
        let rawBuffer = '';
        streamChatMessage({
          message: userMessage,
          patientId: id,
          sessionId: selectedSession?.id,
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
            const mainContent = extractStreamMainContent(rawBuffer);
            setChatMessages((prev) => {
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = { ...last, content: mainContent };
              return next;
            });
          },
          onComplete: (streamResult) => resolve(streamResult),
          onError: (error) => reject(error),
        });
      });

      const newAssistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.message.content,
        messageId: response.message.id,
        explanation: response.message.explanation || null,
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

  const painIndication = painMedications[0]?.indication;
  const sedationIndication = sedationMedications[0]?.indication;
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
  const bodyWeight = vitalSigns?.bodyWeight ?? patient?.weight;

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
                    <h1 className="text-3xl font-bold text-[#3c7acb]">{patient.name}</h1>
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
                <Badge className="bg-[#d1cbf7] text-brand hover:bg-[#d1cbf7]/90">
                  插管中
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
          {/* 診斷 + alerts */}
          {(patient.diagnosis || (patient.alerts && patient.alerts.length > 0)) && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
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
            {messages.filter(m => !m.isRead).length > 0 && (
              <Badge className="ml-2 bg-[#ff3975] text-white px-2 py-0.5 text-xs">
                {messages.filter(m => !m.isRead).length}
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

        {/* 對話助手 */}
        <TabsContent value="chat" className="space-y-2">
          <div className="grid grid-cols-12 gap-2">
            {/* 左側對話記錄列表 */}
            {showSessionList && (
              <div className="col-span-3">
                <Card className="border">
                  <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1.5 px-3" style={{ paddingBottom: '6px' }}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs font-semibold text-[#374151]">
                        <History className="h-3.5 w-3.5 text-muted-foreground" />
                        對話記錄
                      </span>
                      <div className="flex items-center gap-1">
                        {chatSessions.length > 0 && (
                          <Button
                            size="sm"
                            variant={isSelectMode ? "outline" : "ghost"}
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              setIsSelectMode(!isSelectMode);
                              setSelectedSessionIds([]);
                            }}
                          >
                            {isSelectMode ? '完成' : '管理'}
                          </Button>
                        )}
                        {!isSelectMode && (
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 text-white"
                            onClick={() => {
                              setSelectedSession(null);
                              setChatMessages([]);
                              setSessionTitle('');
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            新對話
                          </Button>
                        )}
                      </div>
                    </div>
                    {isSelectMode && (
                      <div className="flex items-center justify-between mt-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            if (selectedSessionIds.length === chatSessions.length) {
                              setSelectedSessionIds([]);
                            } else {
                              setSelectedSessionIds(chatSessions.map(s => s.id));
                            }
                          }}
                        >
                          {selectedSessionIds.length === chatSessions.length ? '取消全選' : '全選'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 px-2 text-xs"
                          disabled={selectedSessionIds.length === 0}
                          onClick={handleBatchDelete}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          刪除 ({selectedSessionIds.length})
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
                      {chatSessions.length === 0 ? (
                        <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                          <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                          <p className="text-sm font-medium text-muted-foreground">尚無對話記錄</p>
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
	                                if (isSelectMode) {
	                                  toggleSessionSelection(session.id);
	                                  return;
	                                }
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
	                              className={`group w-full text-left px-2.5 py-2 rounded-lg border transition-all hover:bg-slate-50 dark:hover:bg-slate-800 ${
	                                isSelectMode && selectedSessionIds.includes(session.id)
	                                  ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'
	                                  : selectedSession?.id === session.id
	                                    ? 'bg-slate-50 border-border dark:bg-slate-800'
	                                    : 'border-transparent'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                {isSelectMode && (
                                  <div className="flex items-center pt-0.5 shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={selectedSessionIds.includes(session.id)}
                                      onChange={() => toggleSessionSelection(session.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="h-3.5 w-3.5 rounded border-gray-300 accent-red-500 cursor-pointer"
                                    />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm text-foreground truncate">
                                    {session.title}
                                  </p>
                                  <span className="text-xs text-[#b0b0b0] mt-0.5">
                                    {session.sessionDate === new Date().toISOString().slice(0, 10) ? session.sessionTime : `${session.sessionDate} ${session.sessionTime}`}
                                  </span>
                                  {session.labDataSnapshot && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      K: {formatSnapshotValue(session.labDataSnapshot.K)} • eGFR: {formatSnapshotValue(session.labDataSnapshot.eGFR)}
                                    </div>
                                  )}
                                </div>
                                {!isSelectMode && (
                                  <div className="flex items-center gap-1 shrink-0">
	                                  <Badge className="text-xs bg-gray-100 dark:bg-gray-700 text-[#374151] dark:text-gray-200 border border-border">
	                                    {session.messageCount ?? session.messages.length}
	                                  </Badge>
                                    <button
                                      onClick={(e) => handleDeleteSession(e, session.id)}
                                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                                      title="刪除對話"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
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
                <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1 px-3" style={{ paddingBottom: '4px' }}>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1" />
                    <div className="flex items-center gap-1">
	                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-brand"
	                        onClick={() => setShowSessionList(!showSessionList)} title={showSessionList ? '隱藏記錄列表' : '顯示記錄列表'}>
	                        <History className="h-3 w-3" />
	                      </Button>
	                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex flex-col" style={{ height: 'max(calc(100vh - 260px), 480px)' }}>
                  {/* 對話區 */}
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="relative flex-1 overflow-y-auto space-y-2 px-4 py-2"
                  >
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30 text-[#9ca3af]" />
                        <p className="text-base font-medium">開始對話以獲得 AI 協助</p>
                        <p className="text-sm text-muted-foreground mt-2">可以詢問檢驗數據、用藥建議、治療指引等</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => {
                        const isStreamingThis = isSending && idx === chatMessages.length - 1;
                        const isWaiting = isStreamingThis && !msg.content;
                        const displayContent = isStreamingThis && msg.content ? msg.content + '▌' : msg.content;
                        const references = msg.role === 'assistant' ? (msg.references || []) : [];
                        const freshnessHints = msg.role === 'assistant' ? getDisplayFreshnessHints(msg.dataFreshness) : [];
                        const hasDataQuality = msg.role === 'assistant' && (msg.degraded || freshnessHints.length > 0);
                        const isDetailExpanded = expandedExplanations.includes(idx);
                        const isRefsExpanded = expandedReferences.includes(idx);
                        const isQualityExpanded = expandedDataQuality.includes(idx);
                        const isFirstOfRound = idx > 0 && msg.role === 'user' && chatMessages[idx - 1].role === 'assistant';
                        return (
                          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}${isFirstOfRound ? ' mt-3' : ''}`}>
                            {msg.role === 'user' ? (
                              <div className="max-w-[65%] w-fit rounded-2xl px-4 py-2.5 bg-white dark:bg-slate-900 border border-border">
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1F2937]">{msg.content}</p>
                                {msg.timestamp && (
                                  <p className="text-xs text-[#9ca3af] mt-1.5 text-right">{msg.timestamp}</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-start gap-2 max-w-[92%]">
                                {/* AI avatar */}
                                <img src={chatBotAvatar} alt="AI" className="h-8 w-8 rounded-full shadow-sm shrink-0 mt-0.5 object-cover" />
                              <div className="flex flex-1 min-w-0 rounded-2xl bg-white dark:bg-slate-900 border border-border overflow-hidden">
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
                                    <p className="text-sm leading-relaxed text-[#1F2937]">{displayContent}</p>
                                  )}

                                  {/* Expandable panels — shown after streaming */}
                                  {!isStreamingThis && (<>
                                    {/* Detail / explanation panel */}
                                    {isDetailExpanded && msg.explanation && msg.explanation.trim().length > 0 && (
                                      <div className="mt-2 rounded-md bg-[#F7F8F9] border border-[#E5E7EB] px-3 py-2.5">
                                        <AiMarkdown content={msg.explanation} className="text-xs" />
                                        <SafetyWarnings warnings={msg.warnings} />
                                        {msg.requiresExpertReview && (
                                          <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                                            此回覆包含潛在高風險資訊，建議醫師/藥師覆核。
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* References panel */}
                                    {isRefsExpanded && (
                                      <div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-border p-2.5">
                                        {references.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">本次回答未擷取到可顯示的文獻段落，可改用更具體關鍵詞再詢問。</p>
                                        ) : (
                                          <ul className="space-y-2">
                                            {references.map((ref, refIdx) => (
                                              <li key={`${ref.id || 'ref'}-${refIdx}`} className="text-xs text-muted-foreground">
                                                <div className="flex items-start gap-1">
                                                  <span className="mt-0.5 text-muted-foreground">•</span>
                                                  <div className="flex-1">
                                                    <p className="font-medium text-[#374151]">{ref.title || ref.sourceFile || 'unknown'}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                      {(ref.sourceFile || ref.source || 'unknown')}
                                                      {' • '}
                                                      {formatCitationPageText(ref)}
                                                      {' • '}
                                                      相關度 {Number.isFinite(Number(ref.relevance)) ? Number(ref.relevance).toFixed(3) : 'N/A'}
                                                    </p>
                                                    {ref.summary ? (
                                                      <div className="mt-1 space-y-1">
                                                        <p className="text-xs text-[#374151] leading-relaxed">
                                                          <span className="font-medium text-[#374151]">重點：</span>{ref.summary}
                                                        </p>
                                                        {ref.keyQuote && (
                                                          <div className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground italic">
                                                            「{ref.keyQuote}」
                                                          </div>
                                                        )}
                                                        {ref.relevanceNote && (
                                                          <p className="text-xs text-[#9ca3af]">{ref.relevanceNote}</p>
                                                        )}
                                                      </div>
                                                    ) : Array.isArray(ref.snippets) && ref.snippets.length > 1 ? (
                                                      <div className="mt-1 space-y-1.5">
                                                        {ref.snippets.map((s, si) => (
                                                          <div key={si} className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-200 whitespace-pre-wrap">
                                                            <span className="inline-block text-xs font-medium mb-0.5 text-muted-foreground">段落 {si + 1}</span>
                                                            <div>{compactSnippet(s)}</div>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : ref.snippet && ref.snippet.trim().length > 0 ? (
                                                      <div className="mt-1 rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-200 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                        {compactSnippet(ref.snippet)}
                                                      </div>
                                                    ) : (
                                                      <p className="text-xs text-[#9ca3af] mt-1">未提供原文段落。</p>
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
                                      <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-700 flex items-start gap-1.5 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300">
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
                                    <div className="flex items-center gap-2.5 mt-2 pt-1.5 border-t border-[#F0F0F0] text-xs text-[#9CA3AF]">
                                      {msg.explanation && msg.explanation.trim().length > 0 && (
                                        <button
                                          onClick={() => setExpandedExplanations(prev => isDetailExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                          aria-label={isDetailExpanded ? '收合說明' : '展開說明'}
                                        >
                                          {isDetailExpanded ? <><ChevronDown className="h-3 w-3" />收合</> : <><ChevronRight className="h-3 w-3" />詳細</>}
                                        </button>
                                      )}
                                      {references.length > 0 && (
                                        <button
                                          onClick={() => setExpandedReferences(prev => isRefsExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] cursor-pointer transition-colors"
                                          aria-label="參考依據"
                                        >
                                          <BookOpen className="h-3.5 w-3.5" />
                                          {references.length}
                                        </button>
                                      )}
                                      {hasDataQuality && (
                                        <button
                                          onClick={() => setExpandedDataQuality(prev => isQualityExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 text-amber-500 hover:text-amber-700 transition-colors"
                                          aria-label="資料品質警告"
                                        >
                                          <AlertCircle className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      {msg.timestamp && (
                                        <span className="flex items-center gap-0.5 text-xs text-[#9ca3af]">
                                          <Clock className="h-3.5 w-3.5" />
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
                                      <button
                                        onClick={() => void handleSetMessageFeedback(idx, 'up')}
                                        className={`flex items-center gap-0.5 transition-colors ${
                                          msg.feedback === 'up' ? 'text-green-600' : 'hover:text-[#4B5563]'
                                        }`}
                                        aria-label="讚"
                                      >
                                        <ThumbsUp className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={() => void handleSetMessageFeedback(idx, 'down')}
                                        className={`flex items-center gap-0.5 transition-colors ${
                                          msg.feedback === 'down' ? 'text-red-500' : 'hover:text-[#4B5563]'
                                        }`}
                                        aria-label="倒讚"
                                      >
                                        <ThumbsDown className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={() => void handleRegenerateMessage(idx)}
                                        className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                        aria-label="重新生成"
                                        disabled={isSending}
                                      >
                                        <RefreshCw className={`h-3 w-3 ${isSending ? 'opacity-40' : ''}`} />
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
                        className="sticky bottom-2 ml-auto flex items-center gap-1 text-white text-xs rounded-full px-3 py-1.5 shadow-lg transition-colors z-10 bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500"
                        aria-label="跳到最新訊息"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        跳到最新
                      </button>
                    )}
                  </div>

                  {/* 輸入區 */}
                  <div className="flex-none px-4 pb-1.5 pt-0 border-t border-border bg-white dark:bg-slate-900">
                    <div className="flex gap-2 pt-1.5 items-end">
                      <Textarea
                        ref={chatInputRef}
                        placeholder={canSendAiChat ? "" : "AI 功能未就緒"}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className={`min-h-[36px] border text-xs transition-colors rounded-xl ${
                          canSendAiChat
                            ? 'border-border'
                            : 'border-border bg-slate-50 dark:bg-slate-800 text-[#9ca3af] cursor-not-allowed'
                        }`}
                        disabled={!canSendAiChat}
                      />
                      <Button
                        onClick={handleSendMessage}
                        size="icon"
                        className={`h-[36px] w-[36px] shrink-0 transition-colors rounded-xl ${
                          canSendAiChat
                            ? 'bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500'
                            : 'bg-[#d1d5db] dark:bg-gray-600 cursor-not-allowed'
                        }`}
                        disabled={isSending || !chatInput.trim() || !canSendAiChat}>
                        <Send className={`h-4.5 w-4.5 ${isSending ? 'opacity-40' : ''}`} />
                      </Button>
                    </div>
                    <p className="text-xs text-[#d0d0d0] mt-1">Enter 發送 · Shift+Enter 換行</p>
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
        <PatientMessagesTab
          patientId={id}
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
        />

        {/* 用藥 */}
        <PatientMedicationsTab
          patientId={id}
          userRole={user?.role}
          medicationsLoading={medicationsLoading}
          drugInteractions={drugInteractions}
          painIndication={painIndication}
          sedationIndication={sedationIndication}
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

        {/* 病歷摘要 */}
        <TabsContent value="summary" className="space-y-4">
          <PatientSummaryTab
            patient={patient}
            userRole={user?.role}
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

      {/* 編輯病人資料對話框 */}
      <PatientEditDialog
        patient={editingPatient}
        onPatientChange={setEditingPatient}
        onCancel={() => setEditingPatient(null)}
        onSave={handleEditSave}
      />
    </div>
  );
}
