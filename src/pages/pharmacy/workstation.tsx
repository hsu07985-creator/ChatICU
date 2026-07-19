import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { maskPatientName } from '../../lib/utils/patient-name';
import { useAuth } from '../../lib/auth-context';
import { getLatestLabData, type LabData as ApiLabData } from '../../lib/api/lab-data';
import { getLatestVitalSigns, type VitalSigns as ApiVitalSigns } from '../../lib/api/vital-signs';
import { polishClinicalText } from '../../lib/api/ai';
import { createAdviceRecord } from '../../lib/api/pharmacy';
import {
  getMedications,
  fetchPharmacyDuplicateSummary,
  getMedicationDuplicates,
  type DuplicateAlert,
  type DuplicateSeverityCounts,
} from '../../lib/api/medications';
import { useApiQuery } from '../../hooks/use-api-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ScrollArea } from '../../components/ui/scroll-area';
import { AssessmentResultsPanel } from './workstation/assessment-results-panel';
import { PharmacyReportView } from './workstation/pharmacy-report-view';
import { AdviceSubmitDialog } from './workstation/advice-submit-dialog';
import { runComprehensiveAssessment } from './workstation/run-assessment';
import {
  adviceCategories,
  type AssessmentResults,
  type CompatibilitySummary,
  type DosageResult,
  type DrugInteraction,
  type DuplicateSummary,
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
} from 'lucide-react';
import { toast } from 'sonner';
import { usePatientList } from '../../hooks/use-patient-list';

// Wave 5b: inline per-patient duplicate-medication severity badge. Only
// renders non-zero buckets so the Select row stays compact. Intentionally
// small (text-[10px]) so it fits inside <SelectItem> without pushing the
// main label.
function DuplicateCountsBadge({
  counts,
  computing = false,
}: {
  counts?: DuplicateSeverityCounts;
  computing?: boolean;
}) {
  const { t } = useTranslation('pharmacy');
  // P1-D5 follow-up: when backend is still warming the cache (computing=true),
  // show a neutral "計算中" placeholder so the UI doesn't render "0 critical"
  // (a misleading clean bill of health) on a fresh patient that may actually
  // have RAAS-blockade or other critical duplicates.
  if (computing) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] leading-none rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5 font-medium"
        aria-label={t('workstation.duplicateBadge.computing')}
      >
        ⏳ {t('workstation.assess.computing')}
      </span>
    );
  }
  if (!counts) return null;
  const { critical, high, moderate, low } = counts;
  if (!critical && !high && !moderate && !low) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] leading-none" aria-label={t('workstation.duplicateBadge.warning')}>
      {critical > 0 && (
        <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 font-medium">
          🔴 {critical}
        </span>
      )}
      {high > 0 && (
        <span className="rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 font-medium">
          🟠 {high}
        </span>
      )}
      {moderate > 0 && (
        <span className="rounded-full bg-yellow-100 text-yellow-700 px-1.5 py-0.5 font-medium">
          🟡 {moderate}
        </span>
      )}
      {low > 0 && (
        <span className="rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 font-medium">
          🔵 {low}
        </span>
      )}
    </span>
  );
}

export function PharmacyWorkstationPage() {
  const { t } = useTranslation('pharmacy');
  const { user } = useAuth();
  const navigate = useNavigate();

  // 病患列表（共用 TanStack Query）
  const { patients, patientsLoading, patientsLoadFailed } = usePatientList();
  const patientsError = patientsLoadFailed ? t('workstation.patientSelect.loadError') : null;

  // Wave 5b: batched duplicate-medication severity counts for the patient
  // dropdown. Key is derived from the sorted patient id list so adding or
  // removing a patient refetches; staleTime keeps the first-click snappy.
  const patientIdsKey = patients.map(p => p.id).sort().join(',');
  const { data: duplicateSummary } = useApiQuery<
    Awaited<ReturnType<typeof fetchPharmacyDuplicateSummary>>
  >({
    queryKey: ['pharmacy-duplicate-summary', patientIdsKey],
    queryFn: () => fetchPharmacyDuplicateSummary(patients.map(p => p.id)),
    enabled: patients.length > 0,
    staleTime: 60_000,
  });

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
    height: selectedPatient.height ?? null,
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
  // name → atcCode for PAD/class matching. Populated from loadActiveMeds().
  // Lookup happens by case-insensitive trim match against this map.
  const [drugAtcByName, setDrugAtcByName] = useState<Record<string, string>>({});
  const [currentDrug, setCurrentDrug] = useState('');

  // 評估結果
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);

  // 用藥建議表單
  const [adviceContent, setAdviceContent] = useState('');
  const [isPolishingAdvice, setIsPolishingAdvice] = useState(false);

  // 用藥建議送出對話框
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedAdviceCode, setSelectedAdviceCode] = useState<string>('');

  // 檢視模式：assessment（評估詳情）或 report（結構化報告）
  const [viewMode, setViewMode] = useState<'assessment' | 'report'>('assessment');

  // 當選擇病患時，自動載入病患用藥
  useEffect(() => {
    let cancelled = false;
    const loadActiveMeds = async () => {
      if (!selectedPatient) return;
      try {
        const resp = await getMedications(selectedPatient.id, { status: 'active', limit: 200 });
        const meds = resp.medications || [];
        const names = meds.map(m => m.name).filter(Boolean);
        const unique = Array.from(new Set(names));
        // Build name → atcCode lookup for downstream PAD matcher (PR-1 ATC enrichment).
        const atcMap: Record<string, string> = {};
        for (const m of meds) {
          if (m.name && m.atcCode) {
            atcMap[m.name.trim().toLowerCase()] = m.atcCode;
          }
        }
        if (!cancelled) {
          setDrugList(unique);
          setDrugAtcByName(atcMap);
        }
      } catch (err) {
        console.error(`${t('workstation.drugList.loadOrdersErrorLog')}:`, err);
        const sedation = selectedPatient.sedation || selectedPatient.sanSummary?.sedation || [];
        const analgesia = selectedPatient.analgesia || selectedPatient.sanSummary?.analgesia || [];
        const nmb = selectedPatient.nmb || selectedPatient.sanSummary?.nmb || [];
        const patientMeds = [...sedation, ...analgesia, ...nmb].filter(Boolean);
        if (!cancelled) setDrugList(patientMeds);
        toast.message(t('workstation.drugList.ordersFallback'));
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
      toast.error(t('workstation.drugList.addError'));
      return;
    }

    if (!selectedPatient) {
      toast.error(t('workstation.drugList.needPatient'));
      return;
    }

    setIsAssessing(true);
    try {
      const results = await runComprehensiveAssessment({
        drugList,
        selectedPatient,
        extendedData,
        drugAtcByName,
        t,
      });
      setAssessmentResults(results);

      toast.success(t('workstation.assess.complete'));
    } finally {
      setIsAssessing(false);
    }
  };

  // 產生用藥建議報告
  const handleGenerateAdvice = () => {
    if (!assessmentResults) {
      toast.error(t('workstation.assess.needFirst'));
      return;
    }

    let report = `${t('workstation.report.header')}\n\n`;
    report += `${t('workstation.report.patientLine', { name: maskPatientName(selectedPatient?.name), bed: selectedPatient?.bedNumber })}\n`;
    report += `${t('workstation.report.dateLine', { date: new Date().toLocaleString('zh-TW') })}\n`;
    report += `${t('workstation.report.pharmacistLine', { name: user?.name })}\n\n`;
    
    report += `${t('workstation.report.drugsHeader')}\n${drugList.join('、')}\n\n`;

    if (assessmentResults.duplicates.length > 0) {
      const levelLabel: Record<string, string> = {
        critical: t('workstation.assess.duplicateLevels.critical'),
        high: t('workstation.assess.duplicateLevels.high'),
        moderate: t('workstation.assess.duplicateLevels.moderate'),
        low: t('workstation.assess.duplicateLevels.low'),
        info: t('workstation.assess.duplicateLevels.info'),
      };
      report += `${t('workstation.report.duplicateHeader')}\n`;
      assessmentResults.duplicates.forEach((dup, idx) => {
        const drugs = dup.members.map(m => m.genericName).join(' + ');
        report += `${idx + 1}. [${levelLabel[dup.level] ?? dup.level}/${dup.layer}] ${drugs}\n`;
        report += `   ${t('workstation.report.mechanism', { value: dup.mechanism })}\n`;
        if (dup.recommendation) report += `   ${t('workstation.report.recommendation', { value: dup.recommendation })}\n`;
        report += '\n';
      });
    }

    if (assessmentResults.interactions.length > 0) {
      report += `${t('workstation.report.ddiHeader')}\n`;
      assessmentResults.interactions.forEach((int, idx) => {
        report += `${idx + 1}. ${int.drugA} + ${int.drugB} (${t('workstation.report.ddiSeverity', { value: int.severity })})\n`;
        report += `   ${int.description}\n`;
        report += `   ${t('workstation.report.ddiManagement', { value: int.management })}\n\n`;
      });
    }

    if (assessmentResults.compatibility.some(c => !c.compatible)) {
      report += `${t('workstation.report.compatibilityHeader')}\n`;
      assessmentResults.compatibility.filter(c => !c.compatible).forEach((comp, idx) => {
        report += `${idx + 1}. ${comp.drugA} + ${comp.drugB}: ${t('workstation.report.compatibilityIncompatible')}\n`;
        report += `   ${t('workstation.report.compatibilityNote', { value: comp.notes })}\n\n`;
      });
    }

    if (typeof extendedData?.egfr === 'number' && extendedData.egfr < 60) {
      report += `${t('workstation.report.doseAdjustHeader')}\n`;
      report += `${t('workstation.report.renalAdjustment', { value: extendedData.egfr })}\n\n`;
    }

    report += `${t('workstation.report.summaryHeader')}\n`;
    assessmentResults.adviceRecommendations.forEach((rec, idx) => {
      report += `${idx + 1}. ${rec}\n`;
    });

    setAdviceContent(report);
    setViewMode('report');
    toast.success(t('workstation.report.generated'));
  };

  // AI 修飾用藥建議
  const handlePolishAdvice = async () => {
    if (!adviceContent.trim() || !selectedPatientId) return;
    setIsPolishingAdvice(true);
    try {
      const result = await polishClinicalText({
        patientId: selectedPatientId,
        content: adviceContent,
        polishType: 'medication_advice',
      });
      setAdviceContent(result.polished);
      toast.success(t('workstation.advice.polishSuccess'));
    } catch {
      toast.error(t('workstation.advice.polishError'));
    } finally {
      setIsPolishingAdvice(false);
    }
  };

  // 儲存用藥建議
  const handleSaveAdvice = () => {
    if (!adviceContent.trim()) {
      toast.error(t('workstation.advice.needContent'));
      return;
    }

    // 開啟選擇分類對話框
    setShowSubmitDialog(true);
  };

  // 確認送出用藥建議
  const handleConfirmSubmit = async () => {
    if (!selectedPatient) {
      toast.error(t('workstation.advice.needPatient'));
      return;
    }
    if (!adviceContent.trim()) {
      toast.error(t('workstation.advice.needContent'));
      return;
    }
    if (!selectedAdviceCode || !selectedCategory) {
      toast.error(t('workstation.advice.needCategory'));
      return;
    }

    // 取得分類資訊
    const categoryInfo = adviceCategories[selectedCategory as keyof typeof adviceCategories];
    const codeInfo = categoryInfo.codes.find(c => c.code === selectedAdviceCode);
    if (!codeInfo) {
      toast.error(t('workstation.advice.invalidCode'));
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
      toast.success(t('workstation.advice.submittedToBoardWith', { label: codeInfo.label }));
      setAdviceContent('');
      setShowSubmitDialog(false);
      setSelectedCategory('');
      setSelectedAdviceCode('');
    } catch (err) {
      console.error(`${t('workstation.advice.submitErrorLog')}:`, err);
      toast.error(t('workstation.advice.submitError'));
    }
  };

  // 跳轉到用藥建議與統計頁面
  const handleGoToStatistics = () => {
    navigate('/pharmacy/advice-statistics');
  };

  const assessReady = !!selectedPatient && drugList.length > 0 && !isAssessing;
  const assessHint = !selectedPatient
    ? t('workstation.assessHint.needPatient')
    : drugList.length === 0
      ? t('workstation.assessHint.needDrug')
      : t('workstation.assessHint.ready');

  return (
    <div className="p-6 space-y-4">
      {/* 標題 */}
      <div>
        <h1 className="text-2xl font-bold">{t('workstation.header.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('workstation.header.subtitle')}
        </p>
      </div>

      {/* P1-Ph5: md:grid-cols-5 picks up iPad portrait (768-1023px) so the
          assessment panel stays beside the patient picker. Without this the
          layout fell to grid-cols-1 below 1024px and pushed the "執行全面評估"
          CTA below the fold on every common tablet. */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 左側：病患與用藥管理 (40%) */}
        <div className="md:col-span-2 space-y-4">
          {/* 病患選擇 */}
          <Card className="border-brand">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-5 w-5 text-brand" />
                {t('workstation.patientSelect.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId} disabled={patientsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={patientsLoading ? t('workstation.patientSelect.loading') : patientsError ? t('workstation.patientSelect.loadFail') : t('workstation.patientSelect.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      <span className="inline-flex items-center gap-2 w-full">
                        <span>
                          {patient.bedNumber} - {maskPatientName(patient.name)} ({t('workstation.patientSelect.labels.ageWithSuffix', { age: patient.age })})
                        </span>
                        <DuplicateCountsBadge
                          counts={duplicateSummary?.counts?.[patient.id]}
                          computing={duplicateSummary?.computing?.[patient.id] ?? false}
                        />
                      </span>
                    </SelectItem>
                  ))}
                  {!patientsLoading && patients.length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      {patientsError || t('workstation.patientSelect.empty')}
                    </div>
                  )}
                </SelectContent>
              </Select>

              {selectedPatient && extendedData && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.bed')}</p>
                      <p className="font-semibold">{selectedPatient.bedNumber}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.name')}</p>
                      <p className="font-semibold flex items-center gap-2">
                        {maskPatientName(selectedPatient.name)}
                        <DuplicateCountsBadge
                          counts={duplicateSummary?.counts?.[selectedPatient.id]}
                          computing={duplicateSummary?.computing?.[selectedPatient.id] ?? false}
                        />
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.ageHeightWeight')}</p>
                      <p className="font-semibold">
                        {t('workstation.patientSelect.labels.ageWithSuffix', { age: selectedPatient.age })} / {typeof extendedData.height === 'number' ? `${extendedData.height}cm` : 'N/A'} / {typeof extendedData.weight === 'number' ? `${extendedData.weight}kg` : 'N/A'}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.diagnosis')}</p>
                      <p className="font-semibold text-sm">{selectedPatient.diagnosis}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 用藥列表管理 */}
          {selectedPatient && (
            <Card className="border-brand">
              <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Pill className="h-5 w-5 text-brand" />
                    {t('workstation.drugList.title')}
                  </CardTitle>
                  <Badge className="bg-brand">
                    {t('workstation.drugList.countSuffix', { count: drugList.length })}
                  </Badge>
                </div>
                <CardDescription className="text-xs">{t('workstation.drugList.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {/* 新增藥品 */}
                <div className="flex gap-2">
                  <Input
                    placeholder={t('workstation.drugList.addPlaceholder')}
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
                    className="bg-brand hover:bg-brand-hover"
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
                          className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border dark:border-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground w-5 text-right">{index + 1}.</span>
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
                      {t('workstation.drugList.empty')}
                    </AlertDescription>
                  </Alert>
                )}

              </CardContent>
            </Card>
          )}
        </div>

        {viewMode === 'report' && assessmentResults ? (
          <PharmacyReportView
            selectedPatient={selectedPatient ? {
              name: maskPatientName(selectedPatient.name),
              bedNumber: selectedPatient.bedNumber,
              age: selectedPatient.age,
              diagnosis: selectedPatient.diagnosis,
            } : null}
            assessmentResults={assessmentResults}
            drugList={drugList}
            extendedData={extendedData}
            pharmacistName={user?.name || ''}
            adviceContent={adviceContent}
            onAdviceContentChange={setAdviceContent}
            onSaveAdvice={handleSaveAdvice}
            onBackToAssessment={() => setViewMode('assessment')}
            patientId={selectedPatientId}
            onPolishAdvice={handlePolishAdvice}
            isPolishing={isPolishingAdvice}
          />
        ) : (
          <AssessmentResultsPanel
            selectedPatient={selectedPatient}
            assessmentResults={assessmentResults}
            drugList={drugList}
            expandedSections={{ interactions: true, compatibility: true, dosage: true, duplicates: true, advice: true }}
            toggleSection={() => {}}
            extendedData={extendedData}
            adviceContent={adviceContent}
            onAdviceContentChange={setAdviceContent}
            onGoToStatistics={handleGoToStatistics}
            onGenerateAdvice={handleGenerateAdvice}
            onSaveAdvice={handleSaveAdvice}
            onRunAssessment={handleComprehensiveAssessment}
            assessReady={assessReady}
            assessHint={assessHint}
            isAssessing={isAssessing}
          />
        )}

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
