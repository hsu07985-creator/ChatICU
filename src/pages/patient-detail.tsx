import { MedicalRecords } from '../components/medical-records';
import { PharmacistAdviceWidget } from '../components/pharmacist-advice-widget';
import { LabTrendChart, LabTrendData } from '../components/lab-trend-chart';
import { VitalSignCard } from '../components/vital-signs-card';
import { useCallback, useEffect, useState } from 'react';
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
  Trash2
} from 'lucide-react';
import { LabDataDisplay } from '../components/lab-data-display';

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
  RespiratoryRate: '呼吸速率', Temperature: '體溫', BloodPressure: '血壓',
  HeartRate: '心率', SpO2: '血氧飽和度', EtCO2: '呼氣末二氧化碳',
  CVP: '中心靜脈壓', ICP: '顱內壓', FiO2: '吸入氧濃度',
  PEEP: '呼氣末正壓', TidalVolume: '潮氣量', VentRR: '呼吸器設定呼吸速率',
  PIP: '尖峰吸氣壓', Plateau: '平台壓', Compliance: '肺順應性',
  Na: '鈉', K: '鉀', Cl: '氯', BUN: '血中尿素氮', Scr: '肌酐酸',
  WBC: '白血球', Hb: '血紅素', PLT: '血小板', CRP: 'C反應蛋白',
  pH: '酸鹼值', PCO2: '二氧化碳分壓', PO2: '氧分壓', Lactate: '乳酸'
};

// 檢驗項目所屬分類對照
const LAB_CATEGORY_MAP: Record<string, string> = {
  Na: 'biochemistry', K: 'biochemistry', Cl: 'biochemistry',
  BUN: 'biochemistry', Scr: 'biochemistry', eGFR: 'biochemistry',
  Alb: 'biochemistry', Ca: 'biochemistry', Mg: 'biochemistry',
  WBC: 'hematology', Hb: 'hematology', PLT: 'hematology',
  pH: 'bloodGas', PCO2: 'bloodGas', PO2: 'bloodGas', Lactate: 'bloodGas',
  CRP: 'inflammatory',
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
  const [expandedExplanations, setExpandedExplanations] = useState<Set<number>>(new Set()); // 追蹤哪些訊息的說明區塊是展開的
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(new Set()); // 追蹤哪些訊息的參考依據區塊是展開的
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
  const [medications, setMedications] = useState<Medication[]>([]);
  const [medicationsLoading, setMedicationsLoading] = useState(false);

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

  // 生命徵象折線圖狀態
  const [selectedVitalSign, setSelectedVitalSign] = useState<{
    name: string;
    nameChinese: string;
    unit: string;
    value: number;
  } | null>(null);

  // 趨勢資料狀態
  const [trendChartData, setTrendChartData] = useState<LabTrendData[]>([]);
  const [trendReferenceRange, setTrendReferenceRange] = useState('');

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
        medicationsApi.getMedications(id).catch(() => ({ medications: [], total: 0 })),
        messagesApi.getMessages(id).catch(() => ({ messages: [], total: 0, unreadCount: 0 })),
        vitalSignsApi.getLatestVitalSigns(id).catch(() => null),
        ventilatorApi.getLatestVentilatorSettings(id).catch(() => null),
        ventilatorApi.getWeaningAssessment(id).catch(() => null)
      ]);

      setPatient(patientData as PatientWithFrontendFields);
      setLabData(labDataResult);
      setMedications(medicationsResult.medications);
      setMessages(messagesResult.messages);
      setUnreadCount(messagesResult.unreadCount);
      setVitalSigns(vitalSignsResult);
      setVentilator(ventilatorResult);
      setWeaningAssessment(weaningResult);

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

  // P3-6: 載入 RAG 索引狀態
  useEffect(() => {
    getRAGStatus().then(setRagStatus).catch(() => setRagStatus(null));
  }, []);

  // 選取生命徵象/檢驗項目時，從後端 API 載入趨勢資料
  useEffect(() => {
    if (!selectedVitalSign || !id) {
      setTrendChartData([]);
      setTrendReferenceRange('');
      return;
    }

    const fetchTrend = async () => {
      try {
        const response = await labDataApi.getLabTrends(id, { days: 7 });
        const labName = selectedVitalSign.name;
        const category = LAB_CATEGORY_MAP[labName];
        const points: LabTrendData[] = [];
        let refRange = '';

        if (category) {
          for (const record of response.trends || []) {
            const catData = (record as unknown as Record<string, unknown>)[category] as
              | Record<string, { value: number; referenceRange?: string }>
              | undefined;
            if (catData && catData[labName]) {
              points.push({
                date: record.timestamp?.split('T')[0] || '',
                value: catData[labName].value,
              });
              if (!refRange && catData[labName].referenceRange) {
                refRange = catData[labName].referenceRange!;
              }
            }
          }
        }

        setTrendChartData(points);
        setTrendReferenceRange(refRange);
      } catch {
        setTrendChartData([]);
        setTrendReferenceRange('');
      }
    };

    fetchTrend();
  }, [selectedVitalSign, id]);

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
    const messagesWithUser = [
      ...chatMessages,
      { role: 'user' as const, content: userMessage }
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

  const handleVitalSignClick = (labName: string, value: number, unit: string) => {
    setSelectedVitalSign({
      name: labName,
      nameChinese: LAB_CHINESE_NAMES_MAP[labName] || labName,
      unit,
      value
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* 頁首資訊條 */}
      <Card className="border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/patients')} className="hover:bg-[#f8f9fa]">
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
        <TabsList className="grid w-full grid-cols-6 h-16 bg-[#f8f9fa] border-2 border-[#e5e7eb] gap-1 p-1">
          <TabsTrigger value="chat" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-lg">
            <MessageSquare className="mr-2 h-5 w-5" />
            對話助手
          </TabsTrigger>
          <TabsTrigger value="messages" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white relative rounded-lg">
            <MessagesSquare className="mr-2 h-5 w-5" />
            留言板
            {messages.filter(m => !m.isRead).length > 0 && (
              <Badge className="ml-2 bg-[#ff3975] text-white px-2 py-0.5 text-xs">
                {messages.filter(m => !m.isRead).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="records" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-lg">
            <FileText className="mr-2 h-5 w-5" />
            病歷記錄
          </TabsTrigger>
          <TabsTrigger value="labs" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-lg">
            <TestTube className="mr-2 h-5 w-5" />
            檢驗數據
          </TabsTrigger>
          <TabsTrigger value="meds" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-lg">
            <Pill className="mr-2 h-5 w-5" />
            用藥
          </TabsTrigger>
          <TabsTrigger value="summary" className="text-[15px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-lg">
            <FileText className="mr-2 h-5 w-5" />
            病歷摘要
          </TabsTrigger>
        </TabsList>

        {/* 對話助手 */}
        <TabsContent value="chat" className="space-y-4">
          <div className="grid grid-cols-12 gap-4">
            {/* 左側對話記錄列表 */}
            {showSessionList && (
              <div className="col-span-3">
                <Card className="border-2">
                  <CardHeader className="bg-[#f8f9fa] border-b-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <History className="h-5 w-5 text-[#7f265b]" />
                        對話記錄
                      </CardTitle>
                      <Button
                        size="sm"
                        className="bg-[#7f265b] hover:bg-[#631e4d]"
                        onClick={() => {
                          setSelectedSession(null);
                          setChatMessages([]);
                          setSessionTitle('');
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        新對話
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[600px]">
                      {chatSessions.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground">
                          <p className="text-sm">尚無對話記錄</p>
                        </div>
                      ) : (
                        <div className="space-y-1 p-2">
	                          {chatSessions.map((session) => (
	                            <button
	                              key={session.id}
	                              onClick={async () => {
	                                setSelectedSession(session);
	                                setSessionTitle(session.title);
	                                try {
		                                  const detail = await fetchChatSessionApi(session.id);
		                                  setChatMessages((detail.messages || []).map(m => ({
		                                    role: (m.role === 'assistant' ? 'assistant' : 'user'),
		                                    content: m.content,
		                                    explanation: m.explanation || null,
		                                    references: m.citations || [],
			                                    warnings: m.safetyWarnings || null,
			                                    requiresExpertReview: m.requiresExpertReview || false,
			                                    degraded: m.degraded || false,
			                                    degradedReason: m.degradedReason || null,
			                                    upstreamStatus: m.upstreamStatus || null,
			                                    dataFreshness: m.dataFreshness || null,
			                                  })));
			                                } catch {
	                                  toast.error('載入對話內容失敗');
	                                  setChatMessages([]);
	                                }
	                              }}
	                              className={`w-full text-left p-3 rounded-lg border-2 transition-all hover:bg-[#f8f9fa] ${
	                                selectedSession?.id === session.id
	                                  ? 'bg-[#f8f9fa] border-[#7f265b]'
	                                  : 'border-transparent'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm text-[#1a1a1a] truncate">
                                    {session.title}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-xs">
                                      {session.sessionDate}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {session.sessionTime}
                                    </span>
                                  </div>
                                  {session.labDataSnapshot && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      K: {formatSnapshotValue(session.labDataSnapshot.K)} • eGFR: {formatSnapshotValue(session.labDataSnapshot.eGFR)}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
	                                <Badge className="bg-[#7f265b] text-white text-xs">
	                                  {session.messageCount ?? session.messages.length}
	                                </Badge>
                                  <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="p-1 rounded hover:bg-red-100 text-muted-foreground hover:text-red-600 transition-colors"
                                    title="刪除對話"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </button>
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
              <Card className="border-2">
                <CardHeader className="bg-[#f8f9fa] border-b-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {selectedSession ? (
                        <div>
                          <CardTitle className="text-xl">{selectedSession.title}</CardTitle>
                          <CardDescription className="text-[15px] mt-1">
                            {selectedSession.sessionDate} {selectedSession.sessionTime} • 最後更新：{selectedSession.lastUpdated}
                          </CardDescription>
                        </div>
                      ) : (
                        <div>
                          <CardTitle className="text-xl">新對話</CardTitle>
                          <CardDescription className="text-[15px] mt-1">
                            與 AI 助手討論病患照護問題
                          </CardDescription>
                        </div>
                      )}
                    </div>
	                    <div className="flex items-center gap-2">
	                      {aiReadiness && (
	                        <Badge
	                          variant="outline"
	                          className={
	                            canSendAiChat
	                              ? 'border-green-300 bg-green-50 text-green-700'
	                              : 'border-amber-300 bg-amber-50 text-amber-700'
	                          }
	                        >
	                          {canSendAiChat ? 'AI 就緒' : 'AI 未就緒'}
	                        </Badge>
	                      )}
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        onClick={refreshAiReadiness}
	                        disabled={isCheckingAiReadiness}
	                      >
	                        <RefreshCw className={`mr-2 h-4 w-4 ${isCheckingAiReadiness ? 'animate-spin' : ''}`} />
	                        檢查 AI 狀態
	                      </Button>
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        onClick={() => loadPatientBundle('refresh')}
	                        disabled={isRefreshingPatientData}
	                      >
	                        <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingPatientData ? 'animate-spin' : ''}`} />
	                        更新患者數值
	                      </Button>
	                      <Button
	                        variant="ghost"
	                        size="sm"
	                        onClick={() => setShowSessionList(!showSessionList)}
	                      >
	                        {showSessionList ? '隱藏' : '顯示'}記錄
	                      </Button>
	                    </div>
                  </div>
                  {!selectedSession && chatMessages.length > 0 && (
                    <div className="mt-3">
                      <label className="text-sm font-medium text-[#1a1a1a]">對話標題（選填）</label>
                      <input
                        type="text"
                        value={sessionTitle}
                        onChange={(e) => setSessionTitle(e.target.value)}
                        placeholder="例如：鎮靜深度評估與血鉀討論"
                        className="mt-1 w-full px-3 py-2 border-2 border-[#e5e7eb] rounded-lg focus:border-[#7f265b] focus:outline-none"
                      />
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {/* 免責聲明 banner */}
                  <div className="text-xs text-[#6b7280] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚕️ 本對話由 AI 輔助產生，僅供臨床參考，不可取代醫師專業判斷。任何治療決策應以主治醫師評估為準。
                  </div>
                  {!canSendAiChat && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                      {aiChatGateReason}
                    </div>
                  )}

                  {/* 對話區 */}
                  <div className="border-2 border-[#e5e7eb] rounded-lg p-4 min-h-[500px] max-h-[600px] overflow-y-auto space-y-4 bg-[#f8f9fa]">
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="h-16 w-16 mx-auto mb-4 text-[#7f265b] opacity-30" />
                        <p className="text-[17px] font-medium">開始對話以獲得 AI 協助</p>
                        <p className="text-sm text-[#6b7280] mt-2">可以詢問檢驗數據、用藥建議、治療指引等</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`relative max-w-[80%] rounded-lg p-4 space-y-2 ${
                              msg.role === 'user'
                                ? 'bg-[#7f265b] text-white shadow-md'
                                : 'bg-white border-2 border-[#e5e7eb] text-[#1a1a1a] shadow-sm'
                            }`}
                          >
		                            {msg.role === 'assistant' ? (
		                              <div>
		                                <AiMarkdown content={msg.content} className="text-[16px] pr-2" />
				                                {msg.explanation && msg.explanation.trim().length > 0 && (() => {
				                                  const isExplanationExpanded = expandedExplanations.has(idx);
				                                  return (
				                                    <div className="mt-2">
				                                      <button
				                                        onClick={() => {
				                                          setExpandedExplanations((prev) => {
				                                            const next = new Set(prev);
				                                            if (isExplanationExpanded) {
				                                              next.delete(idx);
				                                            } else {
				                                              next.add(idx);
				                                            }
				                                            return next;
				                                          });
				                                        }}
				                                        className="text-xs text-[#7f265b] hover:text-[#631e4d] font-medium"
				                                      >
				                                        {isExplanationExpanded ? '收起說明' : '展開說明'}
				                                      </button>
				                                      {isExplanationExpanded && (
				                                        <div className="mt-1.5 rounded border border-[#d1d5db] bg-[#f8f9fa] p-2.5">
				                                          <AiMarkdown content={msg.explanation} className="text-[14px]" />
				                                        </div>
				                                      )}
				                                    </div>
				                                  );
				                                })()}
					                                <SafetyWarnings warnings={msg.warnings} />
				                                {msg.requiresExpertReview && (
		                                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
		                                    此 AI 回覆包含潛在高風險資訊，建議由醫師/藥師覆核後再採用。
		                                  </div>
		                                )}
		                              </div>
		                            ) : (
		                              <p className="whitespace-pre-wrap text-[16px] leading-relaxed pr-2">{msg.content}</p>
		                            )}
		                            {msg.role === 'assistant' && (() => {
		                              const references = msg.references || [];
		                              const freshnessHints = getDisplayFreshnessHints(msg.dataFreshness);
		                              const isExpanded = expandedReferences.has(idx);
		                              return (
		                                <div className="mt-3 pt-3 border-t border-[#e5e7eb] space-y-2">
		                                  <button
		                                    onClick={() => {
	                                      const newExpanded = new Set(expandedReferences);
	                                      if (isExpanded) {
	                                        newExpanded.delete(idx);
                                      } else {
                                        newExpanded.add(idx);
                                      }
                                      setExpandedReferences(newExpanded);
                                    }}
	                                    className="w-full text-left hover:bg-[#f8f9fa]/50 rounded p-2 transition-colors"
	                                  >
	                                    <div className="flex items-center justify-between gap-2">
	                                      <div className="flex items-center gap-1">
	                                        <BookOpen className="h-3 w-3 text-[#7f265b]" />
	                                        <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
	                                        <Badge variant="outline" className="ml-1 text-xs bg-white">
	                                          {references.length}
	                                        </Badge>
	                                      </div>
                                      <div className="flex items-center gap-1 text-xs text-[#7f265b]">
                                        <span className="font-medium">{isExpanded ? '收起' : '展開'}</span>
                                        <svg 
                                          className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                          fill="none" 
                                          viewBox="0 0 24 24" 
                                          stroke="currentColor"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </div>
                                    </div>
                                  </button>
		                                  {isExpanded && (
		                                    <div className="bg-[#f8f9fa] rounded p-2.5 border border-[#e5e7eb] mt-2">
		                                      {references.length === 0 ? (
		                                        <p className="text-xs text-[#6b7280]">
		                                          本次回答未擷取到可顯示的文獻段落，可改用更具體關鍵詞再詢問。
		                                        </p>
		                                      ) : (
		                                      <ul className="space-y-2">
		                                        {references.map((ref, refIdx) => (
		                                          <li key={`${ref.id || 'ref'}-${refIdx}`} className="text-xs text-muted-foreground">
		                                            <div className="flex items-start gap-1">
		                                              <span className="text-[#7f265b] mt-0.5">•</span>
	                                              <div className="flex-1">
                                                <p className="font-medium text-[#374151]">
                                                  {ref.title || ref.sourceFile || 'unknown'}
                                                </p>
	                                                <p className="text-[11px] text-muted-foreground mt-0.5">
	                                                  {(ref.sourceFile || ref.source || 'unknown')}
	                                                  {' • '}
	                                                  {formatCitationPageText(ref)}
	                                                  {' • '}
	                                                  相關度 {Number.isFinite(Number(ref.relevance)) ? Number(ref.relevance).toFixed(3) : 'N/A'}
	                                                </p>
	                                                {typeof ref.snippetCount === 'number' && ref.snippetCount > 1 && (
	                                                  <p className="text-[11px] text-[#6b7280] mt-0.5">已合併 {ref.snippetCount} 段引用</p>
	                                                )}
	                                                {ref.snippet && ref.snippet.trim().length > 0 ? (
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
		                                  {(msg.degraded || freshnessHints.length > 0) && (
		                                    <div className="rounded border border-[#d1d5db] bg-[#f9fafb] px-2.5 py-2 text-[11px] text-[#6b7280]">
		                                      {msg.degraded && (
		                                        <p>系統狀態：{formatAiDegradedReason(msg.degradedReason, msg.upstreamStatus)}</p>
		                                      )}
		                                      {freshnessHints.length > 0 && (
		                                        <p>資料品質：{freshnessHints.join(' ')}</p>
		                                      )}
		                                    </div>
		                                  )}
		                                </div>
		                              );
		                            })()}
                            {msg.role === 'assistant' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute bottom-2 right-2 h-7 w-7 opacity-60 hover:opacity-100 hover:bg-[#f8f9fa]"
                                onClick={async () => {
                                  const success = await copyToClipboard(msg.content);
                                  if (success) {
                                    toast.success('已複製到剪貼簿');
                                  } else {
                                    toast.error('複製失敗，請手動複製');
                                  }
                                }}
                              >
                                <Copy className="h-4 w-4 text-[#7f265b]" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* 輸入區 */}
                  <div className="space-y-2">
                    <div className="flex gap-3">
                      <Textarea
                        placeholder={canSendAiChat ? "例如：這位病患的鎮靜深度是否適當？" : "AI 功能未就緒，請先修復 readiness 問題"}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className="min-h-[80px] border-2 border-[#7f265b] focus:border-[#7f265b] focus:ring-2 focus:ring-[#7f265b]/20 text-[17px]"
                        disabled={!canSendAiChat}
                      />
                      <Button onClick={handleSendMessage} size="icon" className="h-[80px] w-[80px] bg-[#7f265b] hover:bg-[#5f1e45]" disabled={isSending || !chatInput.trim() || !canSendAiChat}>
                        {isSending ? <RefreshCw className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
                      </Button>
                    </div>
                    <p className="text-sm text-[#6b7280]">按 Enter 發送，Shift + Enter 換行</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Progress Note 功能已統一至「病歷記錄」tab */}

          {/* RAG 來源側欄 - 已移除 */}
        </TabsContent>

        {/* 留言板 */}
        <TabsContent value="messages" className="space-y-4">
          <Card className="border-2">
            <CardHeader className="bg-[#f8f9fa] border-b-2">
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
              <div className="space-y-2 p-4 bg-[#f8f9fa] rounded-lg border-2 border-[#e5e7eb]">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-[#7f265b]" />
                  <label className="font-semibold text-[#1a1a1a]">新增留言</label>
                </div>
                <Textarea
                  placeholder="輸入照護相關訊息或用藥建議..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="min-h-[80px] border-2 border-[#7f265b] focus:border-[#7f265b] focus:ring-2 focus:ring-[#7f265b]/20 text-[17px]"
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
              <div className="space-y-3">
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
                        className={`border-2 ${getMessageTypeColor()} ${!message.isRead ? 'shadow-md' : ''}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-white rounded-full border-2">
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
                        <CardContent>
                          <p className="text-[16px] leading-relaxed whitespace-pre-wrap">
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
        <TabsContent value="labs" className="space-y-6">
          {/* 生命徵象 */}
          <Card className="border-2">
            <CardHeader className="bg-[#f8f9fa] border-b-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Activity className="h-6 w-6 text-[#7f265b]" />
                生命徵象 Vital Signs
              </CardTitle>
              {vitalSigns && (
                <CardDescription className="text-[15px] mt-2">
                  📅 {new Date(vitalSigns.timestamp).toLocaleString('zh-TW')}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              {vitalSignsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" text="載入生命徵象..." />
                </div>
              ) : vitalSigns ? (
                <div className="grid gap-4 md:grid-cols-4">
                  <VitalSignCard
                    label="Respiratory Rate"
                    value={vitalSigns.respiratoryRate}
                    unit="rpm"
                    isAbnormal={vitalSigns.respiratoryRate > 25 || vitalSigns.respiratoryRate < 12}
                    onClick={() => handleVitalSignClick('RespiratoryRate', vitalSigns.respiratoryRate, 'rpm')}
                  />

                  <VitalSignCard
                    label="Temperature"
                    value={vitalSigns.temperature}
                    unit="°C"
                    isAbnormal={vitalSigns.temperature > 37.5 || vitalSigns.temperature < 36}
                    onClick={() => handleVitalSignClick('Temperature', vitalSigns.temperature, '°C')}
                  />

                  <VitalSignCard
                    label="Blood Pressure"
                    value={vitalSigns.bloodPressure.systolic}
                    unit="mmHg"
                    secondaryValue={`${vitalSigns.bloodPressure.systolic}/${vitalSigns.bloodPressure.diastolic}`}
                    isAbnormal={vitalSigns.bloodPressure.systolic > 140 || vitalSigns.bloodPressure.systolic < 90}
                    onClick={() => handleVitalSignClick('BloodPressure', vitalSigns.bloodPressure.systolic, 'mmHg')}
                  />

                  <VitalSignCard
                    label="Heart Rate"
                    value={vitalSigns.heartRate}
                    unit="bpm"
                    isAbnormal={vitalSigns.heartRate > 100 || vitalSigns.heartRate < 60}
                    onClick={() => handleVitalSignClick('HeartRate', vitalSigns.heartRate, 'bpm')}
                  />

                  <VitalSignCard
                    label="SpO₂"
                    value={vitalSigns.spo2}
                    unit="%"
                    isAbnormal={vitalSigns.spo2 < 94}
                    onClick={() => handleVitalSignClick('SpO2', vitalSigns.spo2, '%')}
                  />

                  {vitalSigns.etco2 && (
                    <VitalSignCard
                      label="EtCO₂"
                      value={vitalSigns.etco2}
                      unit="mmHg"
                      isAbnormal={vitalSigns.etco2 > 45 || vitalSigns.etco2 < 35}
                      onClick={() => handleVitalSignClick('EtCO2', vitalSigns.etco2!, 'mmHg')}
                    />
                  )}

                  {vitalSigns.cvp !== undefined && (
                    <VitalSignCard
                      label="CVP"
                      value={vitalSigns.cvp}
                      unit="mmHg"
                      isAbnormal={vitalSigns.cvp > 12 || vitalSigns.cvp < 2}
                      onClick={() => handleVitalSignClick('CVP', vitalSigns.cvp!, 'mmHg')}
                    />
                  )}

                  {vitalSigns.icp !== undefined && (
                    <VitalSignCard
                      label="ICP"
                      value={vitalSigns.icp}
                      unit="mmHg"
                      isAbnormal={vitalSigns.icp > 20}
                      onClick={() => handleVitalSignClick('ICP', vitalSigns.icp!, 'mmHg')}
                    />
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="無生命徵象數據"
                  description="目前沒有此病人的生命徵象記錄"
                />
              )}
            </CardContent>
          </Card>

          {/* 呼吸器設定 - 僅在插管病人顯示 */}
          {patient.intubated && (
            <Card className="border-2">
              <CardHeader className="bg-[#f8f9fa] border-b-2">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Wind className="h-6 w-6 text-[#7f265b]" />
                  呼吸器設定 Ventilator Settings
                </CardTitle>
                {ventilator && (
                  <CardDescription className="text-[15px] mt-2">
                    📅 {new Date(ventilator.timestamp).toLocaleString('zh-TW')} | Mode: {ventilator.mode}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-4">
                {ventilatorLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner size="md" text="載入呼吸器設定..." />
                  </div>
                ) : ventilator ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <VitalSignCard
                        label="FiO₂"
                        value={ventilator.fio2}
                        unit="%"
                        isAbnormal={ventilator.fio2 > 60}
                        onClick={() => handleVitalSignClick('FiO2', ventilator.fio2, '%')}
                      />
                      <VitalSignCard
                        label="PEEP"
                        value={ventilator.peep}
                        unit="cmH₂O"
                        isAbnormal={ventilator.peep > 12}
                        onClick={() => handleVitalSignClick('PEEP', ventilator.peep, 'cmH₂O')}
                      />
                      <VitalSignCard
                        label="Vt"
                        value={ventilator.tidalVolume}
                        unit="mL"
                        isAbnormal={ventilator.tidalVolume > 500}
                        onClick={() => handleVitalSignClick('TidalVolume', ventilator.tidalVolume, 'mL')}
                      />
                      <VitalSignCard
                        label="RR (Set)"
                        value={ventilator.respiratoryRate}
                        unit="/min"
                        onClick={() => handleVitalSignClick('VentRR', ventilator.respiratoryRate, '/min')}
                      />
                      {ventilator.pip && (
                        <VitalSignCard
                          label="PIP"
                          value={ventilator.pip}
                          unit="cmH₂O"
                          isAbnormal={ventilator.pip > 30}
                          onClick={() => handleVitalSignClick('PIP', ventilator.pip!, 'cmH₂O')}
                        />
                      )}
                      {ventilator.plateau && (
                        <VitalSignCard
                          label="Pplat"
                          value={ventilator.plateau}
                          unit="cmH₂O"
                          isAbnormal={ventilator.plateau > 30}
                          onClick={() => handleVitalSignClick('Plateau', ventilator.plateau!, 'cmH₂O')}
                        />
                      )}
                      {ventilator.compliance && (
                        <VitalSignCard
                          label="Compliance"
                          value={ventilator.compliance}
                          unit="mL/cmH₂O"
                          isAbnormal={ventilator.compliance < 30}
                          onClick={() => handleVitalSignClick('Compliance', ventilator.compliance!, 'mL/cmH₂O')}
                        />
                      )}
                    </div>

                    {/* 脫機評估 */}
                    {weaningAssessment && (
                      <Card className="bg-blue-50 border-blue-200">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Stethoscope className="h-5 w-5 text-blue-600" />
                            脫機評估 Weaning Assessment
                          </CardTitle>
                          <CardDescription>
                            評估時間: {new Date(weaningAssessment.timestamp).toLocaleString('zh-TW')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-4 md:grid-cols-4 mb-4">
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">RSBI</p>
                              <p className={`text-2xl font-bold ${weaningAssessment.rsbi > 105 ? 'text-red-600' : 'text-green-600'}`}>
                                {weaningAssessment.rsbi}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">NIF</p>
                              <p className={`text-2xl font-bold ${weaningAssessment.nif > -25 ? 'text-red-600' : 'text-green-600'}`}>
                                {weaningAssessment.nif} cmH₂O
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">準備度分數</p>
                              <p className={`text-2xl font-bold ${weaningAssessment.readinessScore >= 70 ? 'text-green-600' : 'text-orange-600'}`}>
                                {weaningAssessment.readinessScore}%
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">建議</p>
                              <Badge className={weaningAssessment.recommendation.includes('可以') ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}>
                                {weaningAssessment.recommendation}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    icon={Wind}
                    title="無呼吸器數據"
                    description="目前沒有此病人的呼吸器設定記錄"
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* 檢驗數據 */}
          <Card className="border-2">
            <CardHeader className="bg-[#f8f9fa] border-b-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <TestTube className="h-6 w-6 text-[#7f265b]" />
                檢驗數據 Lab Data
              </CardTitle>
              <CardDescription className="text-[15px] mt-2">
                📅 {labData?.timestamp || '無資料'}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <LabDataDisplay labData={labData} patientId={patient.id} />
            </CardContent>
          </Card>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              檢驗數據由管理者上傳與解析，醫護可進行小幅校正並需填寫更動理由。
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* 用藥 */}
        <TabsContent value="meds" className="space-y-4">
          {medicationsLoading ? (
            <MedicationsSkeleton />
          ) : (
            <>
              {/* S/A/N 藥物 */}
              <div className="grid gap-4 md:grid-cols-3">
                {/* Pain (A) */}
                <Card className="border-2 border-[#e5e7eb]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Pain 止痛</CardTitle>
                    <CardDescription>
                      {medications.find(m => m.sanCategory === 'A')?.indication || 'Pain Score: -'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {medications.filter(m => m.sanCategory === 'A' && m.status === 'active').length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">無止痛藥物</p>
                    ) : (
                      <div className="space-y-2">
                        {medications.filter(m => m.sanCategory === 'A' && m.status === 'active').map(med => (
                          <div key={med.id} className="bg-white/80 p-3 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{med.name}</span>
                              <Badge className="bg-green-100 text-green-800">A</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {med.dose}{med.unit} {med.frequency} {med.prn ? 'prn' : ''} {med.route}
                            </p>
                            {med.warnings && med.warnings.length > 0 && (
                              <p className="text-xs text-orange-600 mt-1">⚠️ {med.warnings[0]}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Sedation (S) */}
                <Card className="border-2 border-[#e5e7eb]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Sedation 鎮靜</CardTitle>
                    <CardDescription>
                      {medications.find(m => m.sanCategory === 'S')?.indication || 'RASS Score: -'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {medications.filter(m => m.sanCategory === 'S' && m.status === 'active').length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">無鎮靜藥物</p>
                    ) : (
                      <div className="space-y-2">
                        {medications.filter(m => m.sanCategory === 'S' && m.status === 'active').map(med => (
                          <div key={med.id} className="bg-white/80 p-3 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{med.name}</span>
                              <Badge className="bg-blue-100 text-blue-800">S</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {med.dose}{med.unit} {med.frequency} {med.prn ? 'prn' : ''} {med.route}
                            </p>
                            {med.warnings && med.warnings.length > 0 && (
                              <p className="text-xs text-orange-600 mt-1">⚠️ {med.warnings[0]}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Neuromuscular Blockade (N) */}
                <Card className="border-2 border-[#e5e7eb]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-sm">Neuromuscular Blockade 神經肌肉阻斷</CardTitle>
                    <CardDescription>
                      {medications.find(m => m.sanCategory === 'N')?.indication || ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {medications.filter(m => m.sanCategory === 'N' && m.status === 'active').length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">無神經肌肉阻斷藥物</p>
                    ) : (
                      <div className="space-y-2">
                        {medications.filter(m => m.sanCategory === 'N' && m.status === 'active').map(med => (
                          <div key={med.id} className="bg-white/80 p-3 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{med.name}</span>
                              <Badge className="bg-purple-100 text-purple-800">N</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {med.dose}{med.unit} {med.frequency} {med.prn ? 'prn' : ''} {med.route}
                            </p>
                            {med.warnings && med.warnings.length > 0 && (
                              <p className="text-xs text-orange-600 mt-1">⚠️ {med.warnings[0]}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Other Medications */}
              <Card className="border-2 border-[#e5e7eb]">
                <CardHeader>
                  <CardTitle>其他藥物 Other Medications</CardTitle>
                </CardHeader>
                <CardContent>
                  {medications.filter(m => !m.sanCategory && m.status === 'active').length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">無其他藥物</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-3">
                      {medications.filter(m => !m.sanCategory && m.status === 'active').map(med => (
                        <div key={med.id} className="bg-[rgba(196,196,196,0.2)] p-3 rounded-[20px]">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{med.name}</span>
                            <span className="text-sm">
                              <span className="text-xl font-bold">{med.dose}</span>{' '}
                              <span className="text-muted-foreground">{med.unit} {med.frequency}</span>
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{med.route}</p>
                          {med.warnings && med.warnings.length > 0 && (
                            <p className="text-xs text-orange-600 mt-1">⚠️ {med.warnings[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* 藥師用藥建議（僅藥師可見） */}
          {(user?.role === 'pharmacist' || user?.role === 'admin') && (
            <PharmacistAdviceWidget 
              patientId={patient.id} 
              patientName={patient.name}
              aiReadiness={aiReadiness}
            />
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="border-[#7f265b] text-[#7f265b] hover:bg-[#7f265b] hover:text-white" onClick={() => navigate('/pharmacy/interactions')}>
              交互作用查詢
            </Button>
            <Button variant="outline">
              <Copy className="mr-2 h-4 w-4" />
              複製到報告
            </Button>
          </div>
        </TabsContent>

        {/* 病歷摘要 */}
        <TabsContent value="summary" className="space-y-4" forceMount>
          <PatientSummaryTab
            patient={patient}
            userRole={user?.role}
            ragStatus={ragStatus}
            aiReadiness={aiReadiness}
          />
        </TabsContent>
      </Tabs>

      {/* 生命徵象折線圖對話框 */}
      {selectedVitalSign && (
        <LabTrendChart
          isOpen={!!selectedVitalSign}
          onClose={() => setSelectedVitalSign(null)}
          labName={selectedVitalSign.name}
          labNameChinese={selectedVitalSign.nameChinese}
          currentValue={selectedVitalSign.value}
          unit={selectedVitalSign.unit}
          trendData={trendChartData}
          referenceRange={trendReferenceRange}
        />
      )}
    </div>
  );
}
