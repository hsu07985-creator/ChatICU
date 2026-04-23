import { AlertCircle, CheckCircle2, Copy, Loader2, Plus, User, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST } from '../../lib/drug-list';
import { MedicationDuplicateBadges } from '../../components/patient/medication-duplicate-badges';
import { useApiQuery } from '../../hooks/use-api-query';
import {
  checkDuplicateMedications,
  getMedicationDuplicates,
  getMedications,
  type DuplicateAlert,
  type DuplicateCheckResolved,
  type Medication,
} from '../../lib/api/medications';
import { type Patient } from '../../lib/api/patients';
import {
  getCachedPatients,
  getCachedPatientsSync,
  subscribePatientsCache,
} from '../../lib/patients-cache';
import { maskPatientName } from '../../lib/utils/patient-name';

type Context = 'inpatient' | 'outpatient' | 'icu' | 'discharge';

const MIN_DRUGS = 2;
const MAX_DRUGS = 30;

/** Extract the best generic-name guess from a Medication for the manual picker. */
function toDrugLabel(m: Medication): string {
  // Prefer parenthesised generic ("Takepron OD 30mg tab(Lansoprazole)" → "Lansoprazole").
  const parens = [...(m.name || '').matchAll(/\(([^)]+)\)/g)]
    .map((x) => x[1].trim())
    .filter((p) => !/^[抗軟]/.test(p) && !/^\d/.test(p));
  if (parens.length > 0) return parens[parens.length - 1];
  if (m.genericName && /^[A-Za-z]/.test(m.genericName)) return m.genericName;
  // Last resort: first alpha run from the brand name.
  const match = (m.name || '').match(/[A-Za-z][A-Za-z\-]+/);
  return match?.[0] ?? m.name;
}

export function MedicationDuplicatesPage() {
  // ── Patient selector (shared — picking a patient auto-loads their meds) ──
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [context, setContext] = useState<Context>('inpatient');

  useEffect(() => {
    if (patients.length > 0) return;
    let cancelled = false;
    getCachedPatients()
      .then((list) => {
        if (!cancelled) {
          setPatients(list);
          setPatientsLoading(false);
        }
      })
      .catch(() => !cancelled && setPatientsLoading(false));
    const unsub = subscribePatientsCache((list) => {
      if (!cancelled) setPatients(list);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [patients.length]);

  // ── Patient-mode: fetch duplicates via the cached per-patient endpoint ──
  const {
    data: patientData,
    isLoading: patientLoading,
    isError: patientError,
  } = useApiQuery<{ alerts: DuplicateAlert[]; counts: Record<string, number> }>({
    queryKey: ['medication-duplicates', selectedPatientId, context],
    queryFn: () => getMedicationDuplicates(selectedPatientId, context),
    enabled: Boolean(selectedPatientId),
    staleTime: 30_000,
    retry: 0,
  });

  // ── Manual mode: user-picked drug list + stateless endpoint ──
  const [drugs, setDrugs] = useState<string[]>(['', '']);
  const [manualAlerts, setManualAlerts] = useState<DuplicateAlert[]>([]);
  const [manualCounts, setManualCounts] = useState<Record<string, number>>({});
  const [manualResolved, setManualResolved] = useState<DuplicateCheckResolved[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSearched, setManualSearched] = useState(false);

  const handlePatientSelect = useCallback(
    async (patientId: string) => {
      setSelectedPatientId(patientId);
      if (!patientId) {
        setDrugs(['', '']);
        return;
      }
      // Populate the manual picker from the patient's active meds so the
      // pharmacist can swap in/out candidates and re-run in manual mode.
      try {
        const resp = await getMedications(patientId, { status: 'active' });
        const names = resp.medications.map(toDrugLabel).filter(Boolean);
        setDrugs(names.length >= MIN_DRUGS ? names : [...names, ...Array(MIN_DRUGS - names.length).fill('')]);
      } catch {
        // non-fatal — manual mode still works
      }
    },
    [],
  );

  const updateDrug = (idx: number, value: string) => {
    setDrugs((prev) => prev.map((d, i) => (i === idx ? value : d)));
  };

  const addDrug = () => {
    if (drugs.length >= MAX_DRUGS) {
      toast.error(`最多 ${MAX_DRUGS} 個藥品`);
      return;
    }
    setDrugs((prev) => [...prev, '']);
  };

  const removeDrug = (idx: number) => {
    setDrugs((prev) => (prev.length <= MIN_DRUGS ? prev : prev.filter((_, i) => i !== idx)));
  };

  const runManualCheck = async () => {
    const clean = drugs.map((d) => d.trim()).filter(Boolean);
    if (clean.length < MIN_DRUGS) {
      toast.error(`請輸入至少 ${MIN_DRUGS} 個藥品`);
      return;
    }
    setManualLoading(true);
    setManualSearched(true);
    try {
      const res = await checkDuplicateMedications(
        clean.map((name) => ({ name })),
        context,
      );
      setManualAlerts(res.alerts);
      setManualCounts(res.counts);
      setManualResolved(res.resolved);
    } catch (e) {
      toast.error('重複用藥偵測失敗，請稍後再試');
      setManualAlerts([]);
      setManualCounts({});
      setManualResolved([]);
    } finally {
      setManualLoading(false);
    }
  };

  const resetAll = () => {
    setSelectedPatientId('');
    setDrugs(['', '']);
    setManualAlerts([]);
    setManualCounts({});
    setManualResolved([]);
    setManualSearched(false);
  };

  // ── Render helpers ──────────────────────────────────────────────────
  const countsBar = (counts: Record<string, number>, total: number) => (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium text-muted-foreground">風險分佈：</span>
      <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">🔴 Critical {counts.critical ?? 0}</span>
      <span className="inline-flex items-center gap-1 text-orange-700 dark:text-orange-400">🟠 High {counts.high ?? 0}</span>
      <span className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-500">🟡 Moderate {counts.moderate ?? 0}</span>
      {(counts.low ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">🔵 Low {counts.low}</span>
      )}
      {(counts.info ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">⚪ Info {counts.info}</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">共 {total} 筆</span>
    </div>
  );

  const patientAlerts = patientData?.alerts ?? [];
  const patientCounts = patientData?.counts ?? {};

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">重複用藥偵測</h1>
        <p className="text-muted-foreground text-sm mt-1">
          依病人目前住院用藥清單、或手動輸入藥品清單，偵測同機轉 / 同類藥物 / 同給藥途徑的重複項目
        </p>
      </div>

      {/* 共用選擇器：context + patient（選病人會自動把其用藥帶入手動區） */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-16 shrink-0">情境</label>
            <div className="w-48">
              <Select value={context} onValueChange={(v) => setContext(v as Context)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inpatient">住院 Inpatient</SelectItem>
                  <SelectItem value="outpatient">門診 Outpatient</SelectItem>
                  <SelectItem value="icu">加護 ICU</SelectItem>
                  <SelectItem value="discharge">出院 Discharge</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-16 shrink-0">
              <User className="inline h-3.5 w-3.5 mr-1" />
              病患
            </label>
            <div className="flex-1">
              <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={patientsLoading ? '載入中...' : '選擇病患（可留空，走手動模式）'} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.bedNumber} — {maskPatientName(p.name)}（{p.medicalRecordNumber}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPatientId && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={resetAll}
                aria-label="清除選擇"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 病人模式結果 */}
      {selectedPatientId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5" />
              病人用藥重複偵測
            </CardTitle>
            <CardDescription>
              依病人目前 active 用藥（情境：{context}）執行 L1 / L2 / L3 / L4 重複用藥偵測
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {patientLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                載入中...
              </div>
            ) : patientError ? (
              <Alert className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-sm text-red-800 dark:text-red-200">
                  重複用藥服務暫時無法使用，請稍後再試。
                </AlertDescription>
              </Alert>
            ) : patientAlerts.length === 0 ? (
              <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-sm text-green-800 dark:text-green-200 font-medium">
                  ✓ 未偵測到重複用藥
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {countsBar(patientCounts, patientAlerts.length)}
                <Separator />
                <MedicationDuplicateBadges alerts={patientAlerts} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 手動模式 — 獨立 Card（無病人也能用；選了病人的話這裡會被自動填入，可再手動調整後重跑） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            手動輸入藥品清單
          </CardTitle>
          <CardDescription>
            輸入至少 {MIN_DRUGS} 個藥品（最多 {MAX_DRUGS}），系統會依 ATC 與機轉比對是否有重複用藥。
            不選病人也可以使用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {drugs.map((drug, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                <div className="flex-1">
                  <DrugCombobox
                    value={drug}
                    onValueChange={(v) => updateDrug(idx, v)}
                    drugList={DRUG_LIST}
                    placeholder="藥品名稱（generic / brand 皆可）"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => removeDrug(idx)}
                  disabled={drugs.length <= MIN_DRUGS}
                  aria-label="移除此藥品"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addDrug} disabled={drugs.length >= MAX_DRUGS}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              新增藥品
            </Button>
            <Button
              onClick={runManualCheck}
              disabled={manualLoading}
              className="ml-auto"
            >
              {manualLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  偵測中...
                </>
              ) : (
                '檢查重複用藥'
              )}
            </Button>
          </div>

          {manualResolved.length > 0 && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 p-3 text-xs space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">藥品 ATC 解析：</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {manualResolved.map((r, i) => (
                  <span key={i} className="text-slate-600 dark:text-slate-400">
                    {r.name} →{' '}
                    <span className={r.atcCode ? 'font-mono' : 'italic text-amber-600 dark:text-amber-400'}>
                      {r.atcCode ?? '無 ATC（藥典未收錄）'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {manualSearched && !manualLoading && (
            <>
              <Separator />
              {manualAlerts.length === 0 ? (
                <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-sm text-green-800 dark:text-green-200 font-medium">
                    ✓ 未偵測到重複用藥
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {countsBar(manualCounts, manualAlerts.length)}
                  <MedicationDuplicateBadges alerts={manualAlerts} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
