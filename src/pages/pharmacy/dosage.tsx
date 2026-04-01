import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Calculator, Loader2, AlertTriangle, ChevronDown, ChevronRight, User, X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { padCalculate, getPadDrugs, type PadDrugInfo, type PadCalculateResult } from '../../lib/api/pharmacy';
import { getPatients, type Patient } from '../../lib/api/patients';
import { isAxiosError } from 'axios';

/** Parse dose_range like "0.03–0.6" → [0.03, 0.6] */
function parseDoseRange(range?: string): [number, number] | null {
  if (!range) return null;
  const parts = range.split('–');
  if (parts.length !== 2) return null;
  const lo = parseFloat(parts[0]);
  const hi = parseFloat(parts[1]);
  if (isNaN(lo) || isNaN(hi)) return null;
  return [lo, hi];
}

export function DosagePage() {
  // Drug catalog
  const [padDrugs, setPadDrugs] = useState<PadDrugInfo[]>([]);
  const [drugsLoading, setDrugsLoading] = useState(false);

  // Patient selector
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');

  // Input
  const [selectedDrug, setSelectedDrug] = useState('');
  const [weight, setWeight] = useState('');
  const [targetDose, setTargetDose] = useState('');
  const [concentration, setConcentration] = useState('');
  const [sex, setSex] = useState('');
  const [height, setHeight] = useState('');

  // Result
  const [result, setResult] = useState<PadCalculateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  // Selected drug info helper
  const drugInfo = padDrugs.find(d => d.key === selectedDrug);

  // Dose range validation
  const doseRange = useMemo(() => parseDoseRange(drugInfo?.dose_range), [drugInfo]);
  const targetDoseNum = targetDose ? parseFloat(targetDose) : NaN;
  const isDoseOutOfRange = doseRange && !isNaN(targetDoseNum) && targetDoseNum > 0 &&
    (targetDoseNum < doseRange[0] || targetDoseNum > doseRange[1]);

  // Concentration deviation check
  const isConcentrationChanged = drugInfo &&
    concentration !== '' &&
    parseFloat(concentration) !== drugInfo.concentration;

  // Load PAD drugs + patients on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDrugsLoading(true);
      try {
        const res = await getPadDrugs();
        if (!cancelled) setPadDrugs(res.drugs);
      } catch {
        if (!cancelled) setPadDrugs([]);
      } finally {
        if (!cancelled) setDrugsLoading(false);
      }
    })();
    (async () => {
      setPatientsLoading(true);
      try {
        const res = await getPatients({ limit: 100 });
        if (!cancelled) setPatients(res.patients);
      } catch {
        if (!cancelled) toast.error('無法載入病患列表');
      } finally {
        if (!cancelled) setPatientsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fix #1: Drug switch always clears target dose + result
  const handleDrugChange = useCallback((drugKey: string) => {
    setSelectedDrug(drugKey);
    setTargetDose('');
    setResult(null);
    const info = padDrugs.find(d => d.key === drugKey);
    if (info) {
      setConcentration(String(info.concentration));
    }
  }, [padDrugs]);

  // When patient selected, fill weight/sex/height
  const handlePatientSelect = useCallback((patientId: string) => {
    setSelectedPatientId(patientId);
    if (!patientId) return;
    const p = patients.find(pt => pt.id === patientId);
    if (p) {
      if (p.weight) setWeight(String(p.weight));
      if (p.height) setHeight(String(p.height));
      if (p.gender === '男') setSex('male');
      else if (p.gender === '女') setSex('female');
      toast.success(`已帶入 ${p.name} 的基本資料`);
    }
  }, [patients]);

  // Fix #5: Reset all fields
  const handleReset = useCallback(() => {
    setSelectedDrug('');
    setWeight('');
    setTargetDose('');
    setConcentration('');
    setSex('');
    setHeight('');
    setSelectedPatientId('');
    setResult(null);
  }, []);

  const isFixedDose = drugInfo?.weight_basis === 'fixed';

  const handleCalculate = async () => {
    if (!selectedDrug) {
      toast.error('請選擇藥品');
      return;
    }
    if (!weight || parseFloat(weight) <= 0) {
      toast.error('請輸入體重');
      return;
    }
    if (!isFixedDose && (!targetDose || parseFloat(targetDose) < 0)) {
      toast.error('請輸入目標劑量');
      return;
    }
    if (!isFixedDose && (!concentration || parseFloat(concentration) <= 0)) {
      toast.error('請輸入藥物濃度');
      return;
    }

    setLoading(true);
    try {
      const res = await padCalculate({
        drug: selectedDrug,
        weight_kg: parseFloat(weight),
        target_dose_per_kg_hr: isFixedDose ? 0 : parseFloat(targetDose),
        concentration: isFixedDose ? (drugInfo?.concentration || 1) : parseFloat(concentration),
        sex: (sex && sex !== 'none') ? sex : undefined,
        height_cm: height ? parseFloat(height) : undefined,
      });
      setResult(res);
    } catch (err) {
      console.error('PAD 劑量計算失敗:', err);
      if (isAxiosError(err)) {
        const msg = String((err.response?.data as Record<string, unknown>)?.message || '');
        toast.error(msg || '劑量計算失敗');
      } else {
        toast.error('劑量計算失敗');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1>劑量計算與建議</h1>
        <p className="text-muted-foreground mt-1">ICU PAD 藥物輸注速率計算（含肥胖體重調整）</p>
      </div>

      {/* 輸入區 */}
      <Card>
        <CardHeader>
          <CardTitle>PAD 藥物劑量計算</CardTitle>
          <CardDescription>選擇藥品、輸入體重與目標劑量，系統自動計算輸注速率 (ml/hr)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 病患選擇器 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-20 shrink-0">
              <User className="inline h-3.5 w-3.5 mr-1" />
              病患
            </label>
            <div className="flex-1">
              <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={patientsLoading ? '載入中...' : '選擇病患帶入體重/身高（可選）'} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.bedNumber} — {p.name}（{p.medicalRecordNumber}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPatientId && (
              <Button
                variant="ghost" size="icon"
                className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => setSelectedPatientId('')}
                aria-label="清除病患選擇"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Separator />

          {/* 藥品選擇 */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">藥品 *</label>
              <Select value={selectedDrug} onValueChange={handleDrugChange} disabled={drugsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={drugsLoading ? '載入藥品...' : '選擇 PAD 藥品'} />
                </SelectTrigger>
                <SelectContent>
                  {padDrugs.map(d => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">體重 (kg) *</label>
              <Input
                type="number"
                placeholder="例：70"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>

          {isFixedDose && drugInfo && (
            <Alert>
              <AlertDescription>
                <strong>{drugInfo.label}</strong> 為固定劑量藥物（非體重依賴），建議劑量：{drugInfo.dose_range}。
                不需輸入目標劑量與濃度。
              </AlertDescription>
            </Alert>
          )}

          {/* 目標劑量 / 濃度 — 僅 weight-based 藥物需要 */}
          {!isFixedDose && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  目標劑量 *
                  {drugInfo && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({drugInfo.dose_unit}，範圍：{drugInfo.dose_range})
                    </span>
                  )}
                </label>
                <Input
                  type="number"
                  step="any"
                  placeholder={drugInfo ? `例：${drugInfo.dose_range.split('–')[0]}` : '選擇藥品後顯示'}
                  value={targetDose}
                  onChange={(e) => setTargetDose(e.target.value)}
                  className={isDoseOutOfRange ? 'border-amber-500 focus-visible:ring-amber-500' : ''}
                />
                {/* Fix #2: Out-of-range warning */}
                {isDoseOutOfRange && doseRange && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    超出建議範圍（{doseRange[0]}–{doseRange[1]} {drugInfo?.dose_unit}），請確認劑量
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  濃度 *
                  {drugInfo && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({drugInfo.concentration_unit})
                    </span>
                  )}
                </label>
                <Input
                  type="number"
                  step="any"
                  placeholder={drugInfo ? String(drugInfo.concentration) : ''}
                  value={concentration}
                  onChange={(e) => setConcentration(e.target.value)}
                  className={isConcentrationChanged ? 'border-amber-500 focus-visible:ring-amber-500' : ''}
                />
                {/* Fix #4: Concentration deviation hint */}
                {isConcentrationChanged && drugInfo && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    已偏離 PAD 預設濃度（{drugInfo.concentration} {drugInfo.concentration_unit}）
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 身高 / 性別 (可選，肥胖調整用) */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                性別
                <span className="text-muted-foreground font-normal ml-1">(可選，肥胖調整用)</span>
              </label>
              <Select value={sex} onValueChange={setSex}>
                <SelectTrigger>
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指定</SelectItem>
                  <SelectItem value="male">男</SelectItem>
                  <SelectItem value="female">女</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                身高 (cm)
                <span className="text-muted-foreground font-normal ml-1">(可選，肥胖調整用)</span>
              </label>
              <Input
                type="number"
                placeholder="例：170"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
          </div>

          {/* Fix #5: Reset + Calculate buttons */}
          <div className="flex gap-2">
            <Button onClick={handleCalculate} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="mr-2 h-4 w-4" />
              )}
              計算輸注速率
            </Button>
            {(selectedDrug || weight || targetDose || concentration || sex || height) && (
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                清除全部
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 結果 */}
      {result && (
        <div className="space-y-4">
          {result.note && result.rate_ml_hr === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{drugInfo?.label || result.drug}</CardTitle>
                <CardDescription>固定劑量藥物</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{result.note}</AlertDescription>
                </Alert>
                {result.steps.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    {result.steps.map((s, i) => <p key={i}>{s}</p>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{drugInfo?.label || result.drug}</CardTitle>
                    <Badge variant="default" className="text-base px-3 py-1">
                      {result.rate_ml_hr} ml/hr
                    </Badge>
                  </div>
                  <CardDescription>
                    體重基礎：{result.weight_basis}（計算體重 {result.dosing_weight_kg} kg）
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Fix #7: Rate more prominent — dedicated hero section */}
                  <div className="p-4 bg-[#7f265b]/10 border border-[#7f265b]/20 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground mb-1">建議輸注速率</p>
                    <p className="text-4xl font-bold text-[#7f265b]">{result.rate_ml_hr}</p>
                    <p className="text-sm font-medium text-[#7f265b]/80">ml/hr</p>
                  </div>

                  {/* 次要結果 */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-xs text-muted-foreground">每小時劑量</p>
                      <p className="text-xl font-bold">{result.dose_per_hr}</p>
                      <p className="text-xs text-muted-foreground">{drugInfo?.dose_unit?.replace('/kg/hr', '/hr') || '/hr'}</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-xs text-muted-foreground">藥物濃度</p>
                      <p className="text-xl font-bold">{result.concentration.split(' ')[0]}</p>
                      <p className="text-xs text-muted-foreground">{result.concentration.split(' ').slice(1).join(' ')}</p>
                    </div>
                  </div>

                  {/* 體重分析 */}
                  {result.BMI != null && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="font-medium mb-2">體重分析</h3>
                        <div className="grid gap-2 sm:grid-cols-4 text-sm">
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">BMI</span>
                            <span className="font-medium sm:block">{result.BMI}</span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">IBW</span>
                            <span className="font-medium sm:block">{result.IBW_kg} kg</span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">AdjBW</span>
                            <span className="font-medium sm:block">{result.AdjBW_kg} kg</span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">%IBW</span>
                            <span className="font-medium sm:block">
                              {result.pct_IBW}%
                              {/* Fix #8: Badges for both obese and underweight */}
                              {result.is_obese && (
                                <Badge variant="destructive" className="ml-1 text-xs">肥胖</Badge>
                              )}
                              {!result.is_obese && result.pct_IBW != null && result.pct_IBW < 90 && (
                                <Badge className="ml-1 text-xs bg-amber-500 hover:bg-amber-600">體重偏低</Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* 計算步驟 */}
                  {result.steps.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="font-medium mb-2">計算步驟</h3>
                        <ol className="list-decimal list-inside space-y-1 text-sm">
                          {result.steps.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </>
                  )}

                  {result.note && (
                    <>
                      <Separator />
                      <div className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        <span>{result.note}</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Alert>
                <AlertDescription>
                  <strong>免責聲明：</strong>
                  以上劑量建議由 PAD guideline 規則引擎計算，僅供參考。實際使用時應依據完整的臨床評估、藥品仿單與最新文獻進行調整。
                </AlertDescription>
              </Alert>
            </>
          )}
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
          <CardHeader className="cursor-pointer select-none" onClick={() => setInstructionsOpen(!instructionsOpen)}>
            <CardTitle className="text-base flex items-center gap-2">
              {instructionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              使用說明
            </CardTitle>
          </CardHeader>
          {instructionsOpen && (
            <CardContent className="space-y-2 text-sm pt-0">
              <p>• 支援 9 種 ICU PAD 藥物：Cisatracurium, Rocuronium, Fentanyl, Morphine, Dexmedetomidine, Propofol, Midazolam, Lorazepam, Haloperidol</p>
              <p>• 選擇藥品後系統自動帶入預設濃度，輸入體重與目標劑量即可計算</p>
              <p>• 可選擇病患自動帶入體重、性別、身高</p>
              <p>• 提供性別與身高時，系統會進行肥胖體重調整（Devine IBW/AdjBW）</p>
              <p>• 肥胖判定：%IBW &gt; 120%，親水性藥物使用 IBW，親脂性藥物使用 AdjBW</p>
              <p>• 計算公式：輸注速率 (ml/hr) = (計算體重 × 目標劑量) ÷ 濃度</p>
              <p>• 目標劑量超出建議範圍或濃度偏離預設值時，會以黃色框線提示</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
