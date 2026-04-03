import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Separator } from '../../../components/ui/separator';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Droplets,
  Calculator,
  User,
  ShieldAlert,
} from 'lucide-react';
import type { AssessmentResults, ExpandedSections, ExtendedPatientData } from './types';

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

const RISK_BADGE: Record<string, { className: string; label: string }> = {
  X: { className: 'bg-red-700 text-white', label: 'X 避免併用' },
  D: { className: 'bg-[#f59e0b] text-white', label: 'D 考慮調整' },
};

/** Try to show actual drug names from dependencies instead of class names */
function formatDrugPair(int: { drugA: string; drugB: string; dependencies?: string[] }): string {
  const a = int.drugA;
  const b = int.drugB;
  // If dependencies has exactly 2 entries, use them as actual drug names
  if (int.dependencies && int.dependencies.length === 2) {
    return `${int.dependencies[0]} + ${int.dependencies[1]}`;
  }
  return `${a} + ${b}`;
}

export function AssessmentResultsPanel({
  selectedPatient,
  assessmentResults,
  drugList,
}: AssessmentResultsPanelProps) {

  // ── 未選病患 ──
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

  // ── 尚未評估 ──
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

  // ── 評估結果計算 ──
  const { interactions, compatibility, dosage, compatibilitySummary } = assessmentResults;

  // 交互作用統計
  const riskCounts: Record<string, number> = {};
  interactions.forEach(i => {
    const r = i.riskRating || '';
    if (r) riskCounts[r] = (riskCounts[r] || 0) + 1;
  });
  const highRiskCount = (riskCounts['X'] || 0) + (riskCounts['D'] || 0);
  const highRiskInteractions = interactions.filter(i => i.riskRating === 'X' || i.riskRating === 'D');

  // 相容性統計 — deduplicate by drugA+drugB pair
  const incompatiblePairs = (() => {
    const seen = new Set<string>();
    return compatibility.filter(c => {
      if (c.compatible) return false;
      const key = [c.drugA, c.drugB].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  // 劑量統計
  const calculatedCount = dosage.filter(d => d.status === 'calculated').length;

  // 是否有任何需注意事項
  const hasAlerts = highRiskInteractions.length > 0 || incompatiblePairs.length > 0;

  return (
    <div className="lg:col-span-3 space-y-4">
      {/* ── 評估摘要 ── */}
      <Card className="border-[var(--color-brand)] border-2">
        <CardHeader className="bg-[var(--color-brand)] text-white py-3">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            評估摘要
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {/* 三欄指標 */}
          <div className="grid grid-cols-3 gap-3">
            {/* 交互作用 — Fix #2: show total with D/X breakdown */}
            <div className="rounded-lg border p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <AlertTriangle className={`h-5 w-5 ${interactions.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-sm font-semibold">交互作用</span>
              </div>
              {interactions.length === 0 ? (
                <p className="text-2xl font-bold text-green-600">無</p>
              ) : (
                <>
                  <p className="text-2xl font-bold">{interactions.length} <span className="text-sm font-normal">項</span></p>
                  {highRiskCount > 0 ? (
                    <div className="flex justify-center gap-1.5 mt-2">
                      {(['X', 'D'] as const).map(r => {
                        const c = riskCounts[r];
                        if (!c) return null;
                        const cfg = RISK_BADGE[r];
                        return <Badge key={r} className={`${cfg.className} text-xs px-2 py-0.5`}>{r}×{c}</Badge>;
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">無高風險（X/D）</p>
                  )}
                </>
              )}
            </div>

            {/* 相容性 — Fix #3: numbers now count by pair, not row */}
            <div className="rounded-lg border p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Droplets className={`h-5 w-5 ${incompatiblePairs.length > 0 ? 'text-[#f59e0b]' : 'text-green-600'}`} />
                <span className="text-sm font-semibold">相容性</span>
              </div>
              {compatibilitySummary ? (
                <>
                  <div className="flex justify-center gap-3 text-base font-bold">
                    <span className="text-green-600">✓ {compatibilitySummary.compatible}</span>
                    <span className="text-red-600">✗ {compatibilitySummary.incompatible}</span>
                    {compatibilitySummary.noData > 0 && (
                      <span className="text-gray-400">? {compatibilitySummary.noData}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {compatibilitySummary.pairsChecked} 組中 {compatibilitySummary.compatible + compatibilitySummary.incompatible} 組有資料
                  </p>
                </>
              ) : (
                <p className="text-2xl font-bold text-muted-foreground">—</p>
              )}
            </div>

            {/* PAD 劑量 */}
            <div className="rounded-lg border p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Calculator className="h-5 w-5 text-[var(--color-brand)]" />
                <span className="text-sm font-semibold">PAD 劑量</span>
              </div>
              {dosage.length === 0 ? (
                <p className="text-base font-bold text-muted-foreground">無 PAD 藥物</p>
              ) : calculatedCount > 0 ? (
                <>
                  <p className="text-2xl font-bold text-[var(--color-brand)]">{calculatedCount} <span className="text-sm font-normal">已算</span></p>
                  <p className="text-xs text-muted-foreground mt-1">共 {dosage.length} 項 PAD 藥物</p>
                </>
              ) : (
                <>
                  <p className="text-base font-bold text-muted-foreground">{dosage.length} 項</p>
                  <p className="text-xs text-muted-foreground mt-1">計算失敗</p>
                </>
              )}
            </div>
          </div>

          {/* ── 需注意事項 — Fix #4: show actual drug names ── */}
          {hasAlerts && (
            <>
              <Separator />
              <div>
                <p className="text-base font-semibold flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-[#f59e0b]" />
                  需注意事項
                </p>
                <div className="space-y-2">
                  {highRiskInteractions.map((int, idx) => {
                    const cfg = int.riskRating ? RISK_BADGE[int.riskRating] : null;
                    return (
                      <div key={`int-${idx}`} className="flex items-start gap-2.5 text-base py-2 px-3 rounded bg-slate-50 border">
                        {cfg && <Badge className={`${cfg.className} text-xs px-2 py-0.5 shrink-0 mt-0.5`}>{cfg.label}</Badge>}
                        <div className="min-w-0">
                          <span className="font-semibold">{formatDrugPair(int)}</span>
                          {int.management && (
                            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{int.management}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {incompatiblePairs.map((c, idx) => (
                    <div key={`compat-${idx}`} className="flex items-center gap-2.5 text-base py-2 px-3 rounded bg-red-50 border border-red-200">
                      <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                      <span className="font-semibold">{c.drugA} + {c.drugB}</span>
                      <Badge variant="destructive" className="text-xs px-2 py-0.5">不相容</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── 無警示 ── */}
          {!hasAlerts && (
            <>
              <Separator />
              <div className="flex items-center gap-2.5 text-base text-green-700 py-2">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">未發現高風險交互作用或不相容組合</span>
              </div>
            </>
          )}

          {/* ── PAD 劑量換算 — Fix #1: show target dose alongside rate ── */}
          {dosage.length > 0 && dosage.some(d => d.status === 'calculated') && (
            <>
              <Separator />
              <div>
                <p className="text-base font-semibold flex items-center gap-2 mb-1">
                  <Calculator className="h-5 w-5 text-[var(--color-brand)]" />
                  PAD 劑量換算
                </p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">以劑量範圍中值估算，實際劑量請依臨床調整</p>
                <div className="space-y-2">
                  {dosage.filter(d => d.status === 'calculated').map((d, idx) => (
                    <div key={idx} className="flex items-center justify-between text-base py-2 px-3 rounded bg-[#fdf6fa] border border-[#ead7e1]">
                      <div>
                        <span className="font-semibold">{d.drugName}</span>
                        {d.normalDose && d.normalDose !== '—' && (
                          <span className="text-sm text-muted-foreground ml-2">({d.normalDose})</span>
                        )}
                      </div>
                      <span className="font-bold text-lg text-[var(--color-brand)]">{d.calculatedRate || d.adjustedDose}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
