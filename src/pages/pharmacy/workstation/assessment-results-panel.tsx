import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Droplets,
  Calculator,
  Copy,
  RotateCw,
  User,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ButtonLoadingIndicator } from '../../../components/ui/button-loading-indicator';
import type { AssessmentResults, ExpandedSections, ExtendedPatientData, DrugInteraction, IVCompatibility } from './types';
import type { DuplicateAlert } from '../../../lib/api/medications';
import { DosageRecommendationCard } from './dosage-recommendation-card';
import { CompatibilityMatrix, CompatibilityMatrixLegend, type CompatibilityCell } from '../../../components/pharmacy/compatibility-matrix';

interface PatientLite {
  name: string;
  bedNumber?: string;
}

interface AssessmentResultsPanelProps {
  selectedPatient: PatientLite | null;
  assessmentResults: AssessmentResults | null;
  drugList: string[];
  expandedSections: ExpandedSections;
  toggleSection: (section: keyof ExpandedSections) => void;
  extendedData: ExtendedPatientData | null;
  adviceContent: string;
  onAdviceContentChange: (value: string) => void;
  onGoToStatistics: () => void;
  onGenerateAdvice: () => void;
  onSaveAdvice: () => void;
  onRunAssessment: () => void;
  assessReady: boolean;
  assessHint: string;
  isAssessing: boolean;
}

const RISK_BADGE_CLASS: Record<string, { className: string; short: string; labelKey: string }> = {
  X: { className: 'bg-red-700 text-white', short: 'X', labelKey: 'workstation.assess.risk.X' },
  D: { className: 'bg-[#f59e0b] text-white', short: 'D', labelKey: 'workstation.assess.risk.D' },
  C: { className: 'bg-blue-600 text-white', short: 'C', labelKey: 'workstation.assess.risk.C' },
  B: { className: 'bg-slate-500 text-white', short: 'B', labelKey: 'workstation.assess.risk.B' },
  A: { className: 'bg-green-600 text-white', short: 'A', labelKey: 'workstation.assess.risk.A' },
};


function formatDrugPair(int: { drugA: string; drugB: string; dependencies?: string[] }): string {
  if (int.dependencies && int.dependencies.length === 2) {
    return `${int.dependencies[0]} + ${int.dependencies[1]}`;
  }
  return `${int.drugA} + ${int.drugB}`;
}

/** Collapsible section wrapper */
function Section({ title, icon, count, countColor, defaultOpen, children }: {
  title: string;
  icon: React.ReactNode;
  count?: number | string;
  countColor?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
          {count != null && (
            <Badge variant="outline" className={`text-xs ${countColor || ''}`}>{count}</Badge>
          )}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <CardContent className="pt-0 pb-4">{children}</CardContent>}
    </Card>
  );
}

/** Single interaction row */
/** P0-4: Map severity to risk when riskRating is missing (local DB fallback).
 *  Was {low: 'B'} which renders as "B 無需調整" — a real moderate item with
 *  unknown risk became invisible monitoring guidance. Default low → C
 *  (monitor required) so unrated rows never silently disappear from the
 *  pharmacist's review. high → D (avoid), medium → C (monitor) unchanged. */
const SEVERITY_TO_RISK: Record<string, string> = { high: 'D', medium: 'C', low: 'C' };

function InteractionRow({ int }: { int: DrugInteraction }) {
  const { t } = useTranslation('pharmacy');
  const [expanded, setExpanded] = useState(false);
  const effectiveRisk = int.riskRating || SEVERITY_TO_RISK[int.severity] || 'C';
  const riskCfg = RISK_BADGE_CLASS[effectiveRisk];

  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center flex-wrap gap-2">
        {riskCfg && <Badge className={`${riskCfg.className} text-xs px-2 py-0.5`}>{t(riskCfg.labelKey)}</Badge>}
        <span className="font-semibold text-sm">{formatDrugPair(int)}</span>
      </div>
      {int.clinicalEffect && (
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{int.clinicalEffect}</p>
      )}
      {int.management && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-slate-700 dark:text-slate-300">{t('workstation.assess.panel.manageLabel')}</span>
          {int.management.length > 120 && !expanded
            ? <>{int.management.slice(0, 120)}… <button type="button" onClick={() => setExpanded(true)} className="text-brand hover:underline">{t('workstation.assess.panel.expand')}</button></>
            : int.management
          }
        </p>
      )}
      {expanded && (
        <>
          {int.mechanism && (
            <p className="text-xs text-muted-foreground"><span className="font-medium text-slate-700 dark:text-slate-300">{t('workstation.assess.panel.mechanismLabel')}</span>{int.mechanism}</p>
          )}
          {int.discussion && (
            <p className="text-xs text-muted-foreground leading-relaxed"><span className="font-medium text-slate-700 dark:text-slate-300">{t('workstation.assess.panel.discussionLabel')}</span>{int.discussion}</p>
          )}
          <button type="button" onClick={() => setExpanded(false)} className="text-xs text-brand hover:underline">{t('workstation.assess.panel.collapse')}</button>
        </>
      )}
    </div>
  );
}

const DUP_LEVEL_CLASS: Record<DuplicateAlert['level'], { className: string; labelKey: string }> = {
  critical: { className: 'bg-red-700 text-white', labelKey: 'workstation.assess.dupLevel.critical' },
  high:     { className: 'bg-[#f59e0b] text-white', labelKey: 'workstation.assess.dupLevel.high' },
  moderate: { className: 'bg-amber-200 text-amber-900', labelKey: 'workstation.assess.dupLevel.moderate' },
  low:      { className: 'bg-blue-100 text-blue-700', labelKey: 'workstation.assess.dupLevel.low' },
  info:     { className: 'bg-slate-200 text-slate-700', labelKey: 'workstation.assess.dupLevel.info' },
};

function DuplicateRow({ d }: { d: DuplicateAlert }) {
  const { t } = useTranslation('pharmacy');
  const cfg = DUP_LEVEL_CLASS[d.level];
  const drugNames = d.members.map(m => m.genericName).join(' + ');
  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center flex-wrap gap-2">
        <Badge className={`${cfg.className} text-xs px-2 py-0.5`}>{t(cfg.labelKey)}</Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{d.layer}</Badge>
        <span className="font-semibold text-sm">{drugNames}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{d.mechanism}</p>
      {d.recommendation && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-slate-700 dark:text-slate-300">{t('workstation.assess.panel.recommendLabel')}</span>
          {d.recommendation}
        </p>
      )}
      {d.autoDowngraded && d.downgradeReason && (
        <p className="text-[11px] text-amber-600 leading-relaxed">{t('workstation.assess.panel.autoDowngraded', { reason: d.downgradeReason })}</p>
      )}
    </div>
  );
}

/** Single compatibility row */
function CompatibilityRow({ c }: { c: IVCompatibility }) {
  const { t } = useTranslation('pharmacy');
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${c.compatible ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'}`}>
      <div className="flex items-center gap-2 min-w-0">
        {c.compatible
          ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          : <XCircle className="h-4 w-4 text-red-600 shrink-0" />
        }
        <span className="font-medium truncate">{c.drugA} + {c.drugB}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {c.solution && c.solution !== 'multiple' && (
          <Badge variant="outline" className="text-[10px]">{c.solution}</Badge>
        )}
        <Badge className={c.compatible ? 'bg-green-600 text-white text-xs' : 'bg-red-600 text-white text-xs'}>
          {c.compatible ? t('workstation.assess.panel.compatibleLabel') : t('workstation.assess.panel.incompatibleLabel')}
        </Badge>
      </div>
    </div>
  );
}

export function AssessmentResultsPanel({
  selectedPatient,
  assessmentResults,
  drugList,
  extendedData,
  onRunAssessment,
  assessReady,
  assessHint,
  isAssessing,
}: AssessmentResultsPanelProps) {
  const { t } = useTranslation('pharmacy');

  if (!selectedPatient) {
    return (
      <div className="lg:col-span-3">
        <Card>
          <CardContent className="py-16">
            <div className="text-center space-y-3">
              <User className="h-12 w-12 mx-auto text-muted-foreground" />
              <h3 className="font-semibold text-lg">{t('workstation.assess.panel.selectPatient')}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{t('workstation.assess.panel.selectPatientHint')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!assessmentResults) {
    return (
      <div className="lg:col-span-3">
        <Card className="border-brand/40">
          <CardContent className="py-12">
            <div className="text-center space-y-5">
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">{t('workstation.assess.panel.ready')}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t('workstation.assess.panel.drugsLoaded', { count: drugList.length })}
                </p>
              </div>
              <Button
                onClick={onRunAssessment}
                disabled={!assessReady}
                className="h-14 px-10 text-lg font-semibold bg-brand hover:bg-brand-hover shadow-lg"
                size="lg"
              >
                <span>{isAssessing ? t('workstation.assess.panel.processing') : t('workstation.assess.panel.runAssessment')}</span>
                {isAssessing ? <ButtonLoadingIndicator /> : null}
              </Button>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
                {assessHint}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { interactions, compatibility, dosage, duplicates, duplicateSummary, compatibilitySummary } = assessmentResults;

  // Interaction stats — use effective risk (fallback severity→risk mapping)
  const getEffectiveRisk = (i: DrugInteraction) => i.riskRating || SEVERITY_TO_RISK[i.severity] || 'C';
  const riskCounts: Record<string, number> = {};
  interactions.forEach(i => {
    const r = getEffectiveRisk(i);
    riskCounts[r] = (riskCounts[r] || 0) + 1;
  });
  const highRiskCount = (riskCounts['X'] || 0) + (riskCounts['D'] || 0);

  // Sort interactions: X first, then D, C, B, A
  const riskOrder: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };
  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedInteractions = [...interactions].sort((a, b) => {
    const ra = riskOrder[getEffectiveRisk(a)] ?? 5;
    const rb = riskOrder[getEffectiveRisk(b)] ?? 5;
    if (ra !== rb) return ra - rb;
    return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
  });

  // Compatibility stats — deduplicate
  const deduplicatedCompat = (() => {
    const seen = new Set<string>();
    return compatibility.filter(c => {
      const key = [c.drugA, c.drugB].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const incompatibleCount = deduplicatedCompat.filter(c => !c.compatible).length;
  const compatibleCount = deduplicatedCompat.filter(c => c.compatible).length;

  // IV-eligible drugs: derive from drugs that returned actual Y-Site data.
  // Anything not appearing in compatibility[] is either not an IV drug or not in
  // the Y-Site source — either way, irrelevant to a Y-Site compatibility view.
  const ivEligibleDrugs = (() => {
    const set = new Set<string>();
    for (const c of compatibility) {
      if (c.drugA) set.add(c.drugA);
      if (c.drugB) set.add(c.drugB);
    }
    return [...set].sort();
  })();

  const lookupCompatCell = (a: string, b: string): CompatibilityCell => {
    const cell = deduplicatedCompat.find(
      c => (c.drugA === a && c.drugB === b) || (c.drugA === b && c.drugB === a)
    );
    if (!cell) return { status: '-' };
    return {
      status: cell.compatible ? 'C' : 'I',
      notes: cell.notes,
    };
  };

  // Dosage stats
  const calculatedCount = dosage.filter(d => d.status === 'calculated').length;

  return (
    <div className="lg:col-span-3 space-y-3">
      {/* ── 評估摘要（精簡） ── */}
      <Card className="border-brand border-2">
        <CardHeader className="bg-brand text-white py-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              {t('workstation.assess.panel.summary')}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRunAssessment}
              disabled={!assessReady}
              className="h-8 px-2 text-white hover:bg-white/15 hover:text-white"
              aria-label={t('workstation.assess.panel.rerun')}
            >
              {isAssessing ? <ButtonLoadingIndicator /> : <RotateCw className="h-4 w-4" />}
              <span className="text-xs ml-1">{isAssessing ? t('workstation.assess.panel.processing') : t('workstation.assess.panel.rerun')}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 重複用藥 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Copy className={`h-4 w-4 ${(duplicateSummary.critical + duplicateSummary.high) > 0 ? 'text-red-600' : duplicateSummary.total > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-xs font-semibold">{t('workstation.assess.panel.duplicate')}</span>
              </div>
              {duplicateSummary.queryFailed ? (
                <p className="text-sm font-bold text-amber-600">{t('workstation.assess.panel.queryFailed')}</p>
              ) : duplicateSummary.total === 0 ? (
                <p className="text-xl font-bold text-green-600">{t('workstation.assess.panel.none')}</p>
              ) : (
                <>
                  <p className="text-xl font-bold">{duplicateSummary.total} <span className="text-xs font-normal">{t('workstation.assess.panel.items')}</span></p>
                  <div className="flex justify-center gap-1 mt-1 flex-wrap">
                    {duplicateSummary.critical > 0 && <Badge className="bg-red-700 text-white text-[10px] px-1.5 py-0">{t('workstation.assess.panel.criticalX', { count: duplicateSummary.critical })}</Badge>}
                    {duplicateSummary.high > 0 && <Badge className="bg-[#f59e0b] text-white text-[10px] px-1.5 py-0">{t('workstation.assess.panel.highX', { count: duplicateSummary.high })}</Badge>}
                    {duplicateSummary.moderate > 0 && <Badge className="bg-amber-200 text-amber-900 text-[10px] px-1.5 py-0">{t('workstation.assess.panel.moderateX', { count: duplicateSummary.moderate })}</Badge>}
                    {duplicateSummary.low > 0 && <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0">{t('workstation.assess.panel.lowX', { count: duplicateSummary.low })}</Badge>}
                  </div>
                </>
              )}
            </div>

            {/* 交互作用 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <AlertTriangle className={`h-4 w-4 ${interactions.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-xs font-semibold">{t('workstation.assess.panel.interaction')}</span>
              </div>
              {interactions.length === 0 ? (
                <p className="text-xl font-bold text-green-600">{t('workstation.assess.panel.none')}</p>
              ) : (
                <>
                  <p className="text-xl font-bold">{interactions.length} <span className="text-xs font-normal">{t('workstation.assess.panel.items')}</span></p>
                  {highRiskCount > 0 && (
                    <div className="flex justify-center gap-1 mt-1">
                      {(['X', 'D'] as const).map(r => {
                        const c = riskCounts[r];
                        if (!c) return null;
                        return <Badge key={r} className={`${RISK_BADGE_CLASS[r].className} text-[10px] px-1.5 py-0`}>{r}×{c}</Badge>;
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 相容性 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Droplets className={`h-4 w-4 ${incompatibleCount > 0 ? 'text-red-600' : ivEligibleDrugs.length > 0 ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-semibold">{t('workstation.assess.panel.ivCompatibility')}</span>
              </div>
              {ivEligibleDrugs.length === 0 ? (
                <>
                  <p className="text-sm font-bold text-muted-foreground">{t('workstation.assess.panel.noIvPair')}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{t('workstation.assess.panel.noIvPairHint')}</p>
                </>
              ) : incompatibleCount > 0 ? (
                <>
                  <p className="text-xl font-bold text-red-600">
                    {incompatibleCount} <span className="text-xs font-normal">{t('workstation.assess.panel.incompatPairs')}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {t('workstation.assess.panel.ivDrugsXPairs', { drugs: ivEligibleDrugs.length, pairs: compatibleCount + incompatibleCount })}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl font-bold text-green-600">{t('workstation.assess.panel.allCompatible')}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {t('workstation.assess.panel.ivDrugsCompatPairs', { drugs: ivEligibleDrugs.length, pairs: compatibleCount })}
                  </p>
                </>
              )}
              {compatibilitySummary && compatibilitySummary.queryFailed > 0 && (
                <p className="text-[10px] text-amber-500 mt-1">{t('workstation.assess.panel.queryFailedCount', { count: compatibilitySummary.queryFailed })}</p>
              )}
              {/* P0-3: surface batch truncation so pharmacist knows
                  uncovered pairs exist; previously silently counted as noData. */}
              {compatibilitySummary && (compatibilitySummary.truncatedPairs ?? 0) > 0 && (
                <p className="text-[10px] text-red-600 mt-1 font-semibold">
                  {t('workstation.assess.panel.truncatedWarn', { truncated: compatibilitySummary.truncatedPairs, total: compatibilitySummary.totalPairs })}
                </p>
              )}
            </div>

            {/* PAD 劑量 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Calculator className="h-4 w-4 text-brand" />
                <span className="text-xs font-semibold">{t('workstation.assess.panel.padDose')}</span>
              </div>
              {dosage.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">{t('workstation.assess.panel.noPadDrug')}</p>
              ) : (
                <p className="text-xl font-bold text-brand">{calculatedCount} <span className="text-xs font-normal">/ {dosage.length}</span></p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 重複用藥（獨立可展開） ── */}
      <Section
        title={t('workstation.assess.panel.duplicate')}
        icon={<Copy className={`h-4 w-4 ${(duplicateSummary.critical + duplicateSummary.high) > 0 ? 'text-red-600' : duplicateSummary.total > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />}
        count={duplicateSummary.queryFailed ? t('workstation.assess.panel.queryFailed') : duplicateSummary.total > 0 ? t('workstation.assess.panel.totalCount', { count: duplicateSummary.total }) : t('workstation.assess.panel.none')}
        countColor={
          duplicateSummary.queryFailed
            ? 'border-amber-300 text-amber-700'
            : (duplicateSummary.critical + duplicateSummary.high) > 0
              ? 'border-red-300 text-red-700'
              : duplicateSummary.total > 0
                ? 'border-amber-300 text-amber-700'
                : 'border-green-300 text-green-700'
        }
        defaultOpen={(duplicateSummary.critical + duplicateSummary.high) > 0}
      >
        {duplicateSummary.queryFailed ? (
          <div className="flex items-center gap-2 text-amber-700 py-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{t('workstation.assess.panel.duplicateQueryFail')}</span>
          </div>
        ) : duplicates.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 py-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">{t('workstation.assess.panel.duplicateNotFound')}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {duplicates.map((d) => (
              <DuplicateRow key={d.fingerprint} d={d} />
            ))}
          </div>
        )}
      </Section>

      {/* ── 交互作用（獨立可展開） ── */}
      <Section
        title={t('workstation.assess.panel.interaction')}
        icon={<AlertTriangle className={`h-4 w-4 ${highRiskCount > 0 ? 'text-red-600' : interactions.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />}
        count={interactions.length > 0 ? t('workstation.assess.panel.totalCount', { count: interactions.length }) : t('workstation.assess.panel.none')}
        countColor={highRiskCount > 0 ? 'border-red-300 text-red-700' : interactions.length > 0 ? 'border-amber-300 text-amber-700' : 'border-green-300 text-green-700'}
        defaultOpen={highRiskCount > 0}
      >
        {interactions.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 py-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">{t('workstation.assess.panel.interactionNotFound')}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedInteractions.map((int, idx) => (
              <InteractionRow key={`${int.id || idx}`} int={int} />
            ))}
          </div>
        )}
      </Section>

      {/* ── IV 相容性（矩陣，預設摺疊；有不相容自動展開） ── */}
      <Section
        title={t('workstation.assess.panel.ivCompatibility')}
        icon={<Droplets className={`h-4 w-4 ${incompatibleCount > 0 ? 'text-red-600' : ivEligibleDrugs.length > 0 ? 'text-green-600' : 'text-muted-foreground'}`} />}
        count={
          ivEligibleDrugs.length === 0
            ? t('workstation.assess.panel.noIvPair')
            : incompatibleCount > 0
              ? t('workstation.assess.panel.ivWithIncompat', { drugs: ivEligibleDrugs.length, pairs: incompatibleCount })
              : t('workstation.assess.panel.ivDrugCount', { count: ivEligibleDrugs.length })
        }
        countColor={
          ivEligibleDrugs.length === 0
            ? 'border-slate-300 text-muted-foreground'
            : incompatibleCount > 0
              ? 'border-red-300 text-red-700'
              : 'border-green-300 text-green-700'
        }
        defaultOpen={incompatibleCount > 0}
      >
        {ivEligibleDrugs.length === 0 ? (
          <div className="flex items-start gap-2 text-muted-foreground py-2">
            <Droplets className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-sm leading-relaxed">
              {t('workstation.assess.panel.noIvY')}
              <span className="block text-xs mt-0.5">
                {t('workstation.assess.panel.noIvYHint')}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <CompatibilityMatrixLegend />
            <CompatibilityMatrix drugs={ivEligibleDrugs} lookupCell={lookupCompatCell} />

            {/* 不相容詳情卡片 */}
            {incompatibleCount > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">{t('workstation.assess.panel.incompatList')}</p>
                {deduplicatedCompat.filter(c => !c.compatible).map((c, idx) => (
                  <CompatibilityRow key={`incompat-${idx}`} c={c} />
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── PAD 劑量（獨立可展開） ── */}
      {dosage.length > 0 && (
        <Section
          title={t('workstation.assess.panel.padTitle')}
          icon={<Calculator className="h-4 w-4 text-brand" />}
          count={`${calculatedCount} / ${dosage.length}`}
          countColor="border-brand/30 text-brand"
          defaultOpen={calculatedCount > 0}
        >
          <p className="text-xs text-muted-foreground mb-3">{t('workstation.assess.panel.padHint')}</p>
          <div className="space-y-3">
            {dosage.filter(d => d.status === 'calculated').map((d, idx) => (
              <DosageRecommendationCard
                key={`${d.drugName}-${idx}`}
                dose={d}
                showAdjustmentBadge={typeof extendedData?.egfr === 'number' && extendedData.egfr < 60}
              />
            ))}
            {dosage.filter(d => d.status !== 'calculated').map((d, idx) => (
              <div key={`fail-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="font-medium">{d.drugName}</span>
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">{d.status === 'requires_input' ? t('workstation.assess.panel.requiresInput') : t('workstation.assess.panel.calcFailed')}</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
