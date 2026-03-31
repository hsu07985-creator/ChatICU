import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2, ChevronDown, ChevronRight, ShieldAlert, FlaskConical, Route, FileText, BookMarked, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { toast } from 'sonner';
import { checkInteractions, type InteractionCheckResponse } from '../../lib/api/ai';
import { getDrugInteractions } from '../../lib/api/pharmacy';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST } from '../../lib/drug-list';

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
}

const RISK_RATING_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  X: { label: 'Risk X 避免併用', color: 'text-red-900', bgColor: 'bg-red-100 border-red-300' },
  D: { label: 'Risk D 考慮調整', color: 'text-orange-900', bgColor: 'bg-orange-100 border-orange-300' },
  C: { label: 'Risk C 監測治療', color: 'text-yellow-900', bgColor: 'bg-yellow-100 border-yellow-300' },
  B: { label: 'Risk B 不需處置', color: 'text-green-900', bgColor: 'bg-green-100 border-green-300' },
  A: { label: 'Risk A 無交互作用', color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-300' },
};

const RELIABILITY_CONFIG: Record<string, { label: string; color: string }> = {
  Highest: { label: '最高', color: 'bg-red-50 text-red-700 border-red-200' },
  Intermediate: { label: '中等', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  'Intermediate-Low': { label: '中低', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  Lowest: { label: '最低', color: 'bg-gray-50 text-gray-600 border-gray-200' },
};

export function DrugInteractionsPage() {
  const [drugA, setDrugA] = useState('');
  const [drugB, setDrugB] = useState('');
  const [searchResults, setSearchResults] = useState<DisplayInteraction[]>([]);
  const [overallSeverity, setOverallSeverity] = useState<string>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const handleSearch = async () => {
    const drugs = [drugA.trim(), drugB.trim()].filter(Boolean);
    if (drugs.length < 2) {
      toast.error('請至少輸入兩種藥品名稱');
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const result: InteractionCheckResponse = await checkInteractions({ drugList: drugs }, { suppressErrorToast: true });
      setOverallSeverity(result.overall_severity || 'none');
      const mapped: DisplayInteraction[] = (result.findings || []).map((f, idx) => ({
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
      }));
      setSearchResults(mapped);
    } catch (err) {
      console.error('查詢交互作用失敗:', err);
      try {
        const resp = await getDrugInteractions({ drugA: drugs[0], drugB: drugs[1] });
        const rows = resp.interactions || [];
        const mapped: DisplayInteraction[] = rows.map((r, idx) => ({
          id: r.id || `db-int-${idx}`,
          drug1: r.drug1 || drugs[0],
          drug2: r.drug2 || drugs[1],
          severity: mapSeverity(r.severity || ''),
          mechanism: r.mechanism || '',
          clinicalEffect: r.clinicalEffect || '',
          management: r.management || '',
          references: r.references || '',
          riskRating: '',
          riskRatingDescription: '',
          severityLabel: '',
          reliabilityRating: '',
          routeDependency: '',
          discussion: '',
          footnotes: '',
        }));

        if (mapped.length) {
          const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
          const max = mapped.reduce((acc, it) => (rank[it.severity] > rank[acc] ? it.severity : acc), 'low');
          setOverallSeverity(max);
        } else {
          setOverallSeverity('none');
        }
        setSearchResults(mapped);
        toast.message('已改用本地資料庫查詢（Evidence 引擎未啟動）');
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

  const getReliabilityBadge = (rating: string) => {
    if (!rating) return null;
    const config = RELIABILITY_CONFIG[rating] || { label: rating, color: 'bg-gray-50 text-gray-600 border-gray-200' };
    return (
      <Badge variant="outline" className={`gap-1 border ${config.color} text-xs`}>
        <FlaskConical className="h-3 w-3" />
        證據：{config.label}
      </Badge>
    );
  };

  /** Format discussion text: split into paragraphs, convert inline citation numbers to superscript */
  const formatDiscussion = (text: string) => {
    // Split on double-newline or sentence-ending patterns before "A review", "In another", "Combined", "In contrast", "Similarly", "While"
    const paragraphs = text
      .split(/\n\n+/)
      .flatMap(p => p.split(/(?<=\.(?:\d+)?)\s+(?=(?:A review|An analysis|In another|Combined use|In contrast|Similarly|While the|The use of|However)\b)/))
      .filter(s => s.trim());

    return paragraphs.map((para, i) => {
      // Convert inline citation numbers like ".1 " or ",2 " or " 3," to superscript
      const parts = para.split(/(\.\d+(?:,\d+)*(?=\s|$|\.)|\b(\d+(?:,\d+)*)\b(?=\s+In\b|\s+An\b|\s+A\b|\s+The\b|\s+While\b|\s+Combined\b|\s+Similarly\b))/g);
      return (
        <p key={i} className="text-sm leading-relaxed text-foreground/90">
          {parts.map((part, j) => {
            if (!part) return null;
            // Match citation-like patterns: .1 or .6,7 or .9,10,11
            if (/^\.\d+(,\d+)*$/.test(part)) {
              const nums = part.slice(1); // remove leading dot
              return <span key={j}>.<sup className="text-blue-600 font-medium">{nums}</sup></span>;
            }
            return <span key={j}>{part}</span>;
          })}
        </p>
      );
    });
  };

  /** Parse a single footnote line and make PubMed IDs clickable */
  const formatFootnote = (line: string, index: number) => {
    // Extract leading number
    const numMatch = line.match(/^(\d+)\.\s*/);
    const num = numMatch ? numMatch[1] : String(index + 1);
    const rest = numMatch ? line.slice(numMatch[0].length) : line;

    // Make PubMed IDs clickable
    const pubmedMatch = rest.match(/\[PubMed\s+(\d+)\]/);
    if (pubmedMatch) {
      const before = rest.slice(0, pubmedMatch.index);
      const pmid = pubmedMatch[1];
      const after = rest.slice((pubmedMatch.index || 0) + pubmedMatch[0].length);
      return (
        <li key={index} className="flex gap-2 py-1.5 border-b border-muted/60 last:border-0">
          <span className="text-xs font-mono text-muted-foreground w-6 shrink-0 text-right pt-0.5">{num}.</span>
          <span className="text-xs leading-relaxed text-foreground/80">
            {before}
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
              PubMed {pmid}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {after}
          </span>
        </li>
      );
    }

    return (
      <li key={index} className="flex gap-2 py-1.5 border-b border-muted/60 last:border-0">
        <span className="text-xs font-mono text-muted-foreground w-6 shrink-0 text-right pt-0.5">{num}.</span>
        <span className="text-xs leading-relaxed text-foreground/80">{rest}</span>
      </li>
    );
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
                            {interaction.severityLabel && (
                              <Badge variant="outline" className="gap-1 text-xs">
                                嚴重度：{interaction.severityLabel}
                              </Badge>
                            )}
                            {getReliabilityBadge(interaction.reliabilityRating)}
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

                      {/* Tabs: 文獻回顧 + 參考文獻 */}
                      {(interaction.discussion || interaction.footnotes) && (
                        <>
                          <Separator />
                          <Tabs defaultValue="discussion" className="w-full">
                            <TabsList className="w-full">
                              {interaction.discussion && (
                                <TabsTrigger value="discussion" className="gap-1.5 text-xs">
                                  <FileText className="h-3.5 w-3.5" />
                                  文獻回顧與臨床證據
                                </TabsTrigger>
                              )}
                              {interaction.footnotes && (
                                <TabsTrigger value="footnotes" className="gap-1.5 text-xs">
                                  <BookMarked className="h-3.5 w-3.5" />
                                  參考文獻 ({interaction.footnotes.split('\n').filter(Boolean).length} 篇)
                                </TabsTrigger>
                              )}
                            </TabsList>

                            {interaction.discussion && (
                              <TabsContent value="discussion">
                                <div className="p-4 bg-muted/30 rounded-lg border space-y-3 mt-1">
                                  {formatDiscussion(interaction.discussion)}
                                </div>
                              </TabsContent>
                            )}

                            {interaction.footnotes && (
                              <TabsContent value="footnotes">
                                <div className="p-4 bg-muted/30 rounded-lg border mt-1">
                                  <ol className="list-none m-0 p-0">
                                    {interaction.footnotes.split('\n').filter(Boolean).map((ref, i) =>
                                      formatFootnote(ref, i)
                                    )}
                                  </ol>
                                </div>
                              </TabsContent>
                            )}
                          </Tabs>
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

      {/* 提示資訊 */}
      {!hasSearched && !loading && (
        <Card className="bg-muted/30">
          <CardHeader className="cursor-pointer select-none" onClick={() => setInstructionsOpen(!instructionsOpen)}>
            <CardTitle className="text-base flex items-center gap-2">
              {instructionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              使用說明
            </CardTitle>
          </CardHeader>
          {instructionsOpen && (
            <CardContent className="space-y-2 text-sm pt-0">
              <p>• 輸入至少兩種藥品名稱進行交互作用查詢</p>
              <p>• 支援中英文藥品名稱與常見商品名</p>
              <p>• 查詢結果包含交互作用類型、嚴重程度與處理建議</p>
              <p>• Risk Rating 分級：X（避免併用）{'>'} D（考慮調整）{'>'} C（監測治療）{'>'} B（不需處置）</p>
              <p>• 點擊「文獻回顧」和「參考文獻」可展開查看詳細臨床證據</p>
              <p>• 所有結果基於 MICROMEDEX DrugDex 資料庫，僅供參考</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
