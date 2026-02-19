import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { toast } from 'sonner';
import { checkInteractions, type InteractionCheckResponse } from '../../lib/api/ai';
import { getDrugInteractions } from '../../lib/api/pharmacy';
import { copyToClipboard } from '../../lib/clipboard-utils';

interface DisplayInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
}

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
      }));
      setSearchResults(mapped);
    } catch (err) {
      console.error('查詢交互作用失敗:', err);
      // Fallback: use DB-backed interactions when Evidence engine (func/) isn't running.
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

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />高</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="gap-1 bg-orange-100 text-orange-800"><AlertCircle className="h-3 w-3" />中</Badge>;
      case 'low':
        return <Badge variant="outline" className="gap-1"><Info className="h-3 w-3" />低</Badge>;
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
              <Input
                placeholder="例：Propofol"
                value={drugA}
                onChange={(e) => setDrugA(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 B *</label>
              <Input
                placeholder="例：Fentanyl"
                value={drugB}
                onChange={(e) => setDrugB(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
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
                  找到 {searchResults.length} 筆交互作用 · 總體嚴重度：{overallSeverity}
                </span>
              </div>

              <div className="grid gap-4">
                {searchResults.map((interaction) => (
                  <Card key={interaction.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="flex items-center gap-2">
                            {interaction.drug1} + {interaction.drug2}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(interaction.severity)}
                            {interaction.mechanism && (
                              <Badge variant="outline">{interaction.mechanism}</Badge>
                            )}
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
                      {interaction.clinicalEffect && (
                        <div>
                          <h4 className="font-medium mb-2">交互作用說明</h4>
                          <p className="text-sm">{interaction.clinicalEffect}</p>
                        </div>
                      )}

                      {interaction.management && (
                        <>
                          <Separator />
                          <div>
                            <h4 className="font-medium mb-2">處理建議</h4>
                            <Alert>
                              <AlertDescription>{interaction.management}</AlertDescription>
                            </Alert>
                          </div>
                        </>
                      )}

                      {interaction.references && (
                        <>
                          <Separator />
                          <div className="flex items-center gap-2 text-sm">
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">劑量調整提示：</span>
                            <span className="font-medium">{interaction.references}</span>
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
              <p>• 嚴重度分級：contraindicated {'>'} major {'>'} moderate {'>'} minor</p>
              <p>• 所有結果基於臨床規則引擎，僅供參考</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
