import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Search, AlertTriangle, Loader2 } from 'lucide-react';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { calculateDose, type DoseCalculateResponse } from '../../lib/api/ai';
import { isAxiosError } from 'axios';

export function DosagePage() {
  const [drugName, setDrugName] = useState('');
  const [indication, setIndication] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [egfr, setEgfr] = useState('');
  const [hepaticFunction, setHepaticFunction] = useState('normal');
  const [result, setResult] = useState<DoseCalculateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCalculate = async () => {
    if (!drugName.trim()) {
      toast.error('請輸入藥品名稱');
      return;
    }

    setLoading(true);
    try {
      const hepaticMap: Record<string, string> = {
        normal: '',
        mild: 'child_pugh_a',
        moderate: 'child_pugh_b',
        severe: 'child_pugh_c',
      };

      const res = await calculateDose({
        drug: drugName.trim(),
        indication: indication.trim() || undefined,
        patientContext: {
          age_years: age ? parseFloat(age) : undefined,
          weight_kg: weight ? parseFloat(weight) : undefined,
          crcl_ml_min: egfr ? parseFloat(egfr) : undefined,
          hepatic_class: hepaticMap[hepaticFunction] || undefined,
        },
      }, { suppressErrorToast: true });
      setResult(res);
    } catch (err) {
      console.error('劑量計算失敗:', err);
      if (isAxiosError(err)) {
        const status = err.response?.status;
        const serverMessage = String((err.response?.data as Record<string, unknown>)?.message || '');
        if (status === 503 && serverMessage.includes('Evidence engine service unavailable')) {
          toast.error('劑量引擎不可用（請啟動 func/ 服務）');
        } else if (serverMessage) {
          toast.error(serverMessage);
        } else {
          toast.error('劑量計算失敗，請稍後再試');
        }
      } else {
        toast.error('劑量計算失敗，請稍後再試');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatComputedValues = (values: Record<string, unknown>): string[] => {
    return Object.entries(values).map(([k, v]) => `${k}: ${v}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1>劑量計算與建議</h1>
        <p className="text-muted-foreground mt-1">查詢藥品建議劑量並根據病患狀況調整</p>
      </div>

      {/* 輸入區 */}
      <Card>
        <CardHeader>
          <CardTitle>病患資訊與藥品查詢</CardTitle>
          <CardDescription>輸入病患基本參數與藥品名稱</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品名稱 *</label>
              <Input
                placeholder="例：Norepinephrine"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">適應症</label>
              <Input
                placeholder="例：septic shock"
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">年齡（歲）</label>
              <Input
                type="number"
                placeholder="例：65"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">體重（kg）</label>
              <Input
                type="number"
                placeholder="例：70"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">CrCl (mL/min)</label>
              <Input
                type="number"
                placeholder="例：45"
                value={egfr}
                onChange={(e) => setEgfr(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">肝功能</label>
              <Select value={hepaticFunction} onValueChange={setHepaticFunction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">正常</SelectItem>
                  <SelectItem value="mild">Child-Pugh A</SelectItem>
                  <SelectItem value="moderate">Child-Pugh B</SelectItem>
                  <SelectItem value="severe">Child-Pugh C</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleCalculate} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            計算劑量
          </Button>
        </CardContent>
      </Card>

      {/* 結果顯示 */}
      {result && (
        <div className="space-y-4">
          <h2>劑量建議</h2>

          {result.status === 'refused' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {result.message || '無法計算劑量，請檢查輸入參數。'}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{result.drug || drugName}</CardTitle>
                <Badge variant={result.status === 'ok' ? 'default' : 'destructive'}>
                  信心度：{(result.confidence * 100).toFixed(0)}%
                </Badge>
              </div>
              <CardDescription>
                {result.result_type === 'dose_calculation' ? '規則引擎計算結果' : result.result_type}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 計算結果 */}
              {Object.keys(result.computed_values).length > 0 && (
                <div>
                  <h3 className="font-medium mb-2">計算結果</h3>
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    {formatComputedValues(result.computed_values).map((line, idx) => (
                      <p key={idx} className="font-mono text-sm">{line}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* 計算步驟 */}
              {result.calculation_steps.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-medium mb-2">計算步驟</h3>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      {result.calculation_steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </>
              )}

              {/* 安全警告 */}
              {result.safety_warnings.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-medium mb-2">安全警告</h3>
                    <div className="space-y-2">
                      {result.safety_warnings.map((warning, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* 引用規則 */}
              {result.applied_rules.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-medium mb-2">應用規則</h3>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {result.applied_rules.map((rule, idx) => (
                        <p key={idx}>{JSON.stringify(rule)}</p>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>免責聲明：</strong>
              以上劑量建議由規則引擎計算，僅供參考。實際使用時應依據完整的臨床評估、藥品仿單與最新文獻進行調整。
            </AlertDescription>
          </Alert>
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[#7f265b]" />
          <p className="text-muted-foreground">計算中...</p>
        </div>
      )}

      {/* 使用說明 */}
      {!result && !loading && (
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base">使用說明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• 輸入藥品名稱查詢建議劑量（必填）</p>
            <p>• 提供病患年齡、體重、腎功能與肝功能可獲得個人化建議</p>
            <p>• 系統使用臨床規則引擎進行 deterministic 計算</p>
            <p>• 計算結果包含具體劑量、計算步驟、安全警告</p>
            <p>• 支援 weight-based、fixed-dose、infusion rate 等計算模式</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
