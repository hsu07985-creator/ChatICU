import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Search, Plus, CheckCircle2, XCircle, HelpCircle, Loader2, X, User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { getIVCompatibility } from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync } from '../../lib/patients-cache';
import { getMedications } from '../../lib/api/medications';
import { DrugCombobox } from '../../components/ui/drug-combobox';

/**
 * Y-Site 相容性藥品清單 — 52 drugs from icu_y_site_compatibility_v2_lookup.json
 * 8 ICU specialty sheets, deduplicated.
 */
const IV_DRUG_LIST: string[] = [
  "Acetylcysteine",
  "Adenosine",
  "Alanyl Glutamine",
  "Albumin",
  "Alprostadil",
  "Alteplase",
  "Amiodarone HCl",
  "Ascorbic Acid",
  "Bumetanide",
  "Calcium Gluconate",
  "Cisatracurium besylate",
  "Cyclosporine",
  "Desmopressin Acetate",
  "Dexmedetomidine HCl",
  "Digoxin",
  "Diltiazem HCl",
  "Dobutamine HCl",
  "Dopamine HCl",
  "Epinephrine HCl",
  "Fentanyl Citrate",
  "Heparin sodium",
  "Hydrocortisone Sodium Succinate",
  "Immune Globulin, Human",
  "Insulin Regular",
  "Isoproterenol HCl",
  "KCl",
  "Ketamine HCl",
  "Ketorolac Tromethamine",
  "Labetalol HCl",
  "Levetiracetam",
  "Lidocaine HCl",
  "Lorazepam",
  "Mannitol",
  "Methylprednisolone Sodium Succinate",
  "MgSO4",
  "Midazolam HCl",
  "NaHCO3",
  "Nicardipine HCl",
  "Nitroglycerin",
  "Norepinephrine bitartrate",
  "Propofol",
  "Somatostatin Acetate",
  "Thiamine HCl",
  "Thiamylal Sodium",
  "Tramadol HCl",
  "Tranexamic Acid",
  "Urokinase",
  "Valproate Sodium",
  "Vasopressin",
  "ZnSO4",
];

// Pre-compute alpha-only lowercase for fuzzy matching patient meds → IV_DRUG_LIST
const IV_DRUG_ALPHA = IV_DRUG_LIST.map(d => ({
  original: d,
  alpha: d.replace(/[^a-zA-Z]/g, '').toLowerCase(),
}));

// Common brand-name → IV_DRUG_LIST generic mappings for ICU drugs
const BRAND_TO_GENERIC: Record<string, string> = {
  dormicum: 'Midazolam HCl',
  ativan: 'Lorazepam',
  diprivan: 'Propofol',
  precedex: 'Dexmedetomidine HCl',
  nimbex: 'Cisatracurium besylate',
  zemuron: 'Rocuronium',  // not in IV_DRUG_LIST but kept for future
  levophed: 'Norepinephrine bitartrate',
  adrenaline: 'Epinephrine HCl',
  bosmin: 'Epinephrine HCl',
  pitressin: 'Vasopressin',
  cordarone: 'Amiodarone HCl',
  cardizem: 'Diltiazem HCl',
  trandate: 'Labetalol HCl',
  solumedrol: 'Methylprednisolone Sodium Succinate',
  keppra: 'Levetiracetam',
  lanoxin: 'Digoxin',
};

function matchIVDrug(medName: string): string | null {
  const lower = medName.toLowerCase();
  const exact = IV_DRUG_LIST.find(d => d.toLowerCase() === lower);
  if (exact) return exact;
  const alpha = medName.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const found = IV_DRUG_ALPHA.find(d => d.alpha === alpha);
  if (found) return found.original;
  // Check brand-name mapping
  const firstWord = lower.split(/[\s(,/]/)[0].replace(/[^a-z]/g, '');
  const brandMatch = BRAND_TO_GENERIC[firstWord];
  if (brandMatch && IV_DRUG_LIST.includes(brandMatch)) return brandMatch;
  // First word prefix (e.g., "Fentanyl 50mcg" → "Fentanyl Citrate")
  if (firstWord.length >= 4) {
    const prefixMatch = IV_DRUG_ALPHA.find(d => d.alpha.startsWith(firstWord));
    if (prefixMatch) return prefixMatch.original;
  }
  return null;
}

type CompatStatus = 'C' | 'I' | '-' | '?';

interface MatrixCell {
  drugA: string;
  drugB: string;
  status: CompatStatus;
  notes?: string;
}

const STATUS_CONFIG: Record<CompatStatus, { label: string; short: string; color: string; bg: string }> = {
  C: { label: '相容 (Compatible)', short: 'C', color: 'text-green-700', bg: 'bg-green-100 border-green-300' },
  I: { label: '不相容 (Incompatible)', short: 'I', color: 'text-red-700', bg: 'bg-red-100 border-red-300' },
  '-': { label: '無資料', short: '-', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
  '?': { label: '查詢中', short: '?', color: 'text-gray-400', bg: 'bg-gray-50 border-gray-200' },
};

const MIN_DRUGS = 2;

export function CompatibilityPage() {
  const [drugs, setDrugs] = useState<string[]>(['', '']);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matrixResults, setMatrixResults] = useState<MatrixCell[]>([]);

  // Patient selector (from shared cache)
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [medsLoading, setMedsLoading] = useState(false);

  // Load patients from shared cache (skip if sync cache hit)
  useEffect(() => {
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { toast.error('無法載入病患列表'); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const handlePatientSelect = useCallback(async (patientId: string) => {
    setSelectedPatientId(patientId);
    if (!patientId) return;
    setMedsLoading(true);
    try {
      const resp = await getMedications(patientId, { status: 'active', limit: 100 });
      const allMeds = resp.medications || [];
      // Try matching by name first, then by genericName as fallback
      const matchedSet = new Set<string>();
      for (const m of allMeds) {
        const byName = m.name ? matchIVDrug(m.name) : null;
        if (byName) { matchedSet.add(byName); continue; }
        const byGeneric = m.genericName ? matchIVDrug(m.genericName) : null;
        if (byGeneric) matchedSet.add(byGeneric);
      }
      const matched = [...matchedSet];

      if (matched.length === 0) {
        toast('該病患目前無可比對的 IV 用藥');
        return;
      }
      const newDrugs = matched.length >= MIN_DRUGS
        ? matched
        : [...matched, ...Array(MIN_DRUGS - matched.length).fill('')];
      setDrugs(newDrugs);
      setMatrixResults([]);
      setHasSearched(false);
      toast.success(`已載入 ${matched.length} 種 IV 用藥`);
    } catch {
      toast.error('載入病患用藥失敗');
    } finally {
      setMedsLoading(false);
    }
  }, []);

  const updateDrug = (index: number, value: string) => {
    setDrugs(prev => prev.map((d, i) => i === index ? value : d));
  };

  const addDrug = () => setDrugs(prev => [...prev, '']);

  const removeDrug = (index: number) => {
    if (drugs.length > MIN_DRUGS) {
      setDrugs(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleSearch = async () => {
    const validDrugs = [...new Set(drugs.map(d => d.trim()).filter(Boolean))];
    if (validDrugs.length < 2) {
      toast.error('請至少選擇兩種不同的藥品');
      return;
    }

    setLoading(true);
    setHasSearched(true);
    const results: MatrixCell[] = [];

    for (let i = 0; i < validDrugs.length; i++) {
      for (let j = i + 1; j < validDrugs.length; j++) {
        try {
          const resp = await getIVCompatibility({ drugA: validDrugs[i], drugB: validDrugs[j] });
          const rows = resp.compatibilities || [];
          if (rows.length > 0) {
            results.push({
              drugA: validDrugs[i],
              drugB: validDrugs[j],
              status: rows[0].compatible ? 'C' : 'I',
              notes: rows[0].notes || undefined,
            });
          } else {
            results.push({ drugA: validDrugs[i], drugB: validDrugs[j], status: '-' });
          }
        } catch {
          results.push({ drugA: validDrugs[i], drugB: validDrugs[j], status: '-' });
        }
      }
    }

    setMatrixResults(results);
    setLoading(false);
  };

  const filledCount = drugs.filter(d => d.trim()).length;
  const pairCount = filledCount >= 2 ? (filledCount * (filledCount - 1)) / 2 : 0;

  // Summary counts
  const summary = useMemo(() => {
    if (matrixResults.length === 0) return null;
    const counts = { C: 0, I: 0, '-': 0 };
    for (const r of matrixResults) {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    }
    return counts;
  }, [matrixResults]);

  // Build matrix grid for display
  const validDrugs = useMemo(() =>
    [...new Set(drugs.map(d => d.trim()).filter(Boolean))],
    [drugs]
  );

  const getCell = useCallback((a: string, b: string): CompatStatus => {
    const cell = matrixResults.find(
      r => (r.drugA === a && r.drugB === b) || (r.drugA === b && r.drugB === a)
    );
    return cell?.status || '?';
  }, [matrixResults]);

  const getCellNotes = useCallback((a: string, b: string): string | undefined => {
    const cell = matrixResults.find(
      r => (r.drugA === a && r.drugB === b) || (r.drugA === b && r.drugB === a)
    );
    return cell?.notes;
  }, [matrixResults]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">相容性檢核</h1>
        <p className="text-muted-foreground text-sm mt-1">Y-Site 靜脈輸注藥物配伍相容性查詢（支援多藥品矩陣）</p>
      </div>

      {/* 搜尋區 */}
      <Card>
        <CardHeader>
          <CardTitle>藥品選擇</CardTitle>
          <CardDescription>選擇至少兩種 IV 藥品，系統將查詢所有兩兩組合的 Y-Site 相容性</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 病患選擇器 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-16 shrink-0">
              <User className="inline h-3.5 w-3.5 mr-1" />
              病患
            </label>
            <div className="flex-1">
              <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={patientsLoading ? '載入中...' : '選擇病患自動帶入 IV 用藥（可選）'} />
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
                onClick={() => {
                  setSelectedPatientId('');
                  setDrugs(['', '']);
                  setMatrixResults([]);
                  setHasSearched(false);
                }}
                aria-label="清除病患選擇"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {medsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              載入病患用藥中...
            </div>
          )}

          <Separator />

          {/* Drug inputs */}
          <div className="space-y-3">
            {drugs.map((drug, index) => (
              <div key={index} className="flex items-center gap-2">
                <label className="text-sm font-medium w-16 shrink-0">藥品 {index + 1}</label>
                <div className="flex-1">
                  <DrugCombobox
                    value={drug}
                    onValueChange={(val) => updateDrug(index, val)}
                    placeholder={`選擇 IV 藥品 ${index + 1}...`}
                    drugList={IV_DRUG_LIST}
                  />
                </div>
                {drugs.length > MIN_DRUGS && (
                  <Button
                    variant="ghost" size="icon"
                    className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeDrug(index)}
                    aria-label={`移除藥品 ${index + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={addDrug}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增藥物
            </Button>
            <span className="text-xs text-muted-foreground">
              已選 {filledCount} 種藥品
              {pairCount > 0 && `，將比對 ${pairCount} 對組合`}
            </span>
          </div>

          <Separator />

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
                setDrugs(['', '']);
                setMatrixResults([]);
                setHasSearched(false);
                setSelectedPatientId('');
              }}
            >
              清除
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 查詢結果 */}
      {hasSearched && !loading && (
        <div className="space-y-4">
          {matrixResults.length === 0 ? (
            <Alert>
              <HelpCircle className="h-4 w-4" />
              <AlertDescription>未找到相關的 Y-Site 相容性資料。建議使用分開的輸注管路。</AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 摘要 */}
              {summary && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>查詢摘要</CardTitle>
                      <span className="text-sm text-muted-foreground">
                        {filledCount} 種藥品，{matrixResults.length} 對組合
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span>相容：<strong>{summary.C}</strong> 對</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-600" />
                        <span>不相容：<strong className="text-red-600">{summary.I}</strong> 對</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <HelpCircle className="h-4 w-4 text-gray-400" />
                        <span>無資料：<strong>{summary['-']}</strong> 對</span>
                      </div>
                    </div>

                    {summary.I > 0 && (
                      <Alert className="mt-3 border-red-200 bg-red-50">
                        <XCircle className="h-4 w-4 text-red-600" />
                        <AlertDescription className="text-red-800">
                          發現 <strong>{summary.I}</strong> 對不相容組合，請勿混合或並行輸注，建議使用不同管路。
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 矩陣表格 */}
              {validDrugs.length >= 2 && (
                <Card>
                  <CardHeader>
                    <CardTitle>相容性矩陣</CardTitle>
                    <CardDescription>
                      <span className="inline-flex items-center gap-1 mr-3"><span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-green-100 text-green-700 border border-green-300">C</span> 相容</span>
                      <span className="inline-flex items-center gap-1 mr-3"><span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-red-100 text-red-700 border border-red-300">I</span> 不相容</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-gray-50 text-gray-500 border border-gray-200">-</span> 無資料</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="text-sm border-collapse">
                      <thead>
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground sticky left-0 bg-background z-10" />
                          {validDrugs.map(d => (
                            <th key={d} className="px-2 py-1.5 text-center font-medium text-xs whitespace-nowrap max-w-[100px] truncate" title={d}>
                              {d.length > 12 ? d.slice(0, 10) + '…' : d}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {validDrugs.map((rowDrug, ri) => (
                          <tr key={rowDrug}>
                            <td className="px-2 py-1.5 font-medium text-xs whitespace-nowrap sticky left-0 bg-background z-10 border-r max-w-[100px] truncate" title={rowDrug}>
                              {rowDrug.length > 12 ? rowDrug.slice(0, 10) + '...' : rowDrug}
                            </td>
                            {validDrugs.map((colDrug, ci) => {
                              if (ri === ci) {
                                return <td key={colDrug} className="px-2 py-1.5 text-center bg-gray-50">—</td>;
                              }
                              const status = ri < ci ? getCell(rowDrug, colDrug) : getCell(colDrug, rowDrug);
                              const notes = ri < ci ? getCellNotes(rowDrug, colDrug) : getCellNotes(colDrug, rowDrug);
                              const cfg = STATUS_CONFIG[status];
                              return (
                                <td
                                  key={colDrug}
                                  className={`px-2 py-1.5 text-center border ${cfg.bg} cursor-default`}
                                  title={`${rowDrug} + ${colDrug}: ${cfg.label}${notes ? ` (${notes})` : ''}`}
                                >
                                  <span className={`font-bold text-xs ${cfg.color}`}>{cfg.short}</span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}

              {/* 詳細不相容列表 */}
              {matrixResults.filter(r => r.status === 'I').length > 0 && (
                <>
                  <h2>不相容組合</h2>
                  <div className="grid gap-3">
                    {matrixResults.filter(r => r.status === 'I').map((r, i) => (
                      <Card key={i} className="border-red-200">
                        <CardContent className="py-3 flex items-center gap-3">
                          <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                          <div>
                            <span className="font-medium">{r.drugA} + {r.drugB}</span>
                            <Badge variant="destructive" className="ml-2 text-xs">不相容</Badge>
                            {r.notes && <p className="text-sm text-muted-foreground mt-0.5">{r.notes}</p>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}

              <p className="text-xs text-muted-foreground">資料來源：陽明院區 Y-site compatibility 資料整理（8 科 ICU）</p>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[var(--color-brand)]" />
          <p className="text-muted-foreground">查詢中...</p>
        </div>
      )}
    </div>
  );
}
