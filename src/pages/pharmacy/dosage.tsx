import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Calculator, Loader2, AlertTriangle, User, X, RotateCcw, ChevronRight, ChevronDown } from 'lucide-react';
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
  const [stepsOpen, setStepsOpen] = useState(false);

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

  // Drug switch always clears target dose + result
  const handleDrugChange = useCallback((drugKey: string) => {
    setSelectedDrug(drugKey);
    setTargetDose('');
    setResult(null);
    setStepsOpen(false);
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

  // Reset all fields
  const handleReset = useCallback(() => {
    setSelectedDrug('');
    setWeight('');
    setTargetDose('');
    setConcentration('');
    setSex('');
    setHeight('');
    setSelectedPatientId('');
    setResult(null);
    setStepsOpen(false);
  }, []);

  const isFixedDose = drugInfo?.weight_basis === 'fixed';

  const handleCalculate = async () => {
    if (!selectedDrug) { toast.error('請選擇藥品'); return; }
    if (!weight || parseFloat(weight) <= 0) { toast.error('請輸入體重'); return; }
    if (!isFixedDose && (!targetDose || parseFloat(targetDose) < 0)) { toast.error('請輸入目標劑量'); return; }
    if (!isFixedDose && (!concentration || parseFloat(concentration) <= 0)) { toast.error('請輸入藥物濃度'); return; }

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
      setStepsOpen(false);
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

  const doseUnitShort = drugInfo?.dose_unit?.replace('/kg/hr', '/hr') || '/hr';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1>劑量計算與建議</h1>
        <p className="text-muted-foreground text-sm mt-0.5">ICU PAD 藥物輸注速率計算（含肥胖體重調整）</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">PAD 藥物劑量計算</CardTitle>
          <CardDescription className="text-xs">選擇藥品、輸入體重與目標劑量，系統自動計算輸注速率 (ml/hr)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Row 1: Drug + Weight + Patient (3-col desktop) */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">藥品 *</label>
              <Select value={selectedDrug} onValueChange={handleDrugChange} disabled={drugsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={drugsLoading ? '載入中...' : '選擇 PAD 藥品'} />
                </SelectTrigger>
                <SelectContent>
                  {padDrugs.map(d => (
                    <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">體重 (kg) *</label>
              <Input type="number" className="h-9" placeholder="例：70" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                <User className="inline h-3 w-3 mr-0.5" />病患（可選）
              </label>
              <div className="flex gap-1">
                <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={patientsLoading ? '載入...' : '帶入體重/身高'} />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.bedNumber} — {p.name}（{p.medicalRecordNumber}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPatientId && (
                  <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => setSelectedPatientId('')} aria-label="清除病患">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Fixed dose alert */}
          {isFixedDose && drugInfo && (
            <Alert className="py-2">
              <AlertDescription className="text-xs">
                <strong>{drugInfo.label}</strong> 為固定劑量藥物（非體重依賴），建議劑量：{drugInfo.dose_range}。不需輸入目標劑量與濃度。
              </AlertDescription>
            </Alert>
          )}

          {/* Row 2: Target dose + Concentration + Sex + Height (4-col desktop) */}
          {!isFixedDose && (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  目標劑量 *
                  {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-[10px]">({drugInfo.dose_unit})</span>}
                </label>
                <Input type="number" step="any" className={`h-9 ${isDoseOutOfRange ? 'border-red-500 border-2 focus-visible:ring-red-500' : ''}`}
                  placeholder={drugInfo ? drugInfo.dose_range : ''} value={targetDose} onChange={(e) => setTargetDose(e.target.value)} />
                {isDoseOutOfRange && doseRange && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />超出建議範圍 {doseRange[0]}–{doseRange[1]} {drugInfo?.dose_unit}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  濃度 *
                  {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-[10px]">({drugInfo.concentration_unit})</span>}
                </label>
                <Input type="number" step="any" className={`h-9 ${isConcentrationChanged ? 'border-red-500 border-2 focus-visible:ring-red-500' : ''}`}
                  placeholder={drugInfo ? String(drugInfo.concentration) : ''} value={concentration} onChange={(e) => setConcentration(e.target.value)} />
                {isConcentrationChanged && drugInfo && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />與預設濃度不同（預設 {drugInfo.concentration} {drugInfo.concentration_unit}）
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">性別</label>
                <Select value={sex} onValueChange={setSex}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指定</SelectItem>
                    <SelectItem value="male">男</SelectItem>
                    <SelectItem value="female">女</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">身高 (cm)</label>
                <Input type="number" className="h-9" placeholder="例：170" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
            </div>
          )}

          {/* Sex/Height for fixed-dose drugs (still useful for record) */}
          {isFixedDose && (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">性別</label>
                <Select value={sex} onValueChange={setSex}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="未指定" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指定</SelectItem>
                    <SelectItem value="male">男</SelectItem>
                    <SelectItem value="female">女</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">身高 (cm)</label>
                <Input type="number" className="h-9" placeholder="例：170" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleCalculate} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Calculator className="mr-1.5 h-3.5 w-3.5" />}
              計算輸注速率
            </Button>
            {(selectedDrug || weight || targetDose || concentration || sex || height) && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />清除全部
              </Button>
            )}
          </div>

          {/* ─── Result (inline, same card) ─── */}
          {loading && (
            <div className="text-center py-6">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-[#7f265b]" />
              <p className="text-xs text-muted-foreground">計算中...</p>
            </div>
          )}

          {result && (
            <>
              <Separator />

              {/* Fixed-dose result */}
              {result.note && result.rate_ml_hr === 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{drugInfo?.label || result.drug}</span>
                    <Badge variant="secondary" className="text-xs">固定劑量</Badge>
                  </div>
                  <Alert className="py-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <AlertDescription className="text-xs">{result.note}</AlertDescription>
                  </Alert>
                  {result.steps.length > 0 && (
                    <p className="text-xs text-muted-foreground">{result.steps[0]}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Header: drug name + rate hero + secondary stats */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Rate hero */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-[#7f265b]/10 border border-[#7f265b]/20 rounded-lg">
                      <div>
                        <p className="text-[10px] text-muted-foreground leading-tight">輸注速率</p>
                        <p className="text-3xl font-bold text-[#7f265b] leading-none">{result.rate_ml_hr}</p>
                        <p className="text-xs font-medium text-[#7f265b]/70">ml/hr</p>
                      </div>
                    </div>
                    {/* Drug info + secondary */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{drugInfo?.label || result.drug}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{result.weight_basis}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">計算體重</span>
                          <p className="font-medium">{result.dosing_weight_kg} kg</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">每小時劑量</span>
                          <p className="font-medium">{result.dose_per_hr} {doseUnitShort}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">濃度</span>
                          <p className="font-medium">{result.concentration}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Body weight analysis — only show weights relevant to dosing basis */}
                  {result.BMI != null && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs px-1">
                      <span><span className="text-muted-foreground">BMI</span> <span className="font-medium">{result.BMI}</span></span>
                      {result.weight_basis.includes('IBW') && !result.weight_basis.includes('Adj') && (
                        <span><span className="text-muted-foreground">IBW</span> <span className="font-medium">{result.IBW_kg} kg</span></span>
                      )}
                      {result.weight_basis.includes('AdjBW') && (
                        <span><span className="text-muted-foreground">AdjBW</span> <span className="font-medium">{result.AdjBW_kg} kg</span></span>
                      )}
                      <span>
                        <span className="text-muted-foreground">%IBW</span>{' '}
                        <span className="font-medium">{result.pct_IBW}%</span>
                        {result.is_obese && <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">肥胖</Badge>}
                        {!result.is_obese && result.pct_IBW != null && result.pct_IBW < 90 && (
                          <Badge className="ml-1 text-[10px] px-1 py-0 bg-amber-500 hover:bg-amber-600">體重偏低</Badge>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Calculation steps (collapsible) */}
                  {result.steps.length > 0 && (
                    <div>
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setStepsOpen(!stepsOpen)}
                      >
                        {stepsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        計算步驟
                      </button>
                      {stepsOpen && (
                        <ol className="list-decimal list-inside space-y-0.5 text-xs text-muted-foreground mt-1.5 pl-1">
                          {result.steps.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}

                  {result.note && (
                    <div className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground">{result.note}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
