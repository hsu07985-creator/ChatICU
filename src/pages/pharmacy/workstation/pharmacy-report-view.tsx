import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Separator } from '../../../components/ui/separator';
import { Textarea } from '../../../components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Printer,
  Copy,
  ArrowLeft,
  Send,
  Lightbulb,
  FileText,
  Droplets,
  Calculator,
  Brain,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AssessmentResults, ExtendedPatientData } from './types';
import { DosageRecommendationCard } from './dosage-recommendation-card';

interface PatientLite {
  name: string;
  bedNumber?: string;
  age?: number;
  diagnosis?: string;
}

interface PharmacyReportViewProps {
  selectedPatient: PatientLite | null;
  assessmentResults: AssessmentResults;
  drugList: string[];
  extendedData: ExtendedPatientData | null;
  pharmacistName: string;
  adviceContent: string;
  onAdviceContentChange: (value: string) => void;
  onSaveAdvice: () => void;
  onBackToAssessment: () => void;
  patientId?: string;
  onPolishAdvice?: () => void;
  isPolishing?: boolean;
}

const hepaticLabels: Record<string, string> = {
  normal: '正常',
  mild: 'Child-Pugh A（輕度）',
  moderate: 'Child-Pugh B（中度）',
  severe: 'Child-Pugh C（重度）',
};

const severityConfig = {
  high: { label: '高風險', className: 'bg-red-600 text-white' },
  medium: { label: '中風險', className: 'bg-[#f59e0b] text-white' },
  low: { label: '低風險', className: 'bg-gray-400 text-white' },
};

const DRUG_CATEGORY_ORDER = [
  '抗生素與感染治療',
  '鎮靜止痛與精神神經',
  '呼吸道用藥',
  '心血管與泌尿',
  '腸胃與代謝',
  '口服慢性用藥',
  '其他用藥',
] as const;

function classifyDrug(drug: string): (typeof DRUG_CATEGORY_ORDER)[number] {
  const normalized = drug.toLowerCase();

  if (
    /(tazocin|cravit|tygacil|levofloxacin|tigecycline|piperaci|tazo|antibiotic|抗[1-9]|vanc|meropenem|cef|zosyn)/.test(normalized)
  ) {
    return '抗生素與感染治療';
  }

  if (
    /(dexmedetomidine|fentanyl|midazolam|cisatracurium|propofol|lorazepam|haloperidol|alprazolam|risperidone|memantine|zopiclone|鎮靜|止痛|精神)/.test(normalized)
  ) {
    return '鎮靜止痛與精神神經';
  }

  if (
    /(combivent|spiolto|acetylcysteine|actein|inhalation|respimat|olodaterol|tiotropium)/.test(normalized)
  ) {
    return '呼吸道用藥';
  }

  if (
    /(diovan|valsartan|urief|silodosin|benzbromarone|entecavir|baraclude)/.test(normalized)
  ) {
    return '心血管與泌尿';
  }

  if (
    /(takepron|lansoprazole|kimodin|famotidine|kascoal|sennapur|mosa|mosad|mosapride|lipanthyl|fenofibrate|prednisolone|dimethicone)/.test(normalized)
  ) {
    return '腸胃與代謝';
  }

  if (/(tab|cap|oral|口服液|drop)/.test(normalized)) {
    return '口服慢性用藥';
  }

  return '其他用藥';
}

export function PharmacyReportView({
  selectedPatient,
  assessmentResults,
  drugList,
  extendedData,
  pharmacistName,
  adviceContent,
  onAdviceContentChange,
  onSaveAdvice,
  onBackToAssessment,
  onPolishAdvice,
  isPolishing = false,
}: PharmacyReportViewProps) {
  const now = new Date().toLocaleString('zh-TW');
  const incompatiblePairs = assessmentResults.compatibility.filter(c => c.compatible === false);
  const highRiskCount = assessmentResults.interactions.filter(i => i.severity === 'high').length;
  const calculatedDoseCount = assessmentResults.dosage.filter(d => d.status === 'calculated').length;
  const pendingDoseCount = assessmentResults.dosage.filter(d => d.status === 'requires_input').length;
  const groupedDrugEntries = DRUG_CATEGORY_ORDER.map(category => ({
    category,
    items: drugList
      .map((drug, index) => ({ drug, index }))
      .filter(({ drug }) => classifyDrug(drug) === category),
  })).filter(group => group.items.length > 0);

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(adviceContent);
      toast.success('已複製純文字報告至剪貼簿');
    } catch {
      toast.error('複製失敗');
    }
  };

  return (
    <div className="lg:col-span-3 space-y-4 print-report">
      {/* ── Report Header ── */}
      <Card className="border-brand border-2">
        <CardHeader className="bg-brand text-white py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6" />
              <CardTitle className="text-xl text-white">藥事評估報告</CardTitle>
            </div>
            <p className="text-sm text-white/80">{now}</p>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">床號</p>
              <p className="font-semibold">{selectedPatient?.bedNumber || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">姓名</p>
              <p className="font-semibold">{selectedPatient?.name || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">年齡</p>
              <p className="font-semibold">{selectedPatient?.age ? `${selectedPatient.age} 歲` : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">體重</p>
              <p className="font-semibold">
                {typeof extendedData?.weight === 'number' ? `${extendedData.weight} kg` : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">腎功能 eGFR</p>
              <p className={`font-semibold ${typeof extendedData?.egfr === 'number' && extendedData.egfr < 60 ? 'text-[#f59e0b]' : ''}`}>
                {typeof extendedData?.egfr === 'number' ? extendedData.egfr : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">肝功能</p>
              <p className="font-semibold">
                {hepaticLabels[extendedData?.hepaticFunction || 'normal']}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">診斷</p>
              <p className="font-semibold">{selectedPatient?.diagnosis || '—'}</p>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-muted-foreground text-xs mb-1.5">
              評估藥物（{drugList.length} 項）
            </p>
            <div className="rounded-lg border border-slate-200 bg-white">
              {groupedDrugEntries.map((group) => (
                <details key={group.category} className="group border-b border-slate-200 px-3 last:border-b-0" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 marker:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                        {group.items.length} 項
                      </span>
                      <span className="text-sm font-semibold text-slate-800">
                        {group.category}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-slate-500 transition-transform group-open:rotate-180">
                      ∨
                    </span>
                  </summary>
                  <div className="pb-3">
                    <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                      {group.items.map(({ drug, index }) => (
                        <div
                          key={`${group.category}-${index}-${drug}`}
                          className="flex min-w-0 items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm"
                        >
                          <span className="mt-0.5 shrink-0 text-xs font-semibold text-brand">
                            {index + 1}.
                          </span>
                          <span className="min-w-0 break-words leading-5 text-slate-700">
                            {drug}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            評估藥師：{pharmacistName || '—'}
          </div>
        </CardContent>
      </Card>

      {/* ── Summary Alert ── */}
      {(highRiskCount > 0 || incompatiblePairs.length > 0) && (
        <Alert className="border-[#f59e0b] bg-[#f59e0b]/10">
          <AlertTriangle className="h-4 w-4 text-[#f59e0b]" />
          <AlertDescription className="text-sm font-medium">
            {highRiskCount > 0 && `${highRiskCount} 項高風險交互作用`}
            {highRiskCount > 0 && incompatiblePairs.length > 0 && '、'}
            {incompatiblePairs.length > 0 && `${incompatiblePairs.length} 組不相容組合`}
            ，請特別注意。
          </AlertDescription>
        </Alert>
      )}

      {/* ── Section 1: Drug Interactions ── */}
      <Card>
        <CardHeader className="bg-slate-50 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${assessmentResults.interactions.length > 0 ? 'text-[#f59e0b]' : 'text-brand'}`} />
            <CardTitle className="text-base">藥物交互作用</CardTitle>
            <Badge variant={assessmentResults.interactions.length > 0 ? 'default' : 'outline'} className={assessmentResults.interactions.length > 0 ? 'bg-[#f59e0b] text-white' : ''}>
              {assessmentResults.interactions.length > 0 ? `${assessmentResults.interactions.length} 項` : '無異常'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          {assessmentResults.interactions.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700 py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>未發現藥物交互作用</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>藥物 A</TableHead>
                  <TableHead>藥物 B</TableHead>
                  <TableHead>嚴重度</TableHead>
                  <TableHead className="whitespace-normal">臨床效果</TableHead>
                  <TableHead className="whitespace-normal">處置建議</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assessmentResults.interactions.map((int, idx) => {
                  const cfg = severityConfig[int.severity];
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{int.drugA}</TableCell>
                      <TableCell className="font-medium">{int.drugB}</TableCell>
                      <TableCell>
                        <Badge className={cfg.className}>{cfg.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal max-w-[200px]">
                        {int.clinicalEffect || int.description || '—'}
                      </TableCell>
                      <TableCell className="whitespace-normal max-w-[200px]">
                        {int.management || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: IV Compatibility ── */}
      <Card>
        <CardHeader className="bg-slate-50 py-3">
          <div className="flex items-center gap-2">
            <Droplets className={`h-5 w-5 ${incompatiblePairs.length > 0 ? 'text-[#f59e0b]' : 'text-brand'}`} />
            <CardTitle className="text-base">靜脈注射相容性</CardTitle>
            {incompatiblePairs.length > 0 ? (
              <Badge variant="secondary" className="text-xs">
                {incompatiblePairs.length} 組不相容
              </Badge>
            ) : assessmentResults.compatibilityPairsChecked > 0 ? (
              <Badge variant="outline" className="text-xs">未見不相容</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">無資料</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-3 space-y-3">
          {assessmentResults.compatibilityPairsChecked > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                已檢查 {assessmentResults.compatibilityPairsChecked} 組 IV 組合，以下僅列出不相容藥對。
              </p>
              {incompatiblePairs.length > 0 ? (
                <div className="space-y-2">
                  {incompatiblePairs.map((pair, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-red-50/50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-[#f59e0b]" />
                          <p className="font-semibold text-sm">
                            {pair.drugA} + {pair.drugB}
                          </p>
                        </div>
                        <Badge className="bg-[#f59e0b] text-white">不相容</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>本次查詢未發現不相容的靜脈注射藥物組合</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>目前無相容性資料</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: Dosage Adjustments (PAD 9 drugs only) ── */}
      <Card>
        <CardHeader className="bg-slate-50 py-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-brand" />
            <CardTitle className="text-base">劑量調整建議</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {assessmentResults.dosage.length} 項
            </Badge>
            {assessmentResults.dosage.length > 0 && (
              <>
                <Badge variant="outline" className="text-xs">
                  已換算 {calculatedDoseCount}
                </Badge>
                {pendingDoseCount > 0 && (
                  <Badge variant="outline" className="border-[#f59e0b] text-xs text-[#f59e0b]">
                    待補 {pendingDoseCount}
                  </Badge>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            僅顯示目前用藥中的 PAD 支援藥物，以下為重點換算結果。
          </p>
        </CardHeader>
        <CardContent className="pt-3">
          {assessmentResults.dosage.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>目前用藥中無 PAD 支援藥物，無需劑量調整計算</span>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {assessmentResults.dosage.map((dose, idx) => (
                <DosageRecommendationCard
                  key={`${dose.drugName}-${idx}`}
                  dose={dose}
                  showAdjustmentBadge={typeof extendedData?.egfr === 'number' && extendedData.egfr < 60}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 4: Recommendations ── */}
      {assessmentResults.adviceRecommendations.length > 0 && (
        <Card className="border-l-4 border-l-brand">
          <CardHeader className="bg-slate-50 py-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-brand" />
              <CardTitle className="text-base">綜合建議</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            <ol className="list-decimal list-inside space-y-1.5 text-sm">
              {assessmentResults.adviceRecommendations.map((rec, idx) => (
                <li key={idx}>{rec}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* ── Action Bar (hidden when printing) ── */}
      <div className="no-print space-y-3">
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button onClick={handlePrint} variant="outline" size="sm">
            <Printer className="mr-1.5 h-4 w-4" />
            列印報告
          </Button>
          <Button onClick={handleCopy} variant="outline" size="sm">
            <Copy className="mr-1.5 h-4 w-4" />
            複製純文字
          </Button>
          <Button onClick={onBackToAssessment} variant="outline" size="sm">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回評估詳情
          </Button>
          {onPolishAdvice && (
            <Button
              onClick={onPolishAdvice}
              disabled={!adviceContent.trim() || isPolishing}
              size="sm"
              variant="outline"
            >
              <Brain className="mr-1.5 h-4 w-4" />
              {isPolishing ? 'AI 修飾中...' : 'AI 修飾建議'}
            </Button>
          )}
          <Button
            onClick={onSaveAdvice}
            disabled={!adviceContent.trim()}
            size="sm"
            className="bg-brand hover:bg-brand-hover"
          >
            <Send className="mr-1.5 h-4 w-4" />
            送出用藥建議
          </Button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">送出前可修改建議內容：</p>
          <Textarea
            value={adviceContent}
            onChange={(e) => onAdviceContentChange(e.target.value)}
            className="min-h-[120px] text-sm"
          />
        </div>
      </div>
    </div>
  );
}
