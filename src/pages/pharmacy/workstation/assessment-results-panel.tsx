import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Separator } from '../../../components/ui/separator';
import { Textarea } from '../../../components/ui/textarea';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Droplets,
  Calculator,
  Lightbulb,
  User,
  ChevronDown,
  ChevronUp,
  Check,
  Edit3,
  BarChart3,
  FileText,
  BookOpen,
  ExternalLink,
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

// Risk Rating 配色
const RISK_RATING_CONFIG: Record<string, { label: string; className: string; description: string }> = {
  X: { label: 'X', className: 'bg-red-700 text-white', description: '避免合用' },
  D: { label: 'D', className: 'bg-[#f59e0b] text-white', description: '考慮調整' },
  C: { label: 'C', className: 'bg-yellow-500 text-white', description: '監測治療' },
  B: { label: 'B', className: 'bg-gray-400 text-white', description: '無需調整' },
  A: { label: 'A', className: 'bg-green-600 text-white', description: '無交互作用' },
};

const SEVERITY_CONFIG: Record<string, { label: string; className: string }> = {
  high: { label: '高風險', className: 'bg-red-600 text-white' },
  medium: { label: '中風險', className: 'bg-[#f59e0b] text-white' },
  low: { label: '低風險', className: 'bg-gray-400 text-white' },
};

export function AssessmentResultsPanel({
  selectedPatient,
  assessmentResults,
  drugList,
  expandedSections,
  toggleSection,
  extendedData,
  adviceContent,
  onAdviceContentChange,
  onGoToStatistics,
  onGenerateAdvice,
  onSaveAdvice,
}: AssessmentResultsPanelProps) {
  const navigate = useNavigate();
  // Track which interaction items are expanded for detail
  const [expandedInteractions, setExpandedInteractions] = useState<Set<number>>(new Set());

  const toggleInteraction = (idx: number) => {
    setExpandedInteractions(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
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
              <div>
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
          {/* ── 1. 藥物交互作用 ── */}
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
                    <Badge variant="outline" className="text-xs">無異常</Badge>
                  )}
                  {/* Risk Rating 分佈 badges */}
                  {assessmentResults.interactions.length > 0 && (() => {
                    const counts: Record<string, number> = {};
                    assessmentResults.interactions.forEach(i => {
                      const r = i.riskRating || '';
                      if (r) counts[r] = (counts[r] || 0) + 1;
                    });
                    return Object.entries(counts)
                      .sort(([a], [b]) => 'XDCBA'.indexOf(a) - 'XDCBA'.indexOf(b))
                      .map(([rating, count]) => {
                        const cfg = RISK_RATING_CONFIG[rating];
                        return cfg ? (
                          <Badge key={rating} className={`${cfg.className} text-xs`}>
                            {rating}×{count}
                          </Badge>
                        ) : null;
                      });
                  })()}
                </div>
                {expandedSections.interactions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.interactions && (
              <CardContent className="space-y-2 pt-3">
                {assessmentResults.interactions.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>未發現藥物交互作用</span>
                  </div>
                ) : (
                  assessmentResults.interactions.map((interaction, idx) => {
                    const riskCfg = interaction.riskRating ? RISK_RATING_CONFIG[interaction.riskRating] : null;
                    const sevCfg = SEVERITY_CONFIG[interaction.severity] || SEVERITY_CONFIG.low;
                    const isExpanded = expandedInteractions.has(idx);

                    return (
                      <div key={idx} className="border rounded-lg bg-[#f8f9fa]">
                        {/* Summary row — always visible */}
                        <div
                          className="flex items-center gap-2 p-3 cursor-pointer"
                          onClick={() => toggleInteraction(idx)}
                        >
                          {riskCfg ? (
                            <Badge className={`${riskCfg.className} text-xs font-bold min-w-[28px] justify-center`}>
                              {interaction.riskRating}
                            </Badge>
                          ) : (
                            <Badge className={`${sevCfg.className} text-xs`}>{sevCfg.label}</Badge>
                          )}
                          <p className="font-semibold text-sm flex-1">
                            {interaction.drugA} + {interaction.drugB}
                          </p>
                          <span className="text-xs text-muted-foreground max-w-[200px] truncate hidden sm:inline">
                            {interaction.clinicalEffect || interaction.description}
                          </span>
                          {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                        </div>

                        {/* Detail — collapsed by default */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t">
                            {riskCfg && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-muted-foreground">Risk Rating:</span>
                                <Badge className={`${riskCfg.className} text-xs`}>
                                  {interaction.riskRating} — {riskCfg.description}
                                </Badge>
                                {interaction.riskRatingDescription && (
                                  <span className="text-xs text-muted-foreground">{interaction.riskRatingDescription}</span>
                                )}
                              </div>
                            )}
                            {interaction.clinicalEffect && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">臨床影響</p>
                                <p className="text-sm">{interaction.clinicalEffect}</p>
                              </div>
                            )}
                            {interaction.mechanism && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">機轉說明</p>
                                <p className="text-sm">{interaction.mechanism}</p>
                              </div>
                            )}
                            {interaction.management && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">處理建議</p>
                                <p className="text-sm">{interaction.management}</p>
                              </div>
                            )}
                            {interaction.routeDependency && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">給藥途徑相關</p>
                                <p className="text-sm">{interaction.routeDependency}</p>
                              </div>
                            )}
                            {interaction.discussion && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">討論</p>
                                <p className="text-sm text-muted-foreground">{interaction.discussion}</p>
                              </div>
                            )}
                            {interaction.pubmedIds && interaction.pubmedIds.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                <BookOpen className="h-3 w-3 text-[#7f265b]" />
                                <span className="text-xs text-[#7f265b] font-medium">PubMed:</span>
                                {interaction.pubmedIds.map(id => (
                                  <a
                                    key={id}
                                    href={`https://pubmed.ncbi.nlm.nih.gov/${id}/`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {id}
                                  </a>
                                ))}
                              </div>
                            )}
                            {interaction.references && !interaction.pubmedIds?.length && (
                              <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                                <div className="flex items-center gap-1 mb-1">
                                  <BookOpen className="h-3 w-3 text-[#7f265b]" />
                                  <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                                </div>
                                <p className="text-xs text-muted-foreground">{interaction.references}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {/* Link to full interactions page */}
                {assessmentResults.interactions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-[#7f265b] hover:text-[#631e4d]"
                    onClick={() => navigate('/pharmacy/interactions')}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    查看完整交互作用分析 →
                  </Button>
                )}
              </CardContent>
            )}
          </Card>

          {/* ── 2. 靜脈注射相容性 ── */}
          <Card className={assessmentResults.compatibility.some(c => !c.compatible) ? 'border-l-4 border-l-[#f59e0b]' : 'border-l-4 border-l-[#7f265b]'}>
            <CardHeader
              className="cursor-pointer bg-[#f8f9fa] py-3"
              onClick={() => toggleSection('compatibility')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Droplets className={`h-5 w-5 ${assessmentResults.compatibility.some(c => !c.compatible) ? 'text-[#f59e0b]' : 'text-[#7f265b]'}`} />
                  <CardTitle className="text-base">靜脈注射相容性</CardTitle>
                  {assessmentResults.compatibilitySummary && (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-xs border-green-400 text-green-700">
                        ✓ {assessmentResults.compatibilitySummary.compatible}
                      </Badge>
                      <Badge variant="outline" className="text-xs border-red-400 text-red-700">
                        ✗ {assessmentResults.compatibilitySummary.incompatible}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        — {assessmentResults.compatibilitySummary.noData}
                      </Badge>
                    </div>
                  )}
                </div>
                {expandedSections.compatibility ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.compatibility && (
              <CardContent className="space-y-2.5 pt-3">
                {assessmentResults.compatibilitySummary && (
                  <p className="text-xs text-muted-foreground">
                    已檢查 {assessmentResults.compatibilitySummary.pairsChecked} 組藥對：
                    {assessmentResults.compatibilitySummary.compatible} 相容、
                    {assessmentResults.compatibilitySummary.incompatible} 不相容、
                    {assessmentResults.compatibilitySummary.noData} 無資料
                  </p>
                )}
                {assessmentResults.compatibility.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>無相容性資料或所有組合皆相容</span>
                  </div>
                ) : (
                  <>
                    {/* Only show incompatible pairs prominently */}
                    {assessmentResults.compatibility.filter(c => !c.compatible).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-red-700">不相容組合：</p>
                        {assessmentResults.compatibility.filter(c => !c.compatible).map((comp, idx) => (
                          <div key={`incompat-${idx}`} className="border rounded-lg p-3 space-y-2 bg-red-50/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-[#f59e0b]" />
                                <p className="font-semibold text-sm">
                                  {comp.drugA} + {comp.drugB}
                                </p>
                              </div>
                              <Badge className="bg-[#f59e0b]">不相容</Badge>
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
                            {comp.notes && (
                              <p className="text-xs text-muted-foreground">{comp.notes}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Compatible pairs in a compact list */}
                    {assessmentResults.compatibility.filter(c => c.compatible).length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-muted-foreground flex items-center gap-1">
                          <span className="group-open:rotate-90 transition-transform">▶</span>
                          相容組合（{assessmentResults.compatibility.filter(c => c.compatible).length} 組）
                        </summary>
                        <div className="mt-2 space-y-1">
                          {assessmentResults.compatibility.filter(c => c.compatible).map((comp, idx) => (
                            <div key={`compat-${idx}`} className="flex items-center gap-2 text-xs py-1 px-2 bg-green-50 rounded">
                              <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                              <span>{comp.drugA} + {comp.drugB}</span>
                              <span className="text-muted-foreground">({comp.solution})</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
                {/* Link to full compatibility page */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-[#7f265b] hover:text-[#631e4d]"
                  onClick={() => navigate('/pharmacy/compatibility')}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  查看完整相容性矩陣 →
                </Button>
              </CardContent>
            )}
          </Card>

          {/* ── 3. 劑量調整建議（僅 PAD 支援藥物） ── */}
          <Card className="border-l-4 border-l-[#7f265b]">
            <CardHeader
              className="cursor-pointer bg-[#f8f9fa] py-3"
              onClick={() => toggleSection('dosage')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-[#7f265b]" />
                  <CardTitle className="text-base">劑量調整建議</CardTitle>
                  {assessmentResults.dosage.length > 0 ? (
                    <>
                      <Badge variant="secondary" className="text-xs">
                        PAD {assessmentResults.dosage.length} 項
                      </Badge>
                      {assessmentResults.dosage.filter(d => d.status === 'calculated').length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          已換算 {assessmentResults.dosage.filter(d => d.status === 'calculated').length}
                        </Badge>
                      )}
                      {assessmentResults.dosage.filter(d => d.status === 'requires_input').length > 0 && (
                        <Badge variant="outline" className="border-[#f59e0b] text-xs text-[#f59e0b]">
                          待補 {assessmentResults.dosage.filter(d => d.status === 'requires_input').length}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs">無 PAD 藥物</Badge>
                  )}
                </div>
                {expandedSections.dosage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.dosage && (
              <CardContent className="space-y-2.5 pt-3">
                {assessmentResults.dosage.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>目前用藥中無 PAD 支援藥物，無需劑量調整計算</span>
                  </div>
                ) : (
                  assessmentResults.dosage.map((dose, idx) => {
                    const statusCfg = {
                      calculated: { label: '已計算', className: 'bg-[#7f265b] text-white' },
                      requires_input: { label: '待補資料', className: 'bg-[#f59e0b] text-white' },
                      service_unavailable: { label: '服務異常', className: 'bg-red-600 text-white' },
                    }[dose.status] || { label: '—', className: 'bg-gray-400 text-white' };

                    return (
                      <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm">{dose.drugName}</p>
                            <Badge className={statusCfg.className}>{statusCfg.label}</Badge>
                            {typeof extendedData?.egfr === 'number' && extendedData.egfr < 60 && (
                              <Badge variant="outline" className="text-xs border-[#f59e0b] text-[#f59e0b]">
                                需調整
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-lg border bg-white px-3 py-2">
                            <p className="text-muted-foreground text-[11px]">{dose.targetDoseTitle || '標準劑量'}</p>
                            <p className="font-medium mt-0.5">{dose.targetDose || dose.normalDose}</p>
                          </div>
                          <div className="rounded-lg border border-[#ead7e1] bg-[#fdf6fa] px-3 py-2">
                            <p className="text-muted-foreground text-[11px]">{dose.calculatedRateTitle || '建議劑量'}</p>
                            <p className="font-semibold text-[#7f265b] mt-0.5">{dose.calculatedRate || dose.adjustedDose}</p>
                          </div>
                        </div>
                        {dose.clinicalSummary && (
                          <p className="text-sm text-slate-700">{dose.clinicalSummary}</p>
                        )}
                        {dose.calculationSteps && dose.calculationSteps.length > 0 && (
                          <details className="group">
                            <summary className="cursor-pointer text-xs text-[#7f265b] flex items-center gap-1">
                              <span className="group-open:rotate-90 transition-transform">▶</span>
                              計算步驟（{dose.calculationSteps.length} 步）
                            </summary>
                            <ol className="mt-1.5 list-decimal list-inside space-y-0.5 text-xs text-muted-foreground pl-2">
                              {dose.calculationSteps.map((step, sIdx) => (
                                <li key={sIdx}>{step}</li>
                              ))}
                            </ol>
                          </details>
                        )}
                        {dose.warnings && dose.warnings.length > 0 && (
                          <div className="flex items-start gap-1.5 text-xs text-[#f59e0b]">
                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>{dose.warnings.join('；')}</span>
                          </div>
                        )}
                        {dose.hepaticWarning && (
                          <p className="text-xs text-muted-foreground">{dose.hepaticWarning}</p>
                        )}
                      </div>
                    );
                  })
                )}
                <p className="text-[11px] text-muted-foreground">
                  劑量計算僅適用於 PAD 支援的 ICU 藥物（如 Dexmedetomidine、Fentanyl、Midazolam 等），其他藥物請至劑量計算頁面操作。
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-[#7f265b] hover:text-[#631e4d]"
                  onClick={() => navigate('/pharmacy/dosage')}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  查看完整劑量計算與建議 →
                </Button>
              </CardContent>
            )}
          </Card>

          {/* ── 4. 用藥建議 ── */}
          <Card className="border-l-4 border-l-[#7f265b]">
            <CardHeader className="bg-[#f8f9fa] py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-[#7f265b]" />
                  <CardTitle className="text-base">用藥建議</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={onGoToStatistics}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    <BarChart3 className="mr-1 h-3 w-3" />
                    統計
                  </Button>
                  <Button
                    onClick={onGenerateAdvice}
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
                  onChange={(e) => onAdviceContentChange(e.target.value)}
                  placeholder="點擊「產生報告」自動產生完整建議，或手動輸入..."
                  className="min-h-[180px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={onSaveAdvice}
                  disabled={!adviceContent.trim()}
                  className="bg-[#7f265b] hover:bg-[#631e4d]"
                >
                  <Check className="mr-1 h-4 w-4" />
                  接受並送出
                </Button>
                <Button
                  onClick={() => {
                    // no-op: user edits textarea directly
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
  );
}
