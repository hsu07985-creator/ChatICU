import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPatients, Patient as ApiPatient } from '../../lib/api/patients';
import { useAuth } from '../../lib/auth-context';
import { getLatestLabData, type LabData as ApiLabData } from '../../lib/api/lab-data';
import { getLatestVitalSigns, type VitalSigns as ApiVitalSigns } from '../../lib/api/vital-signs';
import { calculateDose, checkInteractions, type PatientContext } from '../../lib/api/ai';
import { createAdviceRecord, getDrugInteractions, getIVCompatibility } from '../../lib/api/pharmacy';
import { getMedications } from '../../lib/api/medications';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ScrollArea } from '../../components/ui/scroll-area';
import { AssessmentResultsPanel } from './workstation/assessment-results-panel';
import { AdviceSubmitDialog } from './workstation/advice-submit-dialog';
import {
  adviceCategories,
  type AssessmentResults,
  type DosageResult,
  type DrugInteraction,
  type ExpandedSections,
  type ExtendedPatientData,
  type IVCompatibility,
} from './workstation/types';
import {
  Plus,
  X,
  Info,
  Pill,
  User,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

export function PharmacyWorkstationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

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
    ? (patients.find(p => p.id === selectedPatientId) ?? null)
    : null;
  const [hepaticFunction, setHepaticFunction] = useState<ExtendedPatientData['hepaticFunction']>('normal');
  const [latestLab, setLatestLab] = useState<ApiLabData | null>(null);
  const [latestVital, setLatestVital] = useState<ApiVitalSigns | null>(null);

  // 當選擇病患時載入最新檢驗/生命徵象，提供 eGFR/血壓等臨床參數
  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      if (!selectedPatientId) {
        setLatestLab(null);
        setLatestVital(null);
        return;
      }
      try {
        const lab = await getLatestLabData(selectedPatientId);
        if (!cancelled) setLatestLab((lab as ApiLabData) || null);
      } catch {
        if (!cancelled) setLatestLab(null);
      }
      try {
        const vital = await getLatestVitalSigns(selectedPatientId);
        if (!cancelled) setLatestVital((vital as ApiVitalSigns) || null);
      } catch {
        if (!cancelled) setLatestVital(null);
      }
    };
    loadContext();
    return () => { cancelled = true; };
  }, [selectedPatientId]);

  const extendedData: ExtendedPatientData | null = selectedPatient ? {
    weight: selectedPatient.weight ?? null,
    egfr: latestLab?.biochemistry?.eGFR?.value ?? null,
    hepaticFunction,
    sbp: latestVital?.bloodPressure?.systolic ?? null,
    hr: latestVital?.heartRate ?? null,
    rr: latestVital?.respiratoryRate ?? null,
    k: latestLab?.biochemistry?.K?.value ?? null,
  } : null;

  // 藥品列表
  const [drugList, setDrugList] = useState<string[]>([]);
  const [currentDrug, setCurrentDrug] = useState('');

  // 評估結果
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);

  // 展開狀態
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
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
    let cancelled = false;
    const loadActiveMeds = async () => {
      if (!selectedPatient) return;
      try {
        const resp = await getMedications(selectedPatient.id, { status: 'active', limit: 200 });
        const names = (resp.medications || []).map(m => m.name).filter(Boolean);
        const unique = Array.from(new Set(names));
        if (!cancelled) setDrugList(unique);
      } catch (err) {
        console.error('載入病患用藥醫囑失敗，改用摘要 SAN 清單:', err);
        const sedation = selectedPatient.sedation || selectedPatient.sanSummary?.sedation || [];
        const analgesia = selectedPatient.analgesia || selectedPatient.sanSummary?.analgesia || [];
        const nmb = selectedPatient.nmb || selectedPatient.sanSummary?.nmb || [];
        const patientMeds = [...sedation, ...analgesia, ...nmb].filter(Boolean);
        if (!cancelled) setDrugList(patientMeds);
        toast.message('無法載入用藥醫囑，已改用病患摘要用藥清單');
      } finally {
        if (!cancelled) {
          setAssessmentResults(null);
          setHepaticFunction('normal');
        }
      }
    };
    loadActiveMeds();
    return () => { cancelled = true; };
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

  const handleComprehensiveAssessment = async () => {
    if (drugList.length === 0) {
      toast.error('請至少新增一個藥品');
      return;
    }

    if (!selectedPatient) {
      toast.error('請先選擇病患');
      return;
    }

    setIsAssessing(true);
    try {
      const uniqueDrugs = Array.from(new Set(drugList.map(d => d.trim()).filter(Boolean)));
      const mapSeverity = (s?: string): 'high' | 'medium' | 'low' => {
        if (!s) return 'low';
        const v = s.toLowerCase();
        if (v === 'contraindicated' || v === 'major' || v === 'high') return 'high';
        if (v === 'moderate' || v === 'medium') return 'medium';
        return 'low';
      };

      const hepaticMap: Record<ExtendedPatientData['hepaticFunction'], string | undefined> = {
        normal: undefined,
        mild: 'child_pugh_a',
        moderate: 'child_pugh_b',
        severe: 'child_pugh_c',
      };

      const patientContext: PatientContext = {
        age_years: selectedPatient.age,
        weight_kg: extendedData?.weight ?? undefined,
        sex: selectedPatient.gender === '男' ? 'male' : 'female',
        crcl_ml_min: extendedData?.egfr ?? undefined,
        hepatic_class: hepaticMap[extendedData?.hepaticFunction || 'normal'],
        sbp_mmHg: extendedData?.sbp ?? undefined,
        hr_bpm: extendedData?.hr ?? undefined,
        rr_bpm: extendedData?.rr ?? undefined,
        k_mmol_l: extendedData?.k ?? undefined,
      };

      // 1) Interactions (func deterministic engine first; fallback to DB index)
      let interactions: DrugInteraction[] = [];
      try {
        const res = await checkInteractions(
          { drugList: uniqueDrugs, patientContext },
          { suppressErrorToast: true },
        );
        interactions = (res.findings || [])
          .map((f, idx) => ({
            id: `int_${idx}`,
            drugA: f.drugA || f.drug_a || '',
            drugB: f.drugB || f.drug_b || '',
            severity: mapSeverity(f.severity),
            description: f.clinical_effect || f.mechanism || '',
            mechanism: f.mechanism || '',
            clinicalEffect: f.clinical_effect || '',
            management: f.recommended_action || '',
            references: f.dose_adjustment_hint || (Array.isArray(f.monitoring) ? f.monitoring.join('、') : ''),
          }))
          .filter(x => x.drugA && x.drugB);
      } catch (err) {
        console.warn('Evidence 交互作用引擎不可用，改用本地資料庫查詢', err);
        try {
          const drugSet = new Set(uniqueDrugs.map(d => d.toLowerCase()));
          const respList = await Promise.all(
            uniqueDrugs.map((d) => getDrugInteractions({ drugA: d }))
          );
          const all = respList.flatMap((resp) => resp.interactions || []);
          const byId = new Map<string, typeof all[number]>();
          for (const it of all) {
            const id = String(it.id || '');
            if (!id) continue;
            if (!byId.has(id)) byId.set(id, it);
          }
          interactions = Array.from(byId.values())
            .filter((it) => {
              const a = String(it.drug1).toLowerCase();
              const b = String(it.drug2).toLowerCase();
              return drugSet.has(a) && drugSet.has(b);
            })
            .map((it) => ({
              id: it.id,
              drugA: it.drug1,
              drugB: it.drug2,
              severity: mapSeverity(it.severity),
              description: it.clinicalEffect || '',
              mechanism: it.mechanism || '',
              clinicalEffect: it.clinicalEffect || '',
              management: it.management || '',
              references: it.references || '',
            }));
        } catch (fallbackErr) {
          console.error('本地交互作用資料庫查詢失敗:', fallbackErr);
        }
      }

      // 2) IV Compatibility (DB)
      const compatibility: IVCompatibility[] = [];
      const pairs: Array<[string, string]> = [];
      for (let i = 0; i < uniqueDrugs.length; i++) {
        for (let j = i + 1; j < uniqueDrugs.length; j++) {
          pairs.push([uniqueDrugs[i], uniqueDrugs[j]]);
        }
      }
      // Avoid excessive requests for very long lists.
      const limitedPairs = pairs.slice(0, 20);
      for (const [a, b] of limitedPairs) {
        try {
          const resp = await getIVCompatibility({ drugA: a, drugB: b });
          const rows = resp.compatibilities || [];
          for (const row of rows) {
            compatibility.push({
              id: row.id || '',
              drugA: row.drug1 || a,
              drugB: row.drug2 || b,
              solution: (row.solution as IVCompatibility['solution']) || 'multiple',
              compatible: Boolean(row.compatible),
              timeStability: row.timeStability || undefined,
              notes: row.notes || undefined,
              references: row.references || undefined,
            });
          }
        } catch (err) {
          console.warn('相容性查詢失敗:', err);
        }
      }

      // 3) Dose suggestions (func deterministic engine via backend proxy)
      const dosage: DosageResult[] = await Promise.all(
        uniqueDrugs.map(async (drug) => {
          try {
            const res = await calculateDose({ drug, patientContext }, { suppressErrorToast: true });
            const cv = res.computed_values as Record<string, unknown>;
            const inputDose = cv?.input_dose;
            const finalRate = cv?.final_rate;
            const fmt = (v: unknown) => v && typeof v === 'object' && v !== null && 'value' in v && 'unit' in v
              ? `${(v as Record<string, unknown>).value} ${(v as Record<string, unknown>).unit}`
              : '';
            const normalDose = fmt(inputDose) || (res.status === 'ok' ? '—' : '無法計算');
            const adjustedDose = fmt(finalRate) || (res.status === 'ok' ? '—' : '無法計算');
            return {
              drugName: drug,
              normalDose,
              adjustedDose,
              renalAdjustment: (res.calculation_steps || []).slice(0, 4).join('；') || (res.message || ''),
              hepaticWarning: extendedData?.hepaticFunction && extendedData.hepaticFunction !== 'normal'
                ? '已套用肝功能調整（如適用）'
                : '',
              warnings: res.safety_warnings || [],
              references: (res.citations || []).length ? '包含規則引用（詳見劑量頁）' : undefined,
            };
          } catch (err) {
            const msg = '劑量引擎不可用（請啟動 func/ 服務）';
            return {
              drugName: drug,
              normalDose: '—',
              adjustedDose: msg,
              renalAdjustment: msg,
              hepaticWarning: '',
              warnings: [],
            };
          }
        })
      );

      // 4) Recommendations (rule-based hints; not LLM-generated)
      const adviceRecommendations: string[] = [];
      if (interactions.length > 0) {
        const high = interactions.filter(i => i.severity === 'high').length;
        adviceRecommendations.push(
          high > 0
            ? `發現 ${high} 項高風險交互作用，建議優先處理並加強監測。`
            : `發現 ${interactions.length} 項交互作用，建議依嚴重度調整處置與監測。`
        );
      }
      const incompatible = compatibility.filter(c => !c.compatible).length;
      if (incompatible > 0) {
        adviceRecommendations.push(`發現 ${incompatible} 組不相容組合，建議分管路或避免同路輸注。`);
      }
      if (typeof extendedData?.egfr === 'number' && extendedData.egfr < 60) {
        adviceRecommendations.push(`腎功能 eGFR ${extendedData.egfr}，建議檢視需腎調整藥物與監測。`);
      }
      if (extendedData?.hepaticFunction && extendedData.hepaticFunction !== 'normal') {
        adviceRecommendations.push('肝功能異常，建議檢視需肝代謝調整藥物並監測肝功能。');
      }
      if (dosage.some(d => d.renalAdjustment.includes('func/'))) {
        adviceRecommendations.push('劑量計算需啟動 func/ Evidence 引擎服務（仍可先完成交互作用/相容性檢核）。');
      }

      setAssessmentResults({
        interactions,
        compatibility,
        dosage,
        adviceRecommendations,
      });

      toast.success('評估完成');
    } finally {
      setIsAssessing(false);
    }
  };

  // 切換展開狀態
  const toggleSection = (section: keyof ExpandedSections) => {
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

    if (typeof extendedData?.egfr === 'number' && extendedData.egfr < 60) {
      report += `【劑量調整建議】\n`;
      report += `腎功能 eGFR ${extendedData.egfr} ml/min，建議調整劑量\n\n`;
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
  const handleConfirmSubmit = async () => {
    if (!selectedPatient) {
      toast.error('請先選擇病患');
      return;
    }
    if (!adviceContent.trim()) {
      toast.error('請先產生或輸入用藥建議內容');
      return;
    }
    if (!selectedAdviceCode || !selectedCategory) {
      toast.error('請選擇用藥建議分類');
      return;
    }

    // 取得分類資訊
    const categoryInfo = adviceCategories[selectedCategory as keyof typeof adviceCategories];
    const codeInfo = categoryInfo.codes.find(c => c.code === selectedAdviceCode);
    if (!codeInfo) {
      toast.error('建議代碼無效，請重新選擇');
      return;
    }

    try {
      await createAdviceRecord({
        patientId: selectedPatient.id,
        adviceCode: selectedAdviceCode,
        adviceLabel: codeInfo.label,
        category: categoryInfo.label,
        content: adviceContent.trim(),
        linkedMedications: drugList,
      });
      toast.success(`用藥建議已送出並同步至留言板（分類：${codeInfo.label}）`);
      setAdviceContent('');
      setShowSubmitDialog(false);
      setSelectedCategory('');
      setSelectedAdviceCode('');
    } catch (err) {
      console.error('送出用藥建議失敗:', err);
      toast.error('送出失敗，請稍後再試');
    }
  };

  // 跳轉到用藥建議與統計頁面
  const handleGoToStatistics = () => {
    navigate('/pharmacy/advice-statistics');
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
                      <p className="font-semibold">
                        {selectedPatient.age}歲 / {typeof extendedData.weight === 'number' ? `${extendedData.weight}kg` : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">腎功能</p>
                      <p className={`font-semibold ${typeof extendedData.egfr === 'number' && extendedData.egfr < 60 ? 'text-[#f59e0b]' : ''}`}>
                        eGFR {typeof extendedData.egfr === 'number' ? extendedData.egfr : 'N/A'}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs mb-1">肝功能（Child-Pugh）</p>
                      <Select value={hepaticFunction} onValueChange={(v) => setHepaticFunction(v as ExtendedPatientData['hepaticFunction'])}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="選擇肝功能..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">正常</SelectItem>
                          <SelectItem value="mild">A（輕度）</SelectItem>
                          <SelectItem value="moderate">B（中度）</SelectItem>
                          <SelectItem value="severe">C（重度）</SelectItem>
                        </SelectContent>
                      </Select>
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

        <AssessmentResultsPanel
          selectedPatient={selectedPatient}
          assessmentResults={assessmentResults}
          drugList={drugList}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          extendedData={extendedData}
          adviceContent={adviceContent}
          onAdviceContentChange={setAdviceContent}
          onGoToStatistics={handleGoToStatistics}
          onGenerateAdvice={handleGenerateAdvice}
          onSaveAdvice={handleSaveAdvice}
        />
      </div>

      <AdviceSubmitDialog
        open={showSubmitDialog}
        onOpenChange={setShowSubmitDialog}
        selectedCategory={selectedCategory}
        selectedAdviceCode={selectedAdviceCode}
        onCategoryChange={(value) => {
          setSelectedCategory(value);
          setSelectedAdviceCode('');
        }}
        onAdviceCodeChange={setSelectedAdviceCode}
        onConfirm={handleConfirmSubmit}
        onCancel={() => {
          setShowSubmitDialog(false);
          setSelectedCategory('');
          setSelectedAdviceCode('');
        }}
      />
    </div>
  );
}
