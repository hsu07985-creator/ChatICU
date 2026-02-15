import { useState, useEffect } from 'react';
import { getPatients, Patient as ApiPatient } from '../../lib/api/patients';
import { useAuth } from '../../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Separator } from '../../components/ui/separator';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import {
  Plus,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Pill,
  Droplets,
  Calculator,
  Lightbulb,
  User,
  Activity,
  Zap,
  FileText,
  ChevronDown,
  ChevronUp,
  Check,
  Edit3,
  BarChart3,
  Send,
  BookOpen
} from 'lucide-react';
import { toast } from 'sonner@2.0.3';

// 藥物交互作用類型
interface DrugInteraction {
  id: string;
  drugA: string;
  drugB: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references?: string;
}

// 靜脈注射相容性類型
interface IVCompatibility {
  id: string;
  drugA: string;
  drugB: string;
  solution: 'NS' | 'D5W' | 'LR' | 'D5NS' | 'multiple';
  compatible: boolean;
  timeStability?: string;
  notes?: string;
  concentration?: string;
  references?: string;
}

// 用藥建議分類介面
interface AdviceCategory {
  label: string;
  codes: { code: string; label: string }[];
}

// 用藥建議分類（靜態配置）
const adviceCategories: Record<string, AdviceCategory> = {
  prescription: {
    label: '1. 建議處方',
    codes: [
      { code: '1-1', label: '建議更適當用藥/配方組成' },
      { code: '1-2', label: '用藥途徑或劑型問題' },
      { code: '1-3', label: '用藥期間/數量問題（包含停藥）' },
      { code: '1-4', label: '用藥劑量/頻次問題' },
      { code: '1-5', label: '不符健保給付規定' },
      { code: '1-6', label: '其他' },
      { code: '1-7', label: '藥品相容性問題' },
      { code: '1-8', label: '疑似藥品不良反應' },
      { code: '1-9', label: '藥品交互作用' },
      { code: '1-10', label: '藥品併用問題' },
      { code: '1-11', label: '用藥替急問題（包括過敏史）' },
      { code: '1-12', label: '適應症問題' },
      { code: '1-13', label: '給藥問題（途徑、輸注方式、濃度或稀釋液）' }
    ]
  },
  proactive: {
    label: '2. 主動建議',
    codes: [
      { code: '2-1', label: '建議靜脈營養配方' },
      { code: '2-2', label: '建議藥物治療療程' },
      { code: '2-3', label: '建議用藥/建議增加用藥' },
      { code: '2-4', label: '藥品不良反應評估' }
    ]
  },
  monitoring: {
    label: '3. 建議監測',
    codes: [
      { code: '3-1', label: '建議藥品濃度監測' },
      { code: '3-2', label: '建議藥品不良反應監測' },
      { code: '3-3', label: '建議藥品療效監測' }
    ]
  },
  appropriateness: {
    label: '4. 用藥適從性',
    codes: [
      { code: '4-1', label: '病人用藥適從性問題' },
      { code: '4-2', label: '藥品辨識/自備藥辨識' },
      { code: '4-3', label: '藥歷查核與整合' }
    ]
  }
};

// 病患擴展資料（需後端整合）
interface ExtendedPatientData {
  weight: number;
  egfr: number;
  hepaticFunction: 'normal' | 'mild' | 'moderate' | 'severe';
}

interface AssessmentResults {
  interactions: DrugInteraction[];
  compatibility: IVCompatibility[];
  dosage: DosageResult[];
  adviceRecommendations: string[];
}

interface DosageResult {
  drugName: string;
  normalDose: string;
  adjustedDose: string;
  renalAdjustment: string;
  hepaticWarning: string;
  warnings: string[];
  references?: string; // 添加參考來源
}

export function PharmacyWorkstationPage() {
  const { user } = useAuth();

  // 病患列表（從 API 載入）
  const [patients, setPatients] = useState<ApiPatient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [patientsError, setPatientsError] = useState<string | null>(null);

  // 載入病患列表
  useEffect(() => {
    const loadPatients = async () => {
      setPatientsLoading(true);
      setPatientsError(null);
      try {
        const res = await getPatients();
        setPatients(res.patients);
      } catch (err) {
        console.error('載入病患列表失敗:', err);
        setPatientsError('無法載入病患列表');
        setPatients([]);
      } finally {
        setPatientsLoading(false);
      }
    };
    loadPatients();
  }, []);

  // 病患選擇
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const selectedPatient = selectedPatientId
    ? patients.find(p => p.id === selectedPatientId)
    : null;
  // TODO: 擴展資料應從後端 API 取得（目前使用預設值）
  const extendedData: ExtendedPatientData | null = selectedPatient ? {
    weight: 70,
    egfr: 60,
    hepaticFunction: 'normal' as const
  } : null;

  // 藥品列表
  const [drugList, setDrugList] = useState<string[]>([]);
  const [currentDrug, setCurrentDrug] = useState('');

  // 評估結果
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);

  // 展開狀態
  const [expandedSections, setExpandedSections] = useState({
    interactions: true,
    compatibility: true,
    dosage: true,
    advice: true
  });

  // 用藥建議表單
  const [adviceContent, setAdviceContent] = useState('');
  
  // 用藥建議送出對話框
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedAdviceCode, setSelectedAdviceCode] = useState<string>('');

  // 當選擇病患時，自動載入病患用藥
  useEffect(() => {
    if (selectedPatient) {
      const sedation = selectedPatient.sanSummary?.sedation || [];
      const analgesia = selectedPatient.sanSummary?.analgesia || [];
      const nmb = selectedPatient.sanSummary?.nmb || [];
      const patientMeds = [...sedation, ...analgesia, ...nmb].filter(Boolean);
      setDrugList(patientMeds);
      setAssessmentResults(null);
    }
  }, [selectedPatient]);

  // 新增藥品
  const handleAddDrug = () => {
    if (currentDrug.trim() && !drugList.includes(currentDrug.trim())) {
      setDrugList([...drugList, currentDrug.trim()]);
      setCurrentDrug('');
      setAssessmentResults(null); // 重置評估結果
    }
  };

  // 移除藥品
  const handleRemoveDrug = (drug: string) => {
    setDrugList(drugList.filter(d => d !== drug));
    setAssessmentResults(null); // 重置評估結果
  };

  // 全面評估（需後端 API 支援藥物交互作用與相容性查詢）
  const handleComprehensiveAssessment = () => {
    if (drugList.length === 0) {
      toast.error('請至少新增一個藥品');
      return;
    }

    if (!selectedPatient) {
      toast.error('請先選擇病患');
      return;
    }

    setIsAssessing(true);

    // TODO: 替換為後端 API 呼叫 (POST /pharmacy/assessment)
    // 目前交互作用與相容性查詢尚未整合後端，僅產生劑量建議框架
    setTimeout(() => {
      // 交互作用 & 相容性：需後端整合
      const interactions: DrugInteraction[] = [];
      const compatibility: IVCompatibility[] = [];

      // 劑量建議框架
      const dosage: DosageResult[] = drugList.map(drug => ({
        drugName: drug,
        normalDose: '待後端查詢',
        adjustedDose: extendedData!.egfr < 60 ? '需依腎功能調整' : '待後端查詢',
        renalAdjustment: extendedData!.egfr < 60
          ? `腎功能 eGFR ${extendedData!.egfr} ml/min: 建議劑量減半，延長給藥間隔`
          : `腎功能正常 (eGFR ${extendedData!.egfr} ml/min)，無需調整`,
        hepaticWarning: extendedData!.hepaticFunction !== 'normal'
          ? '肝功能異常，建議謹慎使用並監測肝功能指標'
          : '肝功能正常，無需特殊調整',
        warnings: extendedData!.egfr < 60
          ? ['注意監測腎功能變化', '避免與其他腎毒性藥物併用', '定期監測血中濃度']
          : [],
        references: '待後端整合參考文獻'
      }));

      // 用藥建議
      const adviceRecommendations: string[] = [];
      adviceRecommendations.push('藥物交互作用與相容性查詢功能待後端整合');
      if (extendedData!.egfr < 60) {
        adviceRecommendations.push('病患腎功能異常，建議調整經腎臟代謝藥物劑量');
      }
      if (extendedData!.hepaticFunction !== 'normal') {
        adviceRecommendations.push('病患肝功能異常，建議調整經肝臟代謝藥物劑量');
      }

      setAssessmentResults({
        interactions,
        compatibility,
        dosage,
        adviceRecommendations
      });

      setIsAssessing(false);
      toast.success('評估完成（部分功能待後端整合）');
    }, 1000);
  };

  // 切換展開狀態
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // 產生用藥建議報告
  const handleGenerateAdvice = () => {
    if (!assessmentResults) {
      toast.error('請先執行全面評估');
      return;
    }

    let report = `【用藥建議報告】\n\n`;
    report += `病患：${selectedPatient?.name} (${selectedPatient?.bedNumber})\n`;
    report += `日期：${new Date().toLocaleString('zh-TW')}\n`;
    report += `藥師：${user?.name}\n\n`;
    
    report += `【評估藥品】\n${drugList.join('、')}\n\n`;
    
    if (assessmentResults.interactions.length > 0) {
      report += `【藥物交互作用】\n`;
      assessmentResults.interactions.forEach((int, idx) => {
        report += `${idx + 1}. ${int.drugA} + ${int.drugB} (嚴重度: ${int.severity})\n`;
        report += `   ${int.description}\n`;
        report += `   處理: ${int.management}\n\n`;
      });
    }

    if (assessmentResults.compatibility.some(c => !c.compatible)) {
      report += `【相容性警示】\n`;
      assessmentResults.compatibility.filter(c => !c.compatible).forEach((comp, idx) => {
        report += `${idx + 1}. ${comp.drugA} + ${comp.drugB}: 不相容\n`;
        report += `   注意: ${comp.notes}\n\n`;
      });
    }

    if (extendedData!.egfr < 60) {
      report += `【劑量調整建議】\n`;
      report += `腎功能 eGFR ${extendedData!.egfr} ml/min，建議調整劑量\n\n`;
    }

    report += `【綜合建議】\n`;
    assessmentResults.adviceRecommendations.forEach((rec, idx) => {
      report += `${idx + 1}. ${rec}\n`;
    });

    setAdviceContent(report);
    toast.success('用藥建議報告已產生');
  };

  // 儲存用藥建議
  const handleSaveAdvice = () => {
    if (!adviceContent.trim()) {
      toast.error('請先產生或輸入用藥建議內容');
      return;
    }

    // 開啟選擇分類對話框
    setShowSubmitDialog(true);
  };

  // 確認送出用藥建議
  const handleConfirmSubmit = () => {
    if (!selectedAdviceCode || !selectedCategory) {
      toast.error('請選擇用藥建議分類');
      return;
    }

    // 取得分類資訊
    const categoryInfo = adviceCategories[selectedCategory as keyof typeof adviceCategories];
    const codeInfo = categoryInfo.codes.find(c => c.code === selectedAdviceCode);

    // TODO: 呼叫後端 API 儲存用藥建議 (POST /pharmacy/advice)
    // 目前僅顯示成功訊息，實際儲存待後端整合
    toast.success(`用藥建議已送出（分類：${codeInfo!.label}）`);
    setAdviceContent('');
    setShowSubmitDialog(false);
    setSelectedCategory('');
    setSelectedAdviceCode('');
  };

  // 跳轉到用藥建議與統計頁面
  const handleGoToStatistics = () => {
    window.location.href = '/pharmacy/advice-statistics';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'low': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return <AlertTriangle className="h-4 w-4" />;
      case 'medium': return <AlertCircle className="h-4 w-4" />;
      case 'low': return <Info className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* 標題 */}
      <div>
        <h1>藥事支援工作台</h1>
        <p className="text-muted-foreground mt-1">
          選擇病患、管理用藥、執行全面評估並產生用藥建議
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 左側：病患與用藥管理 (40%) */}
        <div className="lg:col-span-2 space-y-4">
          {/* 病患選擇 */}
          <Card className="border-2 border-[#7f265b]">
            <CardHeader className="bg-[#f8f9fa] pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5 text-[#7f265b]" />
                選擇病患
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId} disabled={patientsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={patientsLoading ? '載入病患列表中...' : patientsError ? '載入失敗' : '請選擇病患...'} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.bedNumber} - {patient.name} ({patient.age}歲)
                    </SelectItem>
                  ))}
                  {!patientsLoading && patients.length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      {patientsError || '尚無病患資料'}
                    </div>
                  )}
                </SelectContent>
              </Select>

              {selectedPatient && extendedData && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">床號</p>
                      <p className="font-semibold">{selectedPatient.bedNumber}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">姓名</p>
                      <p className="font-semibold">{selectedPatient.name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">年齡/體重</p>
                      <p className="font-semibold">{selectedPatient.age}歲 / {extendedData.weight}kg</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">腎功能</p>
                      <p className={`font-semibold ${extendedData.egfr < 60 ? 'text-[#f59e0b]' : ''}`}>
                        eGFR {extendedData.egfr}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">診斷</p>
                      <p className="font-semibold text-sm">{selectedPatient.diagnosis}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 用藥列表管理 */}
          {selectedPatient && (
            <Card className="border-2 border-[#7f265b]">
              <CardHeader className="bg-[#f8f9fa] pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Pill className="h-5 w-5 text-[#7f265b]" />
                    用藥列表
                  </CardTitle>
                  <Badge className="bg-[#7f265b]">
                    {drugList.length} 項
                  </Badge>
                </div>
                <CardDescription className="text-xs">已自動載入病患目前用藥</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {/* 新增藥品 */}
                <div className="flex gap-2">
                  <Input
                    placeholder="輸入藥品名稱..."
                    value={currentDrug}
                    onChange={(e) => setCurrentDrug(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddDrug();
                      }
                    }}
                  />
                  <Button 
                    onClick={handleAddDrug}
                    disabled={!currentDrug.trim()}
                    className="bg-[#7f265b] hover:bg-[#631e4d]"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* 藥品列表 */}
                {drugList.length > 0 ? (
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-2 pr-3">
                      {drugList.map((drug, index) => (
                        <div 
                          key={index}
                          className="flex items-center justify-between p-2.5 bg-[#f8f9fa] rounded-lg border"
                        >
                          <div className="flex items-center gap-2">
                            <Pill className="h-4 w-4 text-[#7f265b]" />
                            <span className="font-medium text-sm">{drug}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveDrug(drug)}
                            className="h-7 w-7"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <Alert className="py-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      尚未新增任何藥品
                    </AlertDescription>
                  </Alert>
                )}

                <Separator />

                {/* 全面評估按鈕 */}
                <Button 
                  onClick={handleComprehensiveAssessment}
                  disabled={drugList.length === 0 || isAssessing}
                  className="w-full h-12 bg-[#7f265b] hover:bg-[#631e4d]"
                  size="lg"
                >
                  <Zap className="mr-2 h-5 w-5" />
                  {isAssessing ? '評估中...' : '執行全面評估'}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  一鍵檢查交互作用、相容性、劑量建議與用藥建議
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右側：評估結果 (60%) */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedPatient && (
            <Card>
              <CardContent className="py-16">
                <div className="text-center space-y-3">
                  <User className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold text-lg">請先選擇病患</h3>
                    <p className="text-muted-foreground text-sm">選擇病患後即可管理用藥並執行評估</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {selectedPatient && !assessmentResults && (
            <Card>
              <CardContent className="py-16">
                <div className="text-center space-y-3">
                  <Activity className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold text-lg">準備執行評估</h3>
                    <p className="text-muted-foreground text-sm">
                      目前已載入 {drugList.length} 項藥品，點擊「執行全面評估」開始分析
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {selectedPatient && assessmentResults && (
            <>
              {/* 1. 藥物交互作用 */}
              <Card className={assessmentResults.interactions.length > 0 ? 'border-l-4 border-l-[#f59e0b]' : 'border-l-4 border-l-[#7f265b]'}>
                <CardHeader 
                  className="cursor-pointer bg-[#f8f9fa] py-3"
                  onClick={() => toggleSection('interactions')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-5 w-5 ${assessmentResults.interactions.length > 0 ? 'text-[#f59e0b]' : 'text-[#7f265b]'}`} />
                      <CardTitle className="text-base">藥物交互作用</CardTitle>
                      {assessmentResults.interactions.length > 0 ? (
                        <Badge variant="secondary" className="bg-[#f59e0b] text-white">
                          {assessmentResults.interactions.length} 項
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          無異常
                        </Badge>
                      )}
                    </div>
                    {expandedSections.interactions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </CardHeader>
                {expandedSections.interactions && (
                  <CardContent className="space-y-2.5 pt-3">
                    {assessmentResults.interactions.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>未發現藥物交互作用</span>
                      </div>
                    ) : (
                      assessmentResults.interactions.map((interaction, idx) => (
                        <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              {getSeverityIcon(interaction.severity)}
                              <p className="font-semibold text-sm">
                                {interaction.drugA} + {interaction.drugB}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {interaction.severity === 'high' ? '高風險' : interaction.severity === 'medium' ? '中風險' : '低風險'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{interaction.description}</p>
                          <Separator />
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">機轉說明</p>
                            <p className="text-sm">{interaction.mechanism}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">臨床影響</p>
                            <p className="text-sm">{interaction.clinicalEffect}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">處理建議</p>
                            <p className="text-sm">{interaction.management}</p>
                          </div>
                          {interaction.references && (
                            <>
                              <Separator />
                              <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                                <div className="flex items-center gap-1 mb-1">
                                  <BookOpen className="h-3 w-3 text-[#7f265b]" />
                                  <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                                </div>
                                <p className="text-xs text-muted-foreground">{interaction.references}</p>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                )}
              </Card>

              {/* 2. 相容性檢核 */}
              <Card className={assessmentResults.compatibility.some(c => !c.compatible) ? 'border-l-4 border-l-[#f59e0b]' : 'border-l-4 border-l-[#7f265b]'}>
                <CardHeader 
                  className="cursor-pointer bg-[#f8f9fa] py-3"
                  onClick={() => toggleSection('compatibility')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Droplets className={`h-5 w-5 ${assessmentResults.compatibility.some(c => !c.compatible) ? 'text-[#f59e0b]' : 'text-[#7f265b]'}`} />
                      <CardTitle className="text-base">靜脈注射相容性</CardTitle>
                      {assessmentResults.compatibility.length > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          {assessmentResults.compatibility.length} 組
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          無資料
                        </Badge>
                      )}
                    </div>
                    {expandedSections.compatibility ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </CardHeader>
                {expandedSections.compatibility && (
                  <CardContent className="space-y-2.5 pt-3">
                    {assessmentResults.compatibility.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>無相容性資料或所有組合皆相容</span>
                      </div>
                    ) : (
                      assessmentResults.compatibility.map((comp, idx) => (
                        <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {comp.compatible ? (
                                <CheckCircle2 className="h-4 w-4 text-[#7f265b]" />
                              ) : (
                                <XCircle className="h-4 w-4 text-[#f59e0b]" />
                              )}
                              <p className="font-semibold text-sm">
                                {comp.drugA} + {comp.drugB}
                              </p>
                            </div>
                            <Badge className={comp.compatible ? 'bg-[#7f265b]' : 'bg-[#f59e0b]'}>
                              {comp.compatible ? '相容' : '不相容'}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">溶劑：</span>
                              <span className="font-medium">{comp.solution}</span>
                            </div>
                            {comp.timeStability && (
                              <div>
                                <span className="text-muted-foreground">穩定時間：</span>
                                <span className="font-medium">{comp.timeStability}</span>
                              </div>
                            )}
                          </div>
                          {comp.concentration && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">濃度：</span>
                              <span>{comp.concentration}</span>
                            </div>
                          )}
                          {comp.notes && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">注意事項</p>
                              <p className="text-sm">{comp.notes}</p>
                            </div>
                          )}
                          {comp.references && (
                            <>
                              <Separator />
                              <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                                <div className="flex items-center gap-1 mb-1">
                                  <BookOpen className="h-3 w-3 text-[#7f265b]" />
                                  <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                                </div>
                                <p className="text-xs text-muted-foreground">{comp.references}</p>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                )}
              </Card>

              {/* 3. 劑量建議 */}
              <Card className="border-l-4 border-l-[#7f265b]">
                <CardHeader 
                  className="cursor-pointer bg-[#f8f9fa] py-3"
                  onClick={() => toggleSection('dosage')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calculator className="h-5 w-5 text-[#7f265b]" />
                      <CardTitle className="text-base">劑量調整建議</CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {assessmentResults.dosage.length} 項
                      </Badge>
                    </div>
                    {expandedSections.dosage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </CardHeader>
                {expandedSections.dosage && (
                  <CardContent className="space-y-2.5 pt-3">
                    {assessmentResults.dosage.map((dose, idx) => (
                      <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm">{dose.drugName}</p>
                          {extendedData!.egfr < 60 && (
                            <Badge variant="outline" className="text-xs border-[#f59e0b] text-[#f59e0b]">
                              需調整
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-muted-foreground">標準劑量</p>
                            <p className="font-medium">{dose.normalDose}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">建議劑量</p>
                            <p className="font-medium text-[#7f265b]">{dose.adjustedDose}</p>
                          </div>
                        </div>
                        <Separator />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">腎功能調整</p>
                          <p className="text-sm">{dose.renalAdjustment}</p>
                        </div>
                        {dose.hepaticWarning && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">肝功能評估</p>
                            <p className="text-sm">{dose.hepaticWarning}</p>
                          </div>
                        )}
                        {dose.warnings && dose.warnings.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">注意事項</p>
                            <ul className="list-disc list-inside space-y-0.5 text-xs">
                              {dose.warnings.map((warning, wIdx) => (
                                <li key={wIdx}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {dose.references && (
                          <>
                            <Separator />
                            <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                              <div className="flex items-center gap-1 mb-1">
                                <BookOpen className="h-3 w-3 text-[#7f265b]" />
                                <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                              </div>
                              <p className="text-xs text-muted-foreground">{dose.references}</p>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>

              {/* 4. 用藥建議產生 */}
              <Card className="border-l-4 border-l-[#7f265b]">
                <CardHeader className="bg-[#f8f9fa] py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-[#7f265b]" />
                      <CardTitle className="text-base">用藥建議</CardTitle>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleGoToStatistics}
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                      >
                        <BarChart3 className="mr-1 h-3 w-3" />
                        統計
                      </Button>
                      <Button 
                        onClick={handleGenerateAdvice}
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                      >
                        <FileText className="mr-1 h-3 w-3" />
                        產生報告
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  {assessmentResults.adviceRecommendations.length > 0 && (
                    <div className="border rounded-lg p-3 bg-[#f8f9fa]">
                      <p className="font-semibold text-sm mb-2 flex items-center gap-1">
                        <Lightbulb className="h-4 w-4 text-[#7f265b]" />
                        重點提示
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                        {assessmentResults.adviceRecommendations.map((rec, idx) => (
                          <li key={idx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Textarea
                      value={adviceContent}
                      onChange={(e) => setAdviceContent(e.target.value)}
                      placeholder="點擊「產生報告」自動產生完整建議，或手動輸入..."
                      className="min-h-[180px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                      onClick={handleSaveAdvice}
                      disabled={!adviceContent.trim()}
                      className="bg-[#7f265b] hover:bg-[#631e4d]"
                    >
                      <Check className="mr-1 h-4 w-4" />
                      接受並送出
                    </Button>
                    <Button 
                      onClick={() => {
                        // 允許修正
                        toast.info('您可以直接在上方編輯建議內容');
                      }}
                      disabled={!adviceContent.trim()}
                      variant="outline"
                    >
                      <Edit3 className="mr-1 h-4 w-4" />
                      修正內容
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* 用藥建議送出對話框 */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>選擇用藥建議分類</DialogTitle>
            <DialogDescription>
              先選擇大類別，再選擇具體項目
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* 第一層：選擇大類別 */}
            <div className="space-y-2">
              <Label>步驟 1：選擇大類別</Label>
              <Select value={selectedCategory} onValueChange={(value) => {
                setSelectedCategory(value);
                setSelectedAdviceCode(''); // 清空細項選擇
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇大類別..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(adviceCategories).map(([key, category]) => (
                    <SelectItem key={key} value={key}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 第二層：選擇細項 */}
            {selectedCategory && (
              <div className="space-y-2">
                <Label>步驟 2：選擇具體分類</Label>
                <Select value={selectedAdviceCode} onValueChange={setSelectedAdviceCode}>
                  <SelectTrigger>
                    <SelectValue placeholder="請選擇具體分類..." />
                  </SelectTrigger>
                  <SelectContent>
                    {adviceCategories[selectedCategory as keyof typeof adviceCategories].codes.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              onClick={handleConfirmSubmit}
              disabled={!selectedAdviceCode}
              className="bg-[#7f265b] hover:bg-[#631e4d]"
            >
              確認送出
            </Button>
            <Button 
              onClick={() => {
                setShowSubmitDialog(false);
                setSelectedCategory('');
                setSelectedAdviceCode('');
              }}
              variant="outline"
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}