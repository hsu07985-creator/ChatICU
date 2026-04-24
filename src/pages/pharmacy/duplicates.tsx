import { AlertCircle, CheckCircle2, Copy, Loader2, Plus, User, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST } from '../../lib/drug-list';
import { MedicationDuplicateBadges } from '../../components/patient/medication-duplicate-badges';
import {
  checkDuplicateMedications,
  getMedications,
  type DuplicateAlert,
  type DuplicateCheckResolved,
  type Medication,
} from '../../lib/api/medications';
import { selectPharmacyReviewMeds } from '../../lib/medication-scope';
import { type Patient } from '../../lib/api/patients';
import {
  getCachedPatients,
  getCachedPatientsSync,
  subscribePatientsCache,
} from '../../lib/patients-cache';
import { maskPatientName } from '../../lib/utils/patient-name';

const MIN_DRUGS = 2;
const MAX_DRUGS = 30;

// Noise tokens that commonly appear as "generic name" in HIS exports but
// carry no drug information on their own. Seeding the manual duplicate
// checker with these would just waste rows.
const DRUG_LABEL_BLOCKLIST = new Set([
  'compound', 'ml', 'mg', 'mcg', 'gm', 'tab', 'cap', 'inj', 'oint',
  'cream', 'gel', 'injection', 'oral', 'solution', 'syrup', 'patch',
]);

/**
 * Extract the best generic-name guess from a Medication for the manual picker.
 * Returns an empty string when no usable label can be derived — caller must
 * filter these out.
 */
function toDrugLabel(m: Medication): string {
  const isUsable = (s: string | null | undefined): s is string => {
    if (!s) return false;
    const alpha = s.replace(/[^A-Za-z]/g, '');
    if (alpha.length < 4) return false;
    if (DRUG_LABEL_BLOCKLIST.has(s.trim().toLowerCase())) return false;
    return true;
  };

  // 1. Rightmost parenthesised English token ("...(Lansoprazole)" → "Lansoprazole").
  const parens = [...(m.name || '').matchAll(/\(([^)]+)\)/g)]
    .map((x) => x[1].trim())
    .filter((p) => !/^[抗軟]/.test(p) && !/^\d/.test(p) && /[A-Za-z]/.test(p));
  for (let i = parens.length - 1; i >= 0; i--) {
    if (isUsable(parens[i])) return parens[i];
  }

  // 2. Explicit generic field from the API.
  if (isUsable(m.genericName)) return m.genericName as string;

  // 3. Longest alpha run from the brand name — only if ≥ 4 chars and not
  //    a known noise token. Avoids seeding "ML" / "MG" as drug names.
  const alphaRuns = [...(m.name || '').matchAll(/[A-Za-z][A-Za-z\-]{3,}/g)].map((x) => x[0]);
  for (const r of alphaRuns) {
    if (isUsable(r)) return r;
  }

  return '';
}

export function MedicationDuplicatesPage() {
  // ── Patient selector (shared — picking a patient auto-loads their meds) ──
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');

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

  // ── Patient-mode local state (now driven by the same stateless endpoint
  //    as manual mode, just on a scoped med list 住院 + 自備 + 院外) ──
  const [patientAlerts, setPatientAlerts] = useState<DuplicateAlert[]>([]);
  const [patientCounts, setPatientCounts] = useState<Record<string, number>>({});
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState(false);
  const [patientSearched, setPatientSearched] = useState(false);
  const [skippedMeds, setSkippedMeds] = useState<Medication[]>([]);

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
      setPatientAlerts([]);
      setPatientCounts({});
      setPatientError(false);
      setPatientSearched(false);
      setSkippedMeds([]);
      if (!patientId) {
        setDrugs(['', '']);
        return;
      }

      setPatientLoading(true);
      try {
        const resp = await getMedications(patientId, { status: 'active' });
        const { reviewed, skipped } = selectPharmacyReviewMeds(resp.medications || []);
        setSkippedMeds(skipped);

        // Dedup labels for both patient-mode detection and manual prefill,
        // so a patient on multiple brand-name formulations of the same
        // ingredient (e.g. Clopidogrel) doesn't seed duplicate rows.
        const seen = new Set<string>();
        const names: string[] = [];
        for (const m of reviewed) {
          const label = toDrugLabel(m);
          if (!label) continue;
          const key = label.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          names.push(label);
        }
        setDrugs(names.length >= MIN_DRUGS ? names : [...names, ...Array(MIN_DRUGS - names.length).fill('')]);

        if (names.length >= MIN_DRUGS) {
          setPatientSearched(true);
          const res = await checkDuplicateMedications(names.map((name) => ({ name })));
          setPatientAlerts(res.alerts);
          setPatientCounts(res.counts);
        }
      } catch {
        setPatientError(true);
      } finally {
        setPatientLoading(false);
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
      const res = await checkDuplicateMedications(clean.map((name) => ({ name })));
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
    setPatientAlerts([]);
    setPatientCounts({});
    setPatientError(false);
    setPatientSearched(false);
    setSkippedMeds([]);
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">重複用藥偵測</h1>
        <p className="text-muted-foreground text-sm mt-1">
          依病人目前住院用藥清單、或手動輸入藥品清單，偵測同機轉 / 同類藥物 / 同給藥途徑的重複項目
        </p>
      </div>

      {/* 病人選擇器（選病人會自動帶入住院藥 + 自備/院外藥並執行偵測） */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
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
              納入病人目前住院用藥 + 門診中的自備藥 / 院外藥，執行 L1 / L2 / L3 / L4 重複用藥偵測
              {skippedMeds.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  （已排除 {skippedMeds.length} 筆門診常規處方）
                </span>
              )}
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
            ) : !patientSearched ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  納入範圍內的用藥不足 {MIN_DRUGS} 種，無法執行重複用藥偵測。
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
