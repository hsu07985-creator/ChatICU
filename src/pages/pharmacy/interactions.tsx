import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2, ShieldAlert, Route } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { toast } from 'sonner';
import { checkInteractions, type InteractionCheckResponse } from '../../lib/api/ai';
import { getDrugInteractions } from '../../lib/api/pharmacy';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST } from '../../lib/drug-list';

interface InteractingMemberGroup {
  group_name: string;
  members: string[];
  exceptions: string[];
  exceptions_note: string;
}

interface DisplayInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
  riskRating: string;
  riskRatingDescription: string;
  severityLabel: string;
  reliabilityRating: string;
  routeDependency: string;
  discussion: string;
  footnotes: string;
  dependencies: string[];
  dependencyTypes: string[];
  interactingMembers: InteractingMemberGroup[];
  pubmedIds: string[];
}

const RISK_RATING_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  X: { label: 'Risk X 避免併用', color: 'text-red-900', bgColor: 'bg-red-100 border-red-300' },
  D: { label: 'Risk D 考慮調整', color: 'text-orange-900', bgColor: 'bg-orange-100 border-orange-300' },
  C: { label: 'Risk C 監測治療', color: 'text-yellow-900', bgColor: 'bg-yellow-100 border-yellow-300' },
  B: { label: 'Risk B 不需處置', color: 'text-green-900', bgColor: 'bg-green-100 border-green-300' },
  A: { label: 'Risk A 無交互作用', color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-300' },
};


export function DrugInteractionsPage() {
  const [drugA, setDrugA] = useState('');
  const [drugB, setDrugB] = useState('');
  const [searchResults, setSearchResults] = useState<DisplayInteraction[]>([]);
  const [overallSeverity, setOverallSeverity] = useState<string>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);


  const handleSearch = async () => {
    const drugs = [drugA.trim(), drugB.trim()].filter(Boolean);
    if (drugs.length < 2) {
      toast.error('請至少輸入兩種藥品名稱');
      return;
    }

    setLoading(true);
    setHasSearched(true);

    // Helper: query local DB for drug interactions
    const queryDatabase = async () => {
      const resp = await getDrugInteractions({ drugA: drugs[0], drugB: drugs[1] });
      const rows = resp.interactions || [];
      return rows.map((r: any, idx: number) => ({
        id: r.id || `db-int-${idx}`,
        drug1: r.drug1 || drugs[0],
        drug2: r.drug2 || drugs[1],
        severity: mapSeverity(r.severity || ''),
        mechanism: r.mechanism || '',
        clinicalEffect: r.clinicalEffect || '',
        management: r.management || '',
        references: r.references || '',
        riskRating: r.riskRating || '',
        riskRatingDescription: r.riskRatingDescription || '',
        severityLabel: r.severityLabel || '',
        reliabilityRating: r.reliabilityRating || '',
        routeDependency: r.routeDependency || '',
        discussion: r.discussion || '',
        footnotes: r.footnotes || '',
        dependencies: r.dependencies || [],
        dependencyTypes: r.dependencyTypes || [],
        interactingMembers: r.interactingMembers || [],
        pubmedIds: r.pubmedIds || [],
      } as DisplayInteraction));
    };

    try {
      const result: InteractionCheckResponse = await checkInteractions({ drugList: drugs }, { suppressErrorToast: true });
      const aiFindings = result.findings || [];

      if (aiFindings.length > 0) {
        setOverallSeverity(result.overall_severity || 'none');
        const mapped: DisplayInteraction[] = aiFindings.map((f, idx) => ({
          id: `int-${idx}`,
          drug1: f.drugA || f.drug_a || drugs[0],
          drug2: f.drugB || f.drug_b || drugs[1],
          severity: mapSeverity(f.severity),
          mechanism: f.mechanism || '',
          clinicalEffect: f.clinical_effect || '',
          management: f.recommended_action || '',
          references: f.dose_adjustment_hint || '',
          riskRating: f.risk_rating || '',
          riskRatingDescription: f.risk_rating_description || '',
          severityLabel: f.severity_label || '',
          reliabilityRating: f.reliability_rating || '',
          routeDependency: f.route_dependency || '',
          discussion: f.discussion || '',
          footnotes: f.footnotes || '',
          dependencies: f.dependencies || [],
          dependencyTypes: f.dependency_types || [],
          interactingMembers: f.interacting_members || [],
          pubmedIds: f.pubmed_ids || [],
        }));
        setSearchResults(mapped);
      } else {
        // AI returned no findings — fallback to DB
        const dbResults = await queryDatabase();
        if (dbResults.length) {
          const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
          const max = dbResults.reduce((acc: string, it: DisplayInteraction) => (rank[it.severity] > rank[acc] ? it.severity : acc), 'low');
          setOverallSeverity(max);
        } else {
          setOverallSeverity('none');
        }
        setSearchResults(dbResults);
      }
    } catch (err) {
      console.error('查詢交互作用失敗:', err);
      try {
        const dbResults = await queryDatabase();
        if (dbResults.length) {
          const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
          const max = dbResults.reduce((acc: string, it: DisplayInteraction) => (rank[it.severity] > rank[acc] ? it.severity : acc), 'low');
          setOverallSeverity(max);
        } else {
          setOverallSeverity('none');
        }
        setSearchResults(dbResults);
      } catch (fallbackErr) {
        console.error('DB fallback 查詢交互作用失敗:', fallbackErr);
        toast.error('查詢失敗，請確認後端服務是否正常運行');
        setSearchResults([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewReference = async (ref: string) => {
    const trimmed = String(ref || '').trim();
    if (!trimmed) {
      toast.message('此筆資料未提供文獻來源');
      return;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
      return;
    }
    const ok = await copyToClipboard(trimmed);
    if (ok) toast.success('已複製文獻來源到剪貼簿');
    else toast.message(`資料來源：${trimmed}`);
  };

  const mapSeverity = (s?: string): string => {
    if (!s) return 'low';
    const lower = s.toLowerCase();
    if (lower === 'contraindicated' || lower === 'major') return 'high';
    if (lower === 'moderate') return 'medium';
    return 'low';
  };

  const getRiskRatingBadge = (interaction: DisplayInteraction) => {
    const rr = interaction.riskRating;
    if (!rr) {
      // Fallback to old severity badge
      return getSeverityBadge(interaction.severity);
    }
    const config = RISK_RATING_CONFIG[rr];
    if (!config) return null;
    return (
      <Badge variant="outline" className={`gap-1 border ${config.bgColor} ${config.color} font-semibold`}>
        <ShieldAlert className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />高風險</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="gap-1 bg-orange-100 text-orange-800"><AlertCircle className="h-3 w-3" />中風險</Badge>;
      case 'low':
        return <Badge variant="outline" className="gap-1"><Info className="h-3 w-3" />低風險</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1>交互作用查詢</h1>
        <p className="text-muted-foreground mt-1">查詢藥物之間的交互作用與處理建議</p>
      </div>

      {/* 搜尋區 */}
      <Card>
        <CardHeader>
          <CardTitle>藥品選擇</CardTitle>
          <CardDescription>輸入至少兩種藥品名稱查詢交互作用</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 A *</label>
              <DrugCombobox
                value={drugA}
                onValueChange={setDrugA}
                placeholder="選擇藥品 A..."
                drugList={DRUG_LIST}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 B *</label>
              <DrugCombobox
                value={drugB}
                onValueChange={setDrugB}
                placeholder="選擇藥品 B..."
                drugList={DRUG_LIST}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              查詢
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDrugA('');
                setDrugB('');
                setSearchResults([]);
                setHasSearched(false);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              清除
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 查詢結果 */}
      {hasSearched && !loading && (
        <div className="space-y-4">
          {searchResults.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                {overallSeverity === 'none'
                  ? '未發現藥物交互作用。'
                  : '未找到相關的藥物交互作用資料。請確認藥品名稱是否正確。'}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2>查詢結果</h2>
                <span className="text-sm text-muted-foreground">
                  找到 {searchResults.length} 筆交互作用
                </span>
              </div>

              <div className="grid gap-4">
                {searchResults.map((interaction) => (
                  <Card key={interaction.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <CardTitle className="flex items-center gap-2">
                            {interaction.drug1} + {interaction.drug2}
                          </CardTitle>
                          <div className="flex flex-wrap items-center gap-2">
                            {getRiskRatingBadge(interaction)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="查看文獻來源"
                          onClick={() => handleViewReference(interaction.references)}
                        >
                          <BookOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* 給藥途徑警示 */}
                      {interaction.routeDependency && (
                        <Alert className="border-amber-300 bg-amber-50">
                          <Route className="h-4 w-4 text-amber-600" />
                          <AlertDescription className="text-amber-800">
                            <span className="font-medium">給藥途徑注意：</span>{interaction.routeDependency}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* 依賴條件 */}
                      {interaction.dependencies.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">依賴條件</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {interaction.dependencies.map((dep, i) => (
                              <Badge key={i} variant="outline" className="text-xs bg-slate-50">
                                {dep}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 交互作用藥物群組 */}
                      {interaction.interactingMembers.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">交互作用藥物群組</h4>
                          <div className="space-y-2">
                            {interaction.interactingMembers.map((group, i) => (
                              <div key={i} className="text-sm border rounded-md p-2.5 bg-muted/20">
                                <span className="font-medium text-foreground/90">{group.group_name}</span>
                                {group.members.length > 0 && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    成員：{group.members.join('、')}
                                  </p>
                                )}
                                {group.exceptions.length > 0 && (
                                  <p className="text-xs text-orange-600 mt-1">
                                    例外：{group.exceptions.join('、')}
                                    {group.exceptions_note && ` (${group.exceptions_note})`}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 交互作用說明 */}
                      {interaction.clinicalEffect && (
                        <div>
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">交互作用說明</h4>
                          <p className="text-sm">{interaction.clinicalEffect}</p>
                        </div>
                      )}

                      {/* 處理建議 — 更醒目的底色 */}
                      {interaction.management && (
                        <>
                          <Separator />
                          <div>
                            <h4 className="font-medium mb-2 text-sm text-muted-foreground">臨床處置建議</h4>
                            <Alert className="border-blue-200 bg-blue-50">
                              <AlertTriangle className="h-4 w-4 text-blue-600" />
                              <AlertDescription className="text-sm text-blue-900 leading-relaxed">{interaction.management}</AlertDescription>
                            </Alert>
                          </div>
                        </>
                      )}

                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[#7f265b]" />
          <p className="text-muted-foreground">查詢中...</p>
        </div>
      )}

    </div>
  );
}
