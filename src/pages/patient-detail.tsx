// Patient detail page
import { MedicalRecords } from '../components/medical-records';
import { LabTrendChart } from '../components/lab-trend-chart';
import { VitalSignCard } from '../components/vital-signs-card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { patientsApi, labDataApi, medicationsApi, messagesApi, vitalSignsApi, ventilatorApi, type Patient, type LabData, type Medication, type PatientMessage, type VitalSigns, type VentilatorSettings, type WeaningAssessment } from '../lib/api';
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
  const [activeTab, setActiveTab] = useState('messages');

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
        <TabsList className="grid w-full grid-cols-5 h-[44px] bg-slate-50 dark:bg-slate-800 border border-border gap-0.5 p-0.5">
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
