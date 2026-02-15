import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { toast } from 'sonner';
import apiClient from '../../lib/api-client';

interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

interface InteractionsResponse {
  interactions: DrugInteraction[];
  total: number;
}

export function DrugInteractionsPage() {
  const [drugA, setDrugA] = useState('');
  const [drugB, setDrugB] = useState('');
  const [searchResults, setSearchResults] = useState<DrugInteraction[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!drugA.trim() && !drugB.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const params: Record<string, string> = {};
      if (drugA.trim()) params.drugA = drugA.trim();
      if (drugB.trim()) params.drugB = drugB.trim();

      const response = await apiClient.get<ApiResponse<InteractionsResponse>>(
        '/pharmacy/drug-interactions',
        { params }
      );
      setSearchResults(response.data.data?.interactions || []);
    } catch (err) {
      console.error('查詢交互作用失敗:', err);
      toast.error('查詢失敗，請確認後端服務是否正常運行');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
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
          <CardDescription>輸入藥品名稱（支援中英文與商品名）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 A</label>
              <Input
                placeholder="例：Propofol"
                value={drugA}
                onChange={(e) => setDrugA(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 B（可選）</label>
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
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              新增藥品
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
                未找到相關的藥物交互作用資料。請確認藥品名稱是否正確，或嘗試其他關鍵字。
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
                        <div className="space-y-1">
                          <CardTitle className="flex items-center gap-2">
                            {interaction.drug1} + {interaction.drug2}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(interaction.severity)}
                            <Badge variant="outline">{interaction.mechanism}</Badge>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon">
                          <BookOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h4 className="font-medium mb-2">交互作用說明</h4>
                        <p className="text-sm">{interaction.clinicalEffect}</p>
                      </div>

                      <Separator />

                      <div>
                        <h4 className="font-medium mb-2">處理建議</h4>
                        <Alert>
                          <AlertDescription>{interaction.management}</AlertDescription>
                        </Alert>
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">資料來源：</span>
                          <span className="font-medium">{interaction.references}</span>
                        </div>
                        <Button variant="link" size="sm">查看完整文獻 →</Button>
                      </div>
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
          <CardHeader>
            <CardTitle className="text-base">使用說明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• 輸入至少一種藥品名稱進行查詢</p>
            <p>• 支援中英文藥品名稱與常見商品名</p>
            <p>• 可同時輸入兩種藥品進行精確查詢</p>
            <p>• 查詢結果包含交互作用類型、嚴重程度與處理建議</p>
            <p>• 所有資料來源均註明出處，可追溯查證</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
