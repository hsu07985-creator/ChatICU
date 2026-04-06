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
  User,
  ShieldAlert,
} from 'lucide-react';
import type { AssessmentResults, ExpandedSections, ExtendedPatientData, DrugInteraction, IVCompatibility } from './types';
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
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
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
        <p className="text-xs text-slate-600 leading-relaxed">{int.clinicalEffect}</p>
      )}
      {int.management && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-slate-700">處置：</span>
          {int.management.length > 120 && !expanded
            ? <>{int.management.slice(0, 120)}… <button type="button" onClick={() => setExpanded(true)} className="text-brand hover:underline">展開</button></>
            : int.management
          }
        </p>
      )}
      {expanded && (
        <>
          {int.mechanism && (
            <p className="text-xs text-muted-foreground"><span className="font-medium text-slate-700">機轉：</span>{int.mechanism}</p>
          )}
          {int.discussion && (
            <p className="text-xs text-muted-foreground leading-relaxed"><span className="font-medium text-slate-700">說明：</span>{int.discussion}</p>
          )}
          <button type="button" onClick={() => setExpanded(false)} className="text-xs text-brand hover:underline">收合</button>
        </>
      )}
    </div>
  );
}

/** Single compatibility row */
function CompatibilityRow({ c }: { c: IVCompatibility }) {
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${c.compatible ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
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
        <Card>
          <CardContent className="py-16">
            <div className="text-center space-y-3">
              <h3 className="font-semibold text-lg">準備執行評估</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                目前已載入 {drugList.length} 項藥品，點擊「執行全面評估」開始分析
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { interactions, compatibility, dosage, compatibilitySummary } = assessmentResults;

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
          <CardTitle className="text-white text-base flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            評估摘要
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-3 gap-3">
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
                  <div className="flex justify-center gap-2 text-sm font-bold">
                    <span className="text-green-600">✓{compatibilitySummary.compatible}</span>
                    <span className="text-red-600">✗{compatibilitySummary.incompatible}</span>
                    {compatibilitySummary.noData > 0 && <span className="text-gray-400">?{compatibilitySummary.noData}</span>}
                    {compatibilitySummary.queryFailed > 0 && <span className="text-amber-500">⚠{compatibilitySummary.queryFailed}</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {compatibilitySummary.pairsChecked} 組
                    {compatibilitySummary.queryFailed > 0 && `・${compatibilitySummary.queryFailed} 失敗`}
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
              <div key={`fail-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-sm">
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
