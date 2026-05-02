import { useState } from 'react';
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
  Sparkles,
  User,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ButtonLoadingIndicator } from '../../../components/ui/button-loading-indicator';
import type { AssessmentResults, ExpandedSections, ExtendedPatientData, DrugInteraction, IVCompatibility } from './types';
import type { DuplicateAlert } from '../../../lib/api/medications';
import { DosageRecommendationCard } from './dosage-recommendation-card';

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

const RISK_BADGE: Record<string, { className: string; label: string; short: string }> = {
  X: { className: 'bg-red-700 text-white', label: 'X 避免併用', short: 'X' },
  D: { className: 'bg-[#f59e0b] text-white', label: 'D 考慮調整', short: 'D' },
  C: { className: 'bg-blue-600 text-white', label: 'C 監測', short: 'C' },
  B: { className: 'bg-slate-500 text-white', label: 'B 無需調整', short: 'B' },
  A: { className: 'bg-green-600 text-white', label: 'A 無交互', short: 'A' },
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
/** Map severity to risk rating when riskRating is missing (local DB fallback data) */
const SEVERITY_TO_RISK: Record<string, string> = { high: 'D', medium: 'C', low: 'B' };

function InteractionRow({ int }: { int: DrugInteraction }) {
  const [expanded, setExpanded] = useState(false);
  const effectiveRisk = int.riskRating || SEVERITY_TO_RISK[int.severity] || 'C';
  const riskCfg = RISK_BADGE[effectiveRisk];

  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center flex-wrap gap-2">
        {riskCfg && <Badge className={`${riskCfg.className} text-xs px-2 py-0.5`}>{riskCfg.label}</Badge>}
        <span className="font-semibold text-sm">{formatDrugPair(int)}</span>
      </div>
      {int.clinicalEffect && (
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{int.clinicalEffect}</p>
      )}
      {int.management && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-slate-700 dark:text-slate-300">處置：</span>
          {int.management.length > 120 && !expanded
            ? <>{int.management.slice(0, 120)}… <button type="button" onClick={() => setExpanded(true)} className="text-brand hover:underline">展開</button></>
            : int.management
          }
        </p>
      )}
      {expanded && (
        <>
          {int.mechanism && (
            <p className="text-xs text-muted-foreground"><span className="font-medium text-slate-700 dark:text-slate-300">機轉：</span>{int.mechanism}</p>
          )}
          {int.discussion && (
            <p className="text-xs text-muted-foreground leading-relaxed"><span className="font-medium text-slate-700 dark:text-slate-300">說明：</span>{int.discussion}</p>
          )}
          <button type="button" onClick={() => setExpanded(false)} className="text-xs text-brand hover:underline">收合</button>
        </>
      )}
    </div>
  );
}

const DUP_LEVEL_BADGE: Record<DuplicateAlert['level'], { className: string; label: string }> = {
  critical: { className: 'bg-red-700 text-white', label: '嚴重' },
  high:     { className: 'bg-[#f59e0b] text-white', label: '高' },
  moderate: { className: 'bg-amber-200 text-amber-900', label: '中' },
  low:      { className: 'bg-blue-100 text-blue-700', label: '低' },
  info:     { className: 'bg-slate-200 text-slate-700', label: '提示' },
};

function DuplicateRow({ d }: { d: DuplicateAlert }) {
  const cfg = DUP_LEVEL_BADGE[d.level];
  const drugNames = d.members.map(m => m.genericName).join(' + ');
  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center flex-wrap gap-2">
        <Badge className={`${cfg.className} text-xs px-2 py-0.5`}>{cfg.label}</Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{d.layer}</Badge>
        <span className="font-semibold text-sm">{drugNames}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{d.mechanism}</p>
      {d.recommendation && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-slate-700 dark:text-slate-300">建議：</span>
          {d.recommendation}
        </p>
      )}
      {d.autoDowngraded && d.downgradeReason && (
        <p className="text-[11px] text-amber-600 leading-relaxed">已自動降階：{d.downgradeReason}</p>
      )}
    </div>
  );
}

/** Single compatibility row */
function CompatibilityRow({ c }: { c: IVCompatibility }) {
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
          {c.compatible ? '相容' : '不相容'}
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

  if (!selectedPatient) {
    return (
      <div className="lg:col-span-3">
        <Card>
          <CardContent className="py-16">
            <div className="text-center space-y-3">
              <User className="h-12 w-12 mx-auto text-muted-foreground" />
              <h3 className="font-semibold text-lg">請先選擇病患</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">選擇病患後即可管理用藥並執行評估</p>
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
                <h3 className="font-semibold text-lg">準備執行評估</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  目前已載入 {drugList.length} 項藥品
                </p>
              </div>
              <Button
                onClick={onRunAssessment}
                disabled={!assessReady}
                className="h-14 px-10 text-lg font-semibold bg-brand hover:bg-brand-hover shadow-lg"
                size="lg"
              >
                {isAssessing ? null : <Sparkles className="h-5 w-5" />}
                <span>{isAssessing ? '處理中' : '執行全面評估'}</span>
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
              評估摘要
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRunAssessment}
              disabled={!assessReady}
              className="h-8 px-2 text-white hover:bg-white/15 hover:text-white"
              aria-label="重新評估"
            >
              {isAssessing ? <ButtonLoadingIndicator /> : <RotateCw className="h-4 w-4" />}
              <span className="text-xs ml-1">{isAssessing ? '處理中' : '重新評估'}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 重複用藥 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Copy className={`h-4 w-4 ${(duplicateSummary.critical + duplicateSummary.high) > 0 ? 'text-red-600' : duplicateSummary.total > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-xs font-semibold">重複用藥</span>
              </div>
              {duplicateSummary.queryFailed ? (
                <p className="text-sm font-bold text-amber-600">查詢失敗</p>
              ) : duplicateSummary.total === 0 ? (
                <p className="text-xl font-bold text-green-600">無</p>
              ) : (
                <>
                  <p className="text-xl font-bold">{duplicateSummary.total} <span className="text-xs font-normal">項</span></p>
                  <div className="flex justify-center gap-1 mt-1 flex-wrap">
                    {duplicateSummary.critical > 0 && <Badge className="bg-red-700 text-white text-[10px] px-1.5 py-0">嚴重×{duplicateSummary.critical}</Badge>}
                    {duplicateSummary.high > 0 && <Badge className="bg-[#f59e0b] text-white text-[10px] px-1.5 py-0">高×{duplicateSummary.high}</Badge>}
                    {duplicateSummary.moderate > 0 && <Badge className="bg-amber-200 text-amber-900 text-[10px] px-1.5 py-0">中×{duplicateSummary.moderate}</Badge>}
                    {duplicateSummary.low > 0 && <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0">低×{duplicateSummary.low}</Badge>}
                  </div>
                </>
              )}
            </div>

            {/* 交互作用 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <AlertTriangle className={`h-4 w-4 ${interactions.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-xs font-semibold">交互作用</span>
              </div>
              {interactions.length === 0 ? (
                <p className="text-xl font-bold text-green-600">無</p>
              ) : (
                <>
                  <p className="text-xl font-bold">{interactions.length} <span className="text-xs font-normal">項</span></p>
                  {highRiskCount > 0 && (
                    <div className="flex justify-center gap-1 mt-1">
                      {(['X', 'D'] as const).map(r => {
                        const c = riskCounts[r];
                        if (!c) return null;
                        return <Badge key={r} className={`${RISK_BADGE[r].className} text-[10px] px-1.5 py-0`}>{r}×{c}</Badge>;
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 相容性 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Droplets className={`h-4 w-4 ${incompatibleCount > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-xs font-semibold">相容性</span>
              </div>
              {compatibilitySummary ? (
                <>
                  <p className="text-xl font-bold">
                    {compatibilitySummary.incompatible > 0 ? (
                      <span className="text-red-600">{compatibilitySummary.incompatible} <span className="text-xs font-normal">組不相容</span></span>
                    ) : (
                      <span className="text-green-600">全部相容</span>
                    )}
                  </p>
                  <div className="flex justify-center gap-3 mt-1.5 text-[11px]">
                    <span className="text-green-600">相容 {compatibilitySummary.compatible}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="text-red-600 dark:text-red-400">不相容 {compatibilitySummary.incompatible}</span>
                    {compatibilitySummary.noData > 0 && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="text-gray-400 dark:text-gray-500">無資料 {compatibilitySummary.noData}</span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    共 {compatibilitySummary.pairsChecked} 組檢查
                    {compatibilitySummary.queryFailed > 0 && (
                      <span className="text-amber-500 ml-1">（{compatibilitySummary.queryFailed} 組查詢失敗）</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-xl font-bold text-muted-foreground">—</p>
              )}
            </div>

            {/* PAD 劑量 */}
            <div className="rounded-lg border p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Calculator className="h-4 w-4 text-brand" />
                <span className="text-xs font-semibold">PAD 劑量</span>
              </div>
              {dosage.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">無 PAD 藥物</p>
              ) : (
                <p className="text-xl font-bold text-brand">{calculatedCount} <span className="text-xs font-normal">/ {dosage.length}</span></p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 重複用藥（獨立可展開） ── */}
      <Section
        title="重複用藥"
        icon={<Copy className={`h-4 w-4 ${(duplicateSummary.critical + duplicateSummary.high) > 0 ? 'text-red-600' : duplicateSummary.total > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />}
        count={duplicateSummary.queryFailed ? '查詢失敗' : duplicateSummary.total > 0 ? `${duplicateSummary.total} 項` : '無'}
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
            <span className="text-sm">重複用藥偵測查詢失敗，建議至「重複用藥」頁手動查詢</span>
          </div>
        ) : duplicates.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 py-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">未發現重複用藥</span>
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
        title="交互作用"
        icon={<AlertTriangle className={`h-4 w-4 ${highRiskCount > 0 ? 'text-red-600' : interactions.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />}
        count={interactions.length > 0 ? `${interactions.length} 項` : '無'}
        countColor={highRiskCount > 0 ? 'border-red-300 text-red-700' : interactions.length > 0 ? 'border-amber-300 text-amber-700' : 'border-green-300 text-green-700'}
        defaultOpen={highRiskCount > 0}
      >
        {interactions.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 py-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">未發現藥物交互作用</span>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedInteractions.map((int, idx) => (
              <InteractionRow key={`${int.id || idx}`} int={int} />
            ))}
          </div>
        )}
      </Section>

      {/* ── 相容性（獨立可展開） ── */}
      <Section
        title="IV 相容性"
        icon={<Droplets className={`h-4 w-4 ${incompatibleCount > 0 ? 'text-red-600' : 'text-green-600'}`} />}
        count={deduplicatedCompat.length > 0 ? `${compatibleCount}✓ ${incompatibleCount}✗` : '無資料'}
        countColor={incompatibleCount > 0 ? 'border-red-300 text-red-700' : 'border-green-300 text-green-700'}
        defaultOpen={incompatibleCount > 0}
      >
        {deduplicatedCompat.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <span className="text-sm">無相容性資料</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Incompatible first */}
            {deduplicatedCompat.filter(c => !c.compatible).map((c, idx) => (
              <CompatibilityRow key={`incompat-${idx}`} c={c} />
            ))}
            {deduplicatedCompat.filter(c => c.compatible).map((c, idx) => (
              <CompatibilityRow key={`compat-${idx}`} c={c} />
            ))}
          </div>
        )}
      </Section>

      {/* ── PAD 劑量（獨立可展開） ── */}
      {dosage.length > 0 && (
        <Section
          title="PAD 劑量換算"
          icon={<Calculator className="h-4 w-4 text-brand" />}
          count={`${calculatedCount} / ${dosage.length}`}
          countColor="border-brand/30 text-brand"
          defaultOpen={calculatedCount > 0}
        >
          <p className="text-xs text-muted-foreground mb-3">拖曳滑桿可即時調整最小/最大劑量與濃度</p>
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
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">{d.status === 'requires_input' ? '待補資料' : '計算失敗'}</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
