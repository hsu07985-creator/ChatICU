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
import { padCalculate, type PadDrugInfo, type PadCalculateResult } from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync } from '../../lib/patients-cache';
import { getCachedPadDrugs, getCachedPadDrugsSync } from '../../lib/pad-drugs-cache';
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
  // Drug catalog (from shared cache)
  const [padDrugs, setPadDrugs] = useState<PadDrugInfo[]>(getCachedPadDrugsSync() ?? []);
  const [drugsLoading, setDrugsLoading] = useState(!getCachedPadDrugsSync());

  // Patient selector (from shared cache)
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState('');

  // Input
  const [selectedDrug, setSelectedDrug] = useState('');
  const [weight, setWeight] = useState('');
  const [targetDoseMin, setTargetDoseMin] = useState('');
  const [targetDoseMax, setTargetDoseMax] = useState('');
  const [concentration, setConcentration] = useState('');
  const [sex, setSex] = useState('');
  const [height, setHeight] = useState('');

  // Result (min/max pair)
  const [resultMin, setResultMin] = useState<PadCalculateResult | null>(null);
  const [resultMax, setResultMax] = useState<PadCalculateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  // Selected drug info helper
  const drugInfo = padDrugs.find(d => d.key === selectedDrug);

  // Dose range validation
  const doseRange = useMemo(() => parseDoseRange(drugInfo?.dose_range), [drugInfo]);
  const targetDoseMinNum = targetDoseMin ? parseFloat(targetDoseMin) : NaN;
  const targetDoseMaxNum = targetDoseMax ? parseFloat(targetDoseMax) : NaN;
  const isDoseMinOutOfRange = doseRange && !isNaN(targetDoseMinNum) && targetDoseMinNum > 0 &&
    (targetDoseMinNum < doseRange[0] || targetDoseMinNum > doseRange[1]);
  const isDoseMaxOutOfRange = doseRange && !isNaN(targetDoseMaxNum) && targetDoseMaxNum > 0 &&
    (targetDoseMaxNum < doseRange[0] || targetDoseMaxNum > doseRange[1]);

  // Clamp: min dose stays within [floor, ceiling], max dose stays within [floor, ceiling]
  const handleDoseMinBlur = useCallback(() => {
    if (!doseRange || !targetDoseMin) return;
    const val = parseFloat(targetDoseMin);
    if (isNaN(val)) return;
    const clamped = Math.min(Math.max(val, doseRange[0]), doseRange[1]);
    if (clamped !== val) setTargetDoseMin(String(clamped));
  }, [doseRange, targetDoseMin]);
  const handleDoseMaxBlur = useCallback(() => {
    if (!doseRange || !targetDoseMax) return;
    const val = parseFloat(targetDoseMax);
    if (isNaN(val)) return;
    const clamped = Math.min(Math.max(val, doseRange[0]), doseRange[1]);
    if (clamped !== val) setTargetDoseMax(String(clamped));
  }, [doseRange, targetDoseMax]);

  // Smart step: based on the magnitude of the dose range minimum
  const doseStep = useMemo(() => {
    if (!doseRange) return 0.01;
    const minVal = doseRange[0];
    if (minVal >= 1) return 0.1;
    if (minVal >= 0.1) return 0.01;
    return 0.001;
  }, [doseRange]);

  // Concentration deviation check
  const isConcentrationChanged = drugInfo &&
    concentration !== '' &&
    (() => {
      const val = parseFloat(concentration);
      if (drugInfo.concentration_range) {
        return val < drugInfo.concentration_range[0] || val > drugInfo.concentration_range[1];
      }
      return val !== drugInfo.concentration;
    })();

  // Load PAD drugs + patients from shared cache (skip if sync cache hit)
  useEffect(() => {
    let cancelled = false;
    if (!getCachedPadDrugsSync()) {
      getCachedPadDrugs()
        .then(drugs => { if (!cancelled) { setPadDrugs(drugs); setDrugsLoading(false); } })
        .catch(() => { if (!cancelled) setDrugsLoading(false); });
    }
    if (!getCachedPatientsSync()) {
      getCachedPatients()
        .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
        .catch(() => { if (!cancelled) { toast.error('無法載入病患列表'); setPatientsLoading(false); } });
    }
    return () => { cancelled = true; };
  }, []);

  // Drug switch: pre-fill dose range + concentration, clear results
  const handleDrugChange = useCallback((drugKey: string) => {
    setSelectedDrug(drugKey);
    setResultMin(null);
    setResultMax(null);
    setStepsOpen(false);
    const info = padDrugs.find(d => d.key === drugKey);
    if (info) {
      setConcentration(String(info.concentration));
      const range = parseDoseRange(info.dose_range);
      if (range) {
        setTargetDoseMin(String(range[0]));
        setTargetDoseMax(String(range[1]));
      } else {
        setTargetDoseMin('');
        setTargetDoseMax('');
      }
    } else {
      setTargetDoseMin('');
      setTargetDoseMax('');
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
    setTargetDoseMin('');
    setTargetDoseMax('');
    setConcentration('');
    setSex('');
    setHeight('');
    setSelectedPatientId('');
    setResultMin(null);
    setResultMax(null);
    setStepsOpen(false);
  }, []);

  const isFixedDose = drugInfo?.weight_basis === 'fixed';

  const handleCalculate = async () => {
    if (!selectedDrug) { toast.error('請選擇藥品'); return; }
    if (!weight || parseFloat(weight) <= 0) { toast.error('請輸入體重'); return; }
    if (!isFixedDose && (!targetDoseMin || parseFloat(targetDoseMin) < 0)) { toast.error('請輸入最小目標劑量'); return; }
    if (!isFixedDose && (!targetDoseMax || parseFloat(targetDoseMax) < 0)) { toast.error('請輸入最大目標劑量'); return; }
    if (!isFixedDose && (!concentration || parseFloat(concentration) <= 0)) { toast.error('請輸入藥物濃度'); return; }

    setLoading(true);
    try {
      // Clamp doses to allowed range before sending
      let clampedMin = parseFloat(targetDoseMin);
      let clampedMax = parseFloat(targetDoseMax);
      if (doseRange) {
        clampedMin = Math.max(clampedMin, doseRange[0]);
        clampedMax = Math.min(clampedMax, doseRange[1]);
        setTargetDoseMin(String(clampedMin));
        setTargetDoseMax(String(clampedMax));
      }
      const common = {
        drug: selectedDrug,
        weight_kg: parseFloat(weight),
        concentration: isFixedDose ? (drugInfo?.concentration || 1) : parseFloat(concentration),
        sex: (sex && sex !== 'none') ? sex : undefined,
        height_cm: height ? parseFloat(height) : undefined,
      };
      if (isFixedDose) {
        const res = await padCalculate({ ...common, target_dose_per_kg_hr: 0 });
        setResultMin(res);
        setResultMax(null);
      } else {
        const [resMin, resMax] = await Promise.all([
          padCalculate({ ...common, target_dose_per_kg_hr: clampedMin }),
          padCalculate({ ...common, target_dose_per_kg_hr: clampedMax }),
        ]);
        setResultMin(resMin);
        setResultMax(resMax);
      }
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
        <h1 className="text-2xl font-bold">劑量計算與建議</h1>
        <p className="text-muted-foreground text-sm mt-0.5">ICU PAD 藥物輸注速率計算（含肥胖體重調整）</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">PAD 藥物劑量計算</CardTitle>
          <CardDescription className="text-xs">選擇藥品、輸入體重與目標劑量，系統自動計算輸注速率 (ml/hr)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Row 1: Patient + Drug + Weight (3-col desktop) */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                <User className="inline h-3 w-3 mr-0.5" />病患（可選）
              </label>
              <div className="flex gap-1">
                <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={patientsLoading ? '載入...' : '選擇病患帶入體重/身高'} />
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
              <Input type="number" className="h-9 bg-muted/50" placeholder="選擇病患自動帶入" value={weight} readOnly tabIndex={-1} />
            </div>
          </div>

          {/* Drug info summary bar */}
          {drugInfo && !isFixedDose && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md text-xs">
              <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">{drugInfo.label}</Badge>
              <span className="text-muted-foreground">建議範圍</span>
              <span className="font-medium">{drugInfo.dose_range} {drugInfo.dose_unit}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">{drugInfo.concentration_range ? '允許濃度' : '預設濃度'}</span>
              <span className="font-medium">{drugInfo.concentration_range ? `${drugInfo.concentration_range[0]}–${drugInfo.concentration_range[1]}` : drugInfo.concentration} {drugInfo.concentration_unit}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">計算基準</span>
              <span className="font-medium">{drugInfo.weight_basis}</span>
            </div>
          )}

          {/* Fixed dose alert */}
          {isFixedDose && drugInfo && (
            <Alert className="py-2">
              <AlertDescription className="text-xs leading-relaxed">
                <strong>{drugInfo.label}</strong> 為固定劑量藥物（非體重依賴），建議劑量：{drugInfo.dose_range}。不需輸入目標劑量與濃度。
              </AlertDescription>
            </Alert>
          )}

          {/* Row 2: Target dose min/max + Concentration + Height */}
          {!isFixedDose && (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  最小劑量 *
                  {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.dose_unit})</span>}
                </label>
                <Input type="number" step={doseStep} className="h-9"
                  min={doseRange ? doseRange[0] : undefined}
                  max={doseRange ? doseRange[1] : undefined}
                  placeholder={doseRange ? String(doseRange[0]) : ''} value={targetDoseMin}
                  onChange={(e) => setTargetDoseMin(e.target.value)} onBlur={handleDoseMinBlur} />
                {doseRange && (
                  <p className="text-xs text-muted-foreground">範圍 {doseRange[0]}–{doseRange[1]}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  最大劑量 *
                  {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.dose_unit})</span>}
                </label>
                <Input type="number" step={doseStep} className="h-9"
                  min={doseRange ? doseRange[0] : undefined}
                  max={doseRange ? doseRange[1] : undefined}
                  placeholder={doseRange ? String(doseRange[1]) : ''} value={targetDoseMax}
                  onChange={(e) => setTargetDoseMax(e.target.value)} onBlur={handleDoseMaxBlur} />
                {doseRange && (
                  <p className="text-xs text-muted-foreground">範圍 {doseRange[0]}–{doseRange[1]}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  濃度 *
                  {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.concentration_unit})</span>}
                </label>
                <Input type="number" step="any" className={`h-9 ${isConcentrationChanged ? 'border-red-500 border-2 focus-visible:ring-red-500' : ''}`}
                  placeholder={drugInfo ? String(drugInfo.concentration) : ''} value={concentration} onChange={(e) => setConcentration(e.target.value)} />
                {isConcentrationChanged && drugInfo && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {drugInfo.concentration_range
                      ? `超出允許範圍（${drugInfo.concentration_range[0]}–${drugInfo.concentration_range[1]} ${drugInfo.concentration_unit}）`
                      : `與預設濃度不同（預設 ${drugInfo.concentration} ${drugInfo.concentration_unit}）`}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">身高 (cm)</label>
                <Input type="number" className="h-9 bg-muted/50" placeholder="選擇病患自動帶入" value={height} readOnly tabIndex={-1} />
              </div>
            </div>
          )}

          {/* Height for fixed-dose drugs */}
          {isFixedDose && (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">身高 (cm)</label>
                <Input type="number" className="h-9 bg-muted/50" placeholder="選擇病患自動帶入" value={height} readOnly tabIndex={-1} />
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleCalculate} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Calculator className="mr-1.5 h-3.5 w-3.5" />}
              計算輸注速率
            </Button>
            {(selectedDrug || weight || targetDoseMin || targetDoseMax || concentration || sex || height) && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />清除全部
              </Button>
            )}
          </div>

          {/* ─── Result (inline, same card) ─── */}
          {loading && (
            <div className="text-center py-6">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-brand" />
              <p className="text-xs text-muted-foreground">計算中...</p>
            </div>
          )}

          {resultMin && (
            <>
              <Separator />

              {/* Fixed-dose result */}
              {resultMin.note && resultMin.rate_ml_hr === 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{drugInfo?.label || resultMin.drug}</span>
                    <Badge variant="secondary" className="text-xs">固定劑量</Badge>
                  </div>
                  <Alert className="py-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <AlertDescription className="text-xs leading-relaxed">{resultMin.note}</AlertDescription>
                  </Alert>
                  {resultMin.steps.length > 0 && (
                    <p className="text-xs text-muted-foreground">{resultMin.steps[0]}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Drug name + weight basis */}
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{drugInfo?.label || resultMin.drug}</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0">{resultMin.weight_basis}</Badge>
                  </div>

                  {/* Rate hero: min–max range */}
                  <div className="flex items-stretch gap-0 rounded-lg overflow-hidden border border-brand/20">
                    <div className="flex-1 px-4 py-3 bg-brand/10 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight mb-1">{resultMax ? '最小速率' : '輸注速率'}</p>
                      <p className="text-3xl font-bold text-brand leading-none">{resultMin.rate_ml_hr}</p>
                      <p className="text-xs font-medium text-brand/70 mt-0.5">ml/hr</p>
                    </div>
                    {resultMax && (
                      <>
                        <div className="flex items-center bg-brand/5 px-2">
                          <span className="text-xl text-brand/40 font-light">→</span>
                        </div>
                        <div className="flex-1 px-4 py-3 bg-brand/10 text-center">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight mb-1">最大速率</p>
                          <p className="text-3xl font-bold text-brand leading-none">{resultMax.rate_ml_hr}</p>
                          <p className="text-xs font-medium text-brand/70 mt-0.5">ml/hr</p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Secondary stats */}
                  <div className="grid grid-cols-3 gap-3 text-xs bg-muted/30 rounded-md px-3 py-2">
                    <div>
                      <span className="text-muted-foreground">計算體重</span>
                      <p className="font-semibold">{resultMin.dosing_weight_kg} kg</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">每小時劑量</span>
                      <p className="font-semibold">
                        {resultMin.dose_per_hr}{resultMax ? ` – ${resultMax.dose_per_hr}` : ''} {doseUnitShort}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">濃度</span>
                      <p className="font-semibold">{resultMin.concentration}</p>
                    </div>
                  </div>

                  {/* Body weight analysis — only show weights relevant to dosing basis */}
                  {resultMin.BMI != null && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs px-1">
                      <span><span className="text-muted-foreground">BMI</span> <span className="font-medium">{resultMin.BMI}</span></span>
                      {resultMin.weight_basis.includes('IBW') && !resultMin.weight_basis.includes('Adj') && (
                        <span><span className="text-muted-foreground">IBW</span> <span className="font-medium">{resultMin.IBW_kg} kg</span></span>
                      )}
                      {resultMin.weight_basis.includes('AdjBW') && (
                        <span><span className="text-muted-foreground">AdjBW</span> <span className="font-medium">{resultMin.AdjBW_kg} kg</span></span>
                      )}
                      <span>
                        <span className="text-muted-foreground">%IBW</span>{' '}
                        <span className="font-medium">{resultMin.pct_IBW}%</span>
                        {resultMin.is_obese && <Badge variant="destructive" className="ml-1 text-xs px-1 py-0">肥胖</Badge>}
                        {!resultMin.is_obese && resultMin.pct_IBW != null && resultMin.pct_IBW < 90 && (
                          <Badge className="ml-1 text-xs px-1 py-0 bg-amber-500 hover:bg-amber-600">體重偏低</Badge>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Calculation steps (collapsible) — show min steps */}
                  {resultMin.steps.length > 0 && (
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
                          {resultMin.steps.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}

                  {resultMin.note && (
                    <div className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground">{resultMin.note}</span>
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
