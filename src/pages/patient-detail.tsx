import { MedicalRecords } from '../components/medical-records';
import { PharmacistAdviceWidget } from '../components/pharmacist-advice-widget';
import { LabTrendChart, LabTrendData } from '../components/lab-trend-chart';
import { VitalSignCard } from '../components/vital-signs-card';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sendChatMessage, getChatSessions as fetchChatSessionsApi } from '../lib/api/ai';
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
import { LabDataSkeleton, MedicationsSkeleton, MessageListSkeleton } from '../components/ui/skeletons';
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
  Sparkles,
  Stethoscope,
  Info,
  RefreshCw,
  Plus,
  Save,
  History,
  BookOpen
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
  timestamp?: string;
  references?: string[];
}


export function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('chat');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string, references?: string[] }>>([]);
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(new Set()); // 追蹤哪些參考依據是展開的
  const [progressNoteInput, setProgressNoteInput] = useState('');
  const [polishedNote, setPolishedNote] = useState('');
  const [medAdviceInput, setMedAdviceInput] = useState('');
  const [polishedAdvice, setPolishedAdvice] = useState('');
  const [isSending, setIsSending] = useState(false);

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

  // 載入病人資料、檢驗數據、用藥數據、留言、生命徵象和呼吸器數據
  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      try {
        setPatientLoading(true);
        setMedicationsLoading(true);
        setMessagesLoading(true);
        setVitalSignsLoading(true);
        setVentilatorLoading(true);
        setPatientError(null);

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
          })));
        } catch {
          setChatSessions([]);
        }
      } catch (err) {
        console.error('載入病人資料失敗:', err);
        setPatientError('無法載入病人資料');
      } finally {
        setPatientLoading(false);
        setMedicationsLoading(false);
        setMessagesLoading(false);
        setVitalSignsLoading(false);
        setVentilatorLoading(false);
      }
    };
    fetchData();
  }, [id]);

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
            const catData = (record as Record<string, unknown>)[category] as Record<string, { value: number; referenceRange?: string }> | undefined;
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

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return;

    const userMessage = chatInput.trim();
    const messagesWithUser = [
      ...chatMessages,
      { role: 'user' as const, content: userMessage }
    ];
    setChatMessages(messagesWithUser);
    setChatInput('');
    setIsSending(true);

    let finalMessages = messagesWithUser;

    try {
      const response = await sendChatMessage(userMessage, { patientId: id });
      finalMessages = [
        ...messagesWithUser,
        {
          role: 'assistant' as const,
          content: response.message.content,
          references: response.message.citations?.map(c => `${c.title} (${c.source})`) || []
        }
      ];
      setChatMessages(finalMessages);
    } catch (err) {
      console.error('AI 回覆失敗:', err);
      finalMessages = [
        ...messagesWithUser,
        {
          role: 'assistant' as const,
          content: 'AI 助手目前無法回應，請確認後端服務是否正常運行，稍後再試。'
        }
      ];
      setChatMessages(finalMessages);
    } finally {
      setIsSending(false);
    }

    // 自動儲存對話到本地狀態
    const title = sessionTitle.trim() || `對話記錄 ${new Date().toLocaleString('zh-TW')}`;
    const now = new Date();

    if (selectedSession) {
      const updatedSession: ChatSession = {
        ...selectedSession,
        messages: finalMessages.map(m => ({
          ...m,
          timestamp: new Date().toLocaleString('zh-TW')
        })),
        lastUpdated: new Date().toLocaleString('zh-TW'),
        labDataSnapshot: {
          K: labData.biochemistry.K,
          Na: labData.biochemistry.Na,
          Scr: labData.biochemistry.Scr,
          eGFR: labData.biochemistry.eGFR,
          CRP: labData.inflammatory.CRP,
          WBC: labData.hematology.WBC
        }
      };
      setChatSessions(chatSessions.map(s => s.id === selectedSession.id ? updatedSession : s));
      setSelectedSession(updatedSession);
    } else {
      const newSession: ChatSession = {
        id: `chat${Date.now()}`,
        patientId: patient.id,
        sessionDate: now.toISOString().split('T')[0],
        sessionTime: now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        title,
        messages: finalMessages.map(m => ({
          ...m,
          timestamp: new Date().toLocaleString('zh-TW')
        })),
        lastUpdated: new Date().toLocaleString('zh-TW'),
        labDataSnapshot: {
          K: labData.biochemistry.K,
          Na: labData.biochemistry.Na,
          Scr: labData.biochemistry.Scr,
          eGFR: labData.biochemistry.eGFR,
          CRP: labData.inflammatory.CRP,
          WBC: labData.hematology.WBC
        }
      };
      setChatSessions([newSession, ...chatSessions]);
      setSelectedSession(newSession);
    }
  };

  const handlePolishProgressNote = () => {
    if (!progressNoteInput.trim()) return;
    
    const polished = `Assessment:
Patient remains intubated on day ${Math.floor((new Date().getTime() - new Date(patient.icuAdmissionDate).getTime()) / (1000 * 60 * 60 * 24))} of ICU stay. Currently receiving mechanical ventilation. Hemodynamics stable on current support.

Laboratory findings show potassium ${labData?.biochemistry.K || '3.5'} mEq/L, creatinine ${labData?.biochemistry.Scr || '1.0'} mg/dL, with eGFR ${labData?.biochemistry.eGFR || '60'} mL/min. Inflammatory markers: CRP ${labData?.inflammatory.CRP || '5'} mg/L.

Plan:
- Continue current ventilator settings
- Monitor electrolytes and adjust supplementation as needed
- Titrate sedation to target RASS -2
- Daily assessment for extubation readiness`;
    
    setPolishedNote(polished);
  };

  const handlePolishMedAdvice = () => {
    if (!medAdviceInput.trim()) return;
    
    const polished = `Medication Recommendation:

The patient's current potassium level (${labData?.biochemistry.K || '3.5'} mEq/L) is below normal range. Recommend supplementation with potassium chloride 20-40 mEq, with close monitoring every 4-6 hours until normalized.

Concurrent use of Morphine and Dormicum requires careful monitoring for respiratory depression. Suggest daily RASS assessment, targeting RASS -2 to -1 for optimal sedation.

Given renal function (eGFR ${labData?.biochemistry.eGFR || '60'} mL/min), consider dose adjustment for renally cleared medications.`;
    
    setPolishedAdvice(polished);
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
                              onClick={() => {
                                setSelectedSession(session);
                                setChatMessages(session.messages.map(m => ({ role: m.role, content: m.content })));
                                setSessionTitle(session.title);
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
                                      K: {session.labDataSnapshot.K} • eGFR: {session.labDataSnapshot.eGFR}
                                    </div>
                                  )}
                                </div>
                                <Badge className="bg-[#7f265b] text-white text-xs shrink-0">
                                  {session.messages.length}
                                </Badge>
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          toast.success('已更新患者最新數值');
                        }}
                        className="border-[#f59e0b] text-[#f59e0b] hover:bg-[#f59e0b] hover:text-white"
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
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
                  {/* 對話區 */}
                  <div className="border-2 border-[#e5e7eb] rounded-lg p-4 min-h-[500px] max-h-[600px] overflow-y-auto space-y-4 bg-[#f8f9fa]">
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="h-16 w-16 mx-auto mb-4 text-[#7f265b] opacity-30" />
                        <p className="text-[17px] font-medium">開始對話以獲得 AI 協助</p>
                        <p className="text-sm text-[#6b7280] mt-2">可以詢問檢驗數據、用藥建議、治療指引等</p>
                        <p className="text-xs text-[#6b7280] mt-4 flex items-center justify-center gap-2">
                          <RefreshCw className="h-3 w-3" />
                          建議先點擊「更新患者數值」以獲得最新數據
                        </p>
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
                            <p className="whitespace-pre-wrap text-[16px] leading-relaxed pr-2">{msg.content}</p>
                            {msg.role === 'assistant' && msg.references && msg.references.length > 0 && (() => {
                              const isExpanded = expandedReferences.has(idx);
                              return (
                                <div className="mt-3 pt-3 border-t border-[#e5e7eb]">
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
                                          {msg.references.length}
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
                                      <ul className="space-y-1">
                                        {msg.references.map((ref, refIdx) => (
                                          <li key={refIdx} className="text-xs text-muted-foreground flex items-start gap-1">
                                            <span className="text-[#7f265b] mt-0.5">•</span>
                                            <span>{ref}</span>
                                          </li>
                                        ))}
                                      </ul>
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
                        placeholder="例如：這位病患的鎮靜深度是否適當？"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className="min-h-[80px] border-2 border-[#7f265b] focus:border-[#7f265b] focus:ring-2 focus:ring-[#7f265b]/20 text-[17px]"
                      />
                      <Button onClick={handleSendMessage} size="icon" className="h-[80px] w-[80px] bg-[#7f265b] hover:bg-[#5f1e45]" disabled={isSending || !chatInput.trim()}>
                        {isSending ? <RefreshCw className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
                      </Button>
                    </div>
                    <p className="text-sm text-[#6b7280]">按 Enter 發送，Shift + Enter 換行</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Progress Note 輔助（醫師/專科護理師） */}
          {(user?.role === 'doctor' || user?.role === 'admin') && (
            <Card className="border-2 border-[#7f265b]">
              <CardHeader className="bg-[#f8f9fa]">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <FileText className="h-6 w-6 text-[#7f265b]" />
                  Progress Note 輔助
                </CardTitle>
                <CardDescription className="text-[15px] mt-2">
                  輸入中文或草稿，AI 將協助翻譯修飾為專業英文 Progress Note
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="font-semibold text-[#1a1a1a]">輸入草稿或中文描述</label>
                  <Textarea
                    placeholder="例如：病人今天狀況穩定，血鉀偏低已補充，目前插管中..."
                    value={progressNoteInput}
                    onChange={(e) => setProgressNoteInput(e.target.value)}
                    className="min-h-[100px] border-2"
                  />
                  <Button 
                    onClick={handlePolishProgressNote}
                    className="bg-[#7f265b] hover:bg-[#631e4d]"
                  >
                    <Brain className="mr-2 h-5 w-5" />
                    AI 修飾 & 翻譯
                  </Button>
                </div>

                {polishedNote && (
                  <div className="space-y-2">
                    <label className="font-semibold text-[#1a1a1a]">修飾後的 Progress Note</label>
                    <div className="bg-[#f8f9fa] border-2 border-[#7f265b] rounded-lg p-4">
                      <pre className="whitespace-pre-wrap text-[16px] font-mono">{polishedNote}</pre>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={async () => {
                        const success = await copyToClipboard(polishedNote);
                        if (success) {
                          toast.success('已複製到剪貼簿');
                        } else {
                          toast.error('複製失敗，請手動複製');
                        }
                      }}>
                        <Copy className="mr-2 h-4 w-4" />
                        複製
                      </Button>
                      <Button className="bg-[#7f265b] hover:bg-[#631e4d]">
                        <Download className="mr-2 h-4 w-4" />
                        匯入 HIS
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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
                    onClick={() => {
                      setMessages(messages.map(m => ({ ...m, isRead: true })));
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
                                onClick={() => {
                                  setMessages(messages.map(m => 
                                    m.id === message.id ? { ...m, isRead: true } : m
                                  ));
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
          <MedicalRecords patientId={patient.id} patientName={patient.name} />
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
            />
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="border-[#7f265b] text-[#7f265b] hover:bg-[#7f265b] hover:text-white">
              交互作用查詢
            </Button>
            <Button variant="outline">
              <Copy className="mr-2 h-4 w-4" />
              複製到報告
            </Button>
          </div>
        </TabsContent>

        {/* 病歷摘要 */}
        <TabsContent value="summary" className="space-y-4">
          {/* 基本資訊 */}
          <Card className="border-2 border-[#e5e7eb] bg-[#f8f9fa]">
            <CardHeader>
              <CardTitle>基本資訊 Basic Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Age</p>
                  <p className="text-xl font-medium">{patient.age} years</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Gender</p>
                  <p className="text-xl font-medium">male</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">BMI</p>
                  <p className="text-xl font-medium">16.4 kg/m²</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Height</p>
                  <p className="text-xl font-medium">164 cm</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Weight</p>
                  <p className="text-xl font-medium">44 kg</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 症狀 */}
          <Card>
            <CardHeader>
              <CardTitle>症狀 Symptom</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 list-decimal list-inside">
                <li className="text-base">COVID-19 Complicated with Pulmonary Infection</li>
                <li className="text-base">Septic Shock</li>
                <li className="text-base">Respiratory Acidosis</li>
              </ol>
            </CardContent>
          </Card>

          {/* 診斷 */}
          <Card className="border-l-4 border-l-[#3c7acb]">
            <CardHeader>
              <CardTitle>入院診斷</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base">{patient.diagnosis}</p>
            </CardContent>
          </Card>

          {/* 風險與警示 */}
          <Card className="border-2 border-[#ff3975]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#ff3975]">
                <AlertCircle className="h-5 w-5" />
                風險與警示
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {patient.alerts.map((alert, idx) => (
                <Alert key={idx} className="bg-[#ffe6f0] border-[#ff3975]">
                  <AlertCircle className="h-4 w-4 text-[#ff3975]" />
                  <AlertDescription className="text-[#ff3975]">{alert}</AlertDescription>
                </Alert>
              ))}
              {patient.alerts.length === 0 && (
                <p className="text-muted-foreground text-sm">目前無警示</p>
              )}
            </CardContent>
          </Card>
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
