import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Search, Calculator, AlertTriangle } from 'lucide-react';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

interface DosageResult {
  drugName: string;
  normalDose: string;
  adjustedDose: string;
  renalAdjustment: string;
  hepaticWarning: string;
  warnings: string[];
}

export function DosagePage() {
  const [drugName, setDrugName] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [egfr, setEgfr] = useState('');
  const [hepaticFunction, setHepaticFunction] = useState('normal');
  const [result, setResult] = useState<DosageResult | null>(null);

  const handleCalculate = () => {
    if (!drugName.trim()) return;

    // 本地劑量計算（未來可替換為 API 呼叫）
    const calculatedResult: DosageResult = {
      drugName: drugName,
      normalDose: '2-4 mg IV q1-2h PRN',
      adjustedDose: '1-2 mg IV q2-4h PRN',
      renalAdjustment: egfr && parseInt(egfr) < 30
        ? '減半劑量，間隔延長至 q4-6h'
        : '不需調整',
      hepaticWarning: hepaticFunction !== 'normal'
        ? '肝功能不全病患建議減量使用，並密切監測鎮靜程度與呼吸狀態'
        : '無特殊警示',
      warnings: [
        '老年病患（≥65歲）建議從低劑量開始',
        '併用其他 CNS 抑制劑時需調整劑量',
        '監測呼吸抑制與過度鎮靜'
      ]
    };

    setResult(calculatedResult);
  };

  const calculateAdjustedDose = () => {
    if (!weight) return null;
    
    const weightNum = parseFloat(weight);
    const normalDosePerKg = 0.05; // 示例：0.05 mg/kg
    const calculatedDose = (weightNum * normalDosePerKg).toFixed(2);
    
    return `${calculatedDose} mg`;
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
                placeholder="例：Morphine"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">年齡（歲）</label>
              <Input
                type="number"
                placeholder="例：65"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
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
              <label className="text-sm font-medium">eGFR (mL/min/1.73m²)</label>
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
                  <SelectItem value="mild">輕度不全</SelectItem>
                  <SelectItem value="moderate">中度不全</SelectItem>
                  <SelectItem value="severe">重度不全</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCalculate}>
              <Search className="mr-2 h-4 w-4" />
              查詢
            </Button>
            {weight && (
              <Button variant="outline" onClick={() => alert(`計算劑量：${calculateAdjustedDose()}`)}>
                <Calculator className="mr-2 h-4 w-4" />
                計算劑量
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 結果顯示 */}
      {result && (
        <div className="space-y-4">
          <h2>劑量建議</h2>

          <Card>
            <CardHeader>
              <CardTitle>{result.drugName}</CardTitle>
              <CardDescription>成人建議劑量與調整規則</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 基本劑量 */}
              <div>
                <h3 className="font-medium mb-2">成人標準劑量</h3>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="font-mono">{result.normalDose}</p>
                </div>
              </div>

              <Separator />

              {/* 調整後劑量 */}
              {(egfr && parseInt(egfr) < 60) || hepaticFunction !== 'normal' || (age && parseInt(age) >= 65) ? (
                <>
                  <div>
                    <h3 className="font-medium mb-2">依病患狀況調整後劑量</h3>
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="font-mono text-blue-900">{result.adjustedDose}</p>
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {age && parseInt(age) >= 65 && <p>• 老年病患（{age} 歲）</p>}
                      {egfr && parseInt(egfr) < 60 && <p>• 腎功能不全（eGFR: {egfr}）</p>}
                      {hepaticFunction !== 'normal' && <p>• 肝功能不全</p>}
                    </div>
                  </div>

                  <Separator />
                </>
              ) : null}

              {/* 腎功能調整 */}
              <div>
                <h3 className="font-medium mb-2">腎功能調整</h3>
                <Alert className={egfr && parseInt(egfr) < 30 ? 'border-orange-200 bg-orange-50' : ''}>
                  <AlertDescription>{result.renalAdjustment}</AlertDescription>
                </Alert>
              </div>

              {/* 肝功能警示 */}
              {hepaticFunction !== 'normal' && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-medium mb-2">肝功能不全警示</h3>
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{result.hepaticWarning}</AlertDescription>
                    </Alert>
                  </div>
                </>
              )}

              {/* 警示事項 */}
              <Separator />
              <div>
                <h3 className="font-medium mb-2">注意事項</h3>
                <div className="space-y-2">
                  {result.warnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="mt-0.5">!</Badge>
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 體重計算 */}
              {weight && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-medium mb-2">依體重計算（參考值）</h3>
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          體重 {weight} kg × 0.05 mg/kg =
                        </span>
                        <span className="font-mono font-medium">{calculateAdjustedDose()}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>免責聲明：</strong>
              以上劑量建議僅供參考，實際使用時應依據完整的臨床評估、藥品仿單與最新文獻進行調整。
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* 使用說明 */}
      {!result && (
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base">使用說明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• 輸入藥品名稱查詢標準劑量（必填）</p>
            <p>• 輸入病患年齡、體重、腎功能與肝功能參數</p>
            <p>• 系統將根據參數自動調整建議劑量</p>
            <p>• 可使用「計算劑量」功能依體重計算個人化劑量</p>
            <p>• 建議劑量僅供參考，實際處方需依臨床判斷</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}