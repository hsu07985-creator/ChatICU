import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n/config';
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

const HEPATIC_KEYS: Record<string, string> = {
  normal: 'workstation.assess.reportView.hepaticLabels.normal',
  mild: 'workstation.assess.reportView.hepaticLabels.mild',
  moderate: 'workstation.assess.reportView.hepaticLabels.moderate',
  severe: 'workstation.assess.reportView.hepaticLabels.severe',
};

const SEVERITY_KEYS: Record<string, { labelKey: string; className: string }> = {
  high: { labelKey: 'workstation.assess.reportView.severityHigh', className: 'bg-red-600 text-white' },
  medium: { labelKey: 'workstation.assess.reportView.severityMedium', className: 'bg-[#f59e0b] text-white' },
  low: { labelKey: 'workstation.assess.reportView.severityLow', className: 'bg-gray-400 text-white' },
};

type DrugCategoryId =
  | 'antibiotics'
  | 'sedationPsych'
  | 'respiratory'
  | 'cardioUro'
  | 'giMetabolic'
  | 'oralChronic'
  | 'other';

const DRUG_CATEGORY_ORDER: DrugCategoryId[] = [
  'antibiotics',
  'sedationPsych',
  'respiratory',
  'cardioUro',
  'giMetabolic',
  'oralChronic',
  'other',
];

function classifyDrug(drug: string): DrugCategoryId {
  const normalized = drug.toLowerCase();

  if (
    /(tazocin|cravit|tygacil|levofloxacin|tigecycline|piperaci|tazo|antibiotic|抗[1-9]|vanc|meropenem|cef|zosyn)/.test(normalized)
  ) {
    return 'antibiotics';
  }

  if (
    /(dexmedetomidine|fentanyl|midazolam|cisatracurium|propofol|lorazepam|haloperidol|alprazolam|risperidone|memantine|zopiclone|鎮靜|止痛|精神)/.test(normalized)
  ) {
    return 'sedationPsych';
  }

  if (
    /(combivent|spiolto|acetylcysteine|actein|inhalation|respimat|olodaterol|tiotropium)/.test(normalized)
  ) {
    return 'respiratory';
  }

  if (
    /(diovan|valsartan|urief|silodosin|benzbromarone|entecavir|baraclude)/.test(normalized)
  ) {
    return 'cardioUro';
  }

  if (
    /(takepron|lansoprazole|kimodin|famotidine|kascoal|sennapur|mosa|mosad|mosapride|lipanthyl|fenofibrate|prednisolone|dimethicone)/.test(normalized)
  ) {
    return 'giMetabolic';
  }

  if (/(tab|cap|oral|口服液|drop)/.test(normalized)) {
    return 'oralChronic';
  }

  return 'other';
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
  const { t } = useTranslation('pharmacy');
  const now = new Date().toLocaleString(i18n.language);
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
      toast.success(t('workstation.assess.reportView.copySuccess'));
    } catch {
      toast.error(t('workstation.assess.reportView.copyFail'));
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
              <CardTitle className="text-xl text-white">{t('workstation.assess.reportView.title')}</CardTitle>
            </div>
            <p className="text-sm text-white/80">{now}</p>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.bed')}</p>
              <p className="font-semibold">{selectedPatient?.bedNumber || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.name')}</p>
              <p className="font-semibold">{selectedPatient?.name || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.age')}</p>
              <p className="font-semibold">{selectedPatient?.age ? t('workstation.assess.reportView.ageWithUnit', { age: selectedPatient.age }) : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.weight')}</p>
              <p className="font-semibold">
                {typeof extendedData?.weight === 'number' ? t('workstation.assess.reportView.weightWithUnit', { weight: extendedData.weight }) : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.egfr')}</p>
              <p className={`font-semibold ${typeof extendedData?.egfr === 'number' && extendedData.egfr < 60 ? 'text-[#f59e0b]' : ''}`}>
                {typeof extendedData?.egfr === 'number' ? extendedData.egfr : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.hepatic')}</p>
              <p className="font-semibold">
                {t(HEPATIC_KEYS[extendedData?.hepaticFunction || 'normal'])}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">{t('workstation.assess.reportView.diagnosis')}</p>
              <p className="font-semibold">{selectedPatient?.diagnosis || '—'}</p>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-muted-foreground text-xs mb-1.5">
              {t('workstation.assess.reportView.drugsHeader', { count: drugList.length })}
            </p>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              {groupedDrugEntries.map((group) => (
                <details key={group.category} className="group border-b border-slate-200 dark:border-slate-700 px-3 last:border-b-0" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 marker:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                        {t('workstation.assess.reportView.groupItems', { count: group.items.length })}
                      </span>
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {t(`workstation.assess.reportView.categories.${group.category}`)}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 transition-transform group-open:rotate-180">
                      ∨
                    </span>
                  </summary>
                  <div className="pb-3">
                    <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                      {group.items.map(({ drug, index }) => (
                        <div
                          key={`${group.category}-${index}-${drug}`}
                          className="flex min-w-0 items-start gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-sm"
                        >
                          <span className="mt-0.5 shrink-0 text-xs font-semibold text-brand">
                            {index + 1}.
                          </span>
                          <span className="min-w-0 break-words leading-5 text-slate-700 dark:text-slate-300">
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
            {t('workstation.assess.reportView.pharmacistLabel', { name: pharmacistName || '—' })}
          </div>
        </CardContent>
      </Card>

      {/* ── Summary Alert ── */}
      {(highRiskCount > 0 || incompatiblePairs.length > 0) && (
        <Alert className="border-[#f59e0b] bg-[#f59e0b]/10">
          <AlertTriangle className="h-4 w-4 text-[#f59e0b]" />
          <AlertDescription className="text-sm font-medium">
            {highRiskCount > 0 && t('workstation.assess.reportView.summaryHighRisk', { count: highRiskCount })}
            {highRiskCount > 0 && incompatiblePairs.length > 0 && t('workstation.assess.reportView.summaryConn')}
            {incompatiblePairs.length > 0 && t('workstation.assess.reportView.summaryIncompat', { count: incompatiblePairs.length })}
            {t('workstation.assess.reportView.summaryTail')}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Section 1: Drug Interactions ── */}
      <Card>
        <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${assessmentResults.interactions.length > 0 ? 'text-[#f59e0b]' : 'text-brand'}`} />
            <CardTitle className="text-base">{t('workstation.assess.reportView.ddiTitle')}</CardTitle>
            <Badge variant={assessmentResults.interactions.length > 0 ? 'default' : 'outline'} className={assessmentResults.interactions.length > 0 ? 'bg-[#f59e0b] text-white' : ''}>
              {assessmentResults.interactions.length > 0 ? t('workstation.assess.reportView.ddiCount', { count: assessmentResults.interactions.length }) : t('workstation.assess.reportView.ddiNoIssue')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          {assessmentResults.interactions.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700 py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{t('workstation.assess.reportView.ddiNotFound')}</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workstation.assess.reportView.ddiDrugA')}</TableHead>
                  <TableHead>{t('workstation.assess.reportView.ddiDrugB')}</TableHead>
                  <TableHead>{t('workstation.assess.reportView.ddiSeverity')}</TableHead>
                  <TableHead className="whitespace-normal">{t('workstation.assess.reportView.ddiClinical')}</TableHead>
                  <TableHead className="whitespace-normal">{t('workstation.assess.reportView.ddiManagement')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assessmentResults.interactions.map((int, idx) => {
                  const cfg = SEVERITY_KEYS[int.severity];
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{int.drugA}</TableCell>
                      <TableCell className="font-medium">{int.drugB}</TableCell>
                      <TableCell>
                        <Badge className={cfg.className}>{t(cfg.labelKey)}</Badge>
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
        <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
          <div className="flex items-center gap-2">
            <Droplets className={`h-5 w-5 ${incompatiblePairs.length > 0 ? 'text-[#f59e0b]' : 'text-brand'}`} />
            <CardTitle className="text-base">{t('workstation.assess.reportView.ivTitle')}</CardTitle>
            {incompatiblePairs.length > 0 ? (
              <Badge variant="secondary" className="text-xs">
                {t('workstation.assess.reportView.ivIncompatBadge', { count: incompatiblePairs.length })}
              </Badge>
            ) : assessmentResults.compatibilityPairsChecked > 0 ? (
              <Badge variant="outline" className="text-xs">{t('workstation.assess.reportView.ivNoIncompat')}</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">{t('workstation.assess.reportView.ivNoData')}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-3 space-y-3">
          {assessmentResults.compatibilityPairsChecked > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t('workstation.assess.reportView.ivCheckedHint', { count: assessmentResults.compatibilityPairsChecked })}
              </p>
              {incompatiblePairs.length > 0 ? (
                <div className="space-y-2">
                  {incompatiblePairs.map((pair, idx) => (
                    <div key={idx} className="border dark:border-slate-700 rounded-lg p-3 bg-red-50/50 dark:bg-red-900/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-[#f59e0b]" />
                          <p className="font-semibold text-sm">
                            {pair.drugA} + {pair.drugB}
                          </p>
                        </div>
                        <Badge className="bg-[#f59e0b] text-white">{t('workstation.assess.reportView.ivIncompatLabel')}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{t('workstation.assess.reportView.ivNoIncompatBody')}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{t('workstation.assess.reportView.ivNoCompatData')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: Dosage Adjustments (PAD 9 drugs only) ── */}
      <Card>
        <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-brand" />
            <CardTitle className="text-base">{t('workstation.assess.reportView.doseTitle')}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {t('workstation.assess.reportView.ddiCount', { count: assessmentResults.dosage.length })}
            </Badge>
            {assessmentResults.dosage.length > 0 && (
              <>
                <Badge variant="outline" className="text-xs">
                  {t('workstation.assess.reportView.doseConverted', { count: calculatedDoseCount })}
                </Badge>
                {pendingDoseCount > 0 && (
                  <Badge variant="outline" className="border-[#f59e0b] text-xs text-[#f59e0b]">
                    {t('workstation.assess.reportView.dosePending', { count: pendingDoseCount })}
                  </Badge>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('workstation.assess.reportView.doseHint')}
          </p>
        </CardHeader>
        <CardContent className="pt-3">
          {assessmentResults.dosage.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{t('workstation.assess.reportView.doseNone')}</span>
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
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-brand" />
              <CardTitle className="text-base">{t('workstation.assess.reportView.summaryTitle')}</CardTitle>
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
            {t('workstation.assess.reportView.actionPrint')}
          </Button>
          <Button onClick={handleCopy} variant="outline" size="sm">
            <Copy className="mr-1.5 h-4 w-4" />
            {t('workstation.assess.reportView.actionCopy')}
          </Button>
          <Button onClick={onBackToAssessment} variant="outline" size="sm">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t('workstation.assess.reportView.actionBack')}
          </Button>
          {onPolishAdvice && (
            <Button
              onClick={onPolishAdvice}
              disabled={!adviceContent.trim() || isPolishing}
              size="sm"
              variant="outline"
            >
              <Brain className="mr-1.5 h-4 w-4" />
              {isPolishing ? t('workstation.assess.reportView.actionPolishing') : t('workstation.assess.reportView.actionPolish')}
            </Button>
          )}
          <Button
            onClick={onSaveAdvice}
            disabled={!adviceContent.trim()}
            size="sm"
            className="bg-brand hover:bg-brand-hover"
          >
            <Send className="mr-1.5 h-4 w-4" />
            {t('workstation.assess.reportView.actionSubmit')}
          </Button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('workstation.assess.reportView.editHint')}</p>
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
