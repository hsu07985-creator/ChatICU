import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Search, Save, CheckCircle2, XCircle, HelpCircle, BookOpen, Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { toast } from 'sonner';
import { useAuth } from '../../lib/auth-context';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { IV_COMPATIBILITY_SOLUTIONS } from '../../lib/pharmacy-master-data';
import {
  createCompatibilityFavorite,
  deleteCompatibilityFavorite,
  getCompatibilityFavorites,
  getIVCompatibility,
} from '../../lib/api/pharmacy';

interface IVCompatibility {
  id: string;
  drug1: string;
  drug2: string;
  solution: string;
  compatible: boolean;
  timeStability?: string;
  notes?: string;
  references?: string;
}

interface FavoriteCompatibilityPair {
  id: string;
  drugA: string;
  drugB: string;
  solution: string; // 'none' | 'NS' | 'D5W' | ...
  createdAt: string;
}

export function CompatibilityPage() {
  const { user } = useAuth();
  const [drugA, setDrugA] = useState('');
  const [drugB, setDrugB] = useState('');
  const [solution, setSolution] = useState('');
  const [searchResults, setSearchResults] = useState<IVCompatibility[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteCompatibilityPair[]>([]);
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const loadFavorites = async () => {
    try {
      const resp = await getCompatibilityFavorites();
      setFavorites(resp.favorites || []);
    } catch (err) {
      console.error('載入常用組合失敗:', err);
      setFavorites([]);
    }
  };

  useEffect(() => {
    loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const normalizeSolution = (value: string): string => {
    if (!value) return 'none';
    return value;
  };

  const handleAddFavorite = async () => {
    const a = drugA.trim();
    const b = drugB.trim();
    if (!a || !b) {
      toast.error('請先輸入兩種藥品名稱');
      return;
    }

    const sol = normalizeSolution(solution);
    try {
      const created = await createCompatibilityFavorite({ drugA: a, drugB: b, solution: sol });
      const existed = favorites.some((f) => f.id === created.id);
      const next = existed ? favorites : [created, ...favorites];
      setFavorites(next);
      toast.success(existed ? '此組合已在常用清單' : '已加入常用組合（雲端同步）');
    } catch (err) {
      console.error('加入常用組合失敗:', err);
      toast.error('加入失敗，請稍後再試');
    }
  };

  const handleRemoveFavorite = async (id: string) => {
    try {
      await deleteCompatibilityFavorite(id);
      setFavorites(favorites.filter((f) => f.id !== id));
      toast.success('已移除常用組合');
    } catch (err) {
      console.error('移除常用組合失敗:', err);
      toast.error('移除失敗，請稍後再試');
    }
  };

  const handleViewReference = async (ref?: string) => {
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

  const handleSearch = async () => {
    if (!drugA.trim() || !drugB.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const params: { drugA: string; drugB: string; solution?: string } = {
        drugA: drugA.trim(),
        drugB: drugB.trim(),
      };
      if (solution && solution !== 'none') {
        params.solution = solution;
      }

      const response = await getIVCompatibility(params);
      setSearchResults(response.compatibilities || []);
    } catch (err) {
      console.error('查詢相容性失敗:', err);
      toast.error('查詢失敗，請確認後端服務是否正常運行');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const getCompatibilityIcon = (compatible: boolean) => {
    if (compatible) {
      return (
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">相容</span>
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="h-5 w-5" />
          <span className="font-medium">不相容</span>
        </div>
      );
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1>相容性檢核</h1>
        <p className="text-muted-foreground mt-1">檢查靜脈輸注藥物的配伍相容性</p>
      </div>

      {/* 搜尋區 */}
      <Card>
        <CardHeader>
          <CardTitle>藥品與溶液選擇</CardTitle>
          <CardDescription>輸入藥品名稱與溶液類型</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
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
            <div className="space-y-2">
              <label className="text-sm font-medium">溶液（可選）</label>
              <Select value={solution} onValueChange={setSolution}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇溶液" />
                </SelectTrigger>
                <SelectContent>
                  {IV_COMPATIBILITY_SOLUTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              onClick={handleAddFavorite}
              disabled={loading || !drugA.trim() || !drugB.trim()}
            >
              <Save className="mr-2 h-4 w-4" />
              加入常用組合
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 查詢結果 */}
      {hasSearched && !loading && (
        <div className="space-y-4">
          {searchResults.length === 0 ? (
            <Alert variant="destructive">
              <HelpCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>資料不足</strong>
                <br />
                未找到相關的配伍相容性資料。建議：
                <ul className="mt-2 ml-4 list-disc space-y-1">
                  <li>使用分開的輸注管路</li>
                  <li>諮詢藥劑部門或查閱完整文獻</li>
                  <li>若必須併用，建議先進行體外相容性測試</li>
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2>查詢結果</h2>
                <span className="text-sm text-muted-foreground">
                  找到 {searchResults.length} 筆資料
                </span>
              </div>

              <div className="grid gap-4">
                {searchResults.map((comp) => (
                  <Card key={comp.id} className={comp.compatible ? 'border-green-200' : 'border-destructive'}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <CardTitle>
                            {comp.drug1} + {comp.drug2}
                          </CardTitle>
                          <div className="flex items-center gap-3">
                            {getCompatibilityIcon(comp.compatible)}
                            {comp.solution && (
                              <Badge variant="outline">溶液：{comp.solution}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {comp.notes && (
                        <>
                          <div>
                            <h4 className="font-medium mb-2">相容條件</h4>
                            <Alert className={comp.compatible ? 'bg-green-50 border-green-200' : ''}>
                              <AlertDescription>{comp.notes}</AlertDescription>
                            </Alert>
                          </div>
                          <Separator />
                        </>
                      )}

                      {comp.timeStability && (
                        <>
                          <div>
                            <h4 className="font-medium mb-2">穩定性</h4>
                            <p className="text-sm">{comp.timeStability}</p>
                          </div>
                          <Separator />
                        </>
                      )}

                      {!comp.compatible && (
                        <>
                          <div>
                            <h4 className="font-medium mb-2 text-destructive">注意事項</h4>
                            <Alert variant="destructive">
                              <AlertDescription>
                                此組合不相容，請勿混合或並行輸注。建議使用不同的輸注管路，並在兩者之間以生理食鹽水沖洗。
                              </AlertDescription>
                            </Alert>
                          </div>
                          <Separator />
                        </>
                      )}

                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">資料來源：</span>
                          <span className="font-medium">{comp.references || '—'}</span>
                        </div>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => handleViewReference(comp.references)}
                        >
                          查看完整文獻 →
                        </Button>
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

      {/* 常用組合 */}
      {!hasSearched && !loading && (
        <>
          <Card className="bg-muted/30">
            <CardHeader className="cursor-pointer select-none" onClick={() => setInstructionsOpen(!instructionsOpen)}>
              <CardTitle className="text-base flex items-center gap-2">
                {instructionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                使用說明
              </CardTitle>
            </CardHeader>
            {instructionsOpen && (
              <CardContent className="space-y-2 text-sm pt-0">
                <p>• 輸入兩種藥品名稱進行查詢（必填）</p>
                <p>• 可選擇特定溶液類型，或選擇「不限定」查詢所有溶液</p>
                <p>• 相容性資料包含配伍條件（如 pH、濃度、時間限制）</p>
                <p>• 若資料庫無相關資訊，建議使用分開的輸注管路</p>
                <p>• 所有資料來源均可追溯，可查閱完整文獻</p>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">常用組合快速查詢</CardTitle>
            </CardHeader>
            <CardContent>
              {favorites.length > 0 && (
                <>
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    我的常用（雲端同步）
                  </p>
                  <div className="grid gap-2 md:grid-cols-2 mb-4">
                    {favorites.map((fav) => (
                      <div key={fav.id} className="flex gap-1">
                        <Button
                          variant="outline"
                          className="justify-start flex-1"
                          onClick={() => {
                            setDrugA(fav.drugA);
                            setDrugB(fav.drugB);
                            setSolution(fav.solution);
                          }}
                        >
                          {fav.drugA} + {fav.drugB}{fav.solution && fav.solution !== 'none' ? ` (${fav.solution})` : ''}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="移除常用組合"
                          onClick={() => handleRemoveFavorite(fav.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setDrugA('Morphine');
                    setDrugB('Midazolam');
                    setSolution('NS');
                  }}
                >
                  Morphine + Midazolam (NS)
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setDrugA('Propofol');
                    setDrugB('Fentanyl');
                    setSolution('none');
                  }}
                >
                  Propofol + Fentanyl
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setDrugA('Cisatracurium');
                    setDrugB('Propofol');
                    setSolution('D5W');
                  }}
                >
                  Cisatracurium + Propofol (D5W)
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
