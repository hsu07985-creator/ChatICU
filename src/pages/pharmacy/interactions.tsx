import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2, ShieldAlert, Route, X, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { checkInteractions, type InteractionCheckResponse } from '../../lib/api/ai';
import { getDrugInteractions } from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync } from '../../lib/patients-cache';
import { getMedications } from '../../lib/api/medications';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST, hasInteractionData } from '../../lib/drug-list';

interface InteractingMemberGroup {
  group_name: string;
  members: string[];
  exceptions: string[];
  exceptions_note: string;
}

interface DisplayInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
  riskRating: string;
  riskRatingDescription: string;
  severityLabel: string;
  reliabilityRating: string;
  routeDependency: string;
  discussion: string;
  footnotes: string;
  dependencies: string[];
  dependencyTypes: string[];
  interactingMembers: InteractingMemberGroup[];
  pubmedIds: string[];
}

const RISK_RATING_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  X: { label: 'Risk X 避免併用', color: 'text-red-900 dark:text-red-200', bgColor: 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700' },
  D: { label: 'Risk D 考慮調整', color: 'text-orange-900 dark:text-orange-200', bgColor: 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700' },
  C: { label: 'Risk C 監測治療', color: 'text-yellow-900 dark:text-yellow-200', bgColor: 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700' },
  B: { label: 'Risk B 不需處置', color: 'text-green-900 dark:text-green-200', bgColor: 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700' },
  A: { label: 'Risk A 無交互作用', color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-600' },
};

const MIN_DRUGS = 2;

// Pre-compute alpha-only lowercase for Tall Man Lettering matching
const DRUG_LIST_ALPHA = DRUG_LIST.map(d => ({ original: d, alpha: d.replace(/[^a-zA-Z]/g, '').toLowerCase() }));

// Common brand→generic aliases not derivable from parentheses
const DRUG_ALIASES: Record<string, string> = {
  'l-thyroxine': 'Levothyroxine',
  'valproate': 'Valproic Acid and Derivatives',
  'valproic': 'Valproic Acid and Derivatives',
  'piperaci': 'Piperacillin',
  // ICU brand-name aliases
  'brilinta': 'Ticagrelor',
  'clexane': 'Enoxaparin',
  'combivent': 'Ipratropium (Oral Inhalation)',
};

function tryMatch(name: string): string | null {
  const lower = name.toLowerCase();
  // Exact
  const exact = DRUG_LIST.find(d => d.toLowerCase() === lower);
  if (exact) return exact;
  // Alpha-only (Tall Man Lettering)
  const alpha = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const found = DRUG_LIST_ALPHA.find(d => d.alpha === alpha);
  if (found) return found.original;
  // Alias lookup
  const alias = DRUG_ALIASES[lower];
  if (alias) {
    const aliasMatch = DRUG_LIST.find(d => d.toLowerCase() === alias.toLowerCase());
    if (aliasMatch) return aliasMatch;
  }
  // First word prefix (split on space, parens, comma, slash, hyphen-before-digit, plus)
  const firstWord = lower.split(/[\s(,/+]|(?<=[a-z])-(?=\d)/)[0].replace(/[^a-z]/g, '');
  if (firstWord.length >= 3) {
    const prefixMatch = DRUG_LIST_ALPHA.find(d => d.alpha.startsWith(firstWord));
    if (prefixMatch) return prefixMatch.original;
  }
  return null;
}

function matchDrugName(medName: string): string | null {
  // Strip leading bracket tags like [抗血栓], [包], [公費/3價]
  const cleaned = medName.replace(/^\[.*?\]\s*/g, '').replace(/^(發泡錠|包)\s*/g, '');
  // 1-3. Try full name
  const direct = tryMatch(cleaned);
  if (direct) return direct;
  // 4. Extract ALL parenthesized groups, try last (most specific) first
  //    e.g. "SintRIX inj 1gm (抗3)(Ceftriaxone)" → ["抗3", "Ceftriaxone"]
  const allParens = [...cleaned.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim());
  for (let i = allParens.length - 1; i >= 0; i--) {
    const generic = allParens[i];
    // Skip non-drug markers like 抗3, 抗4, 軟袋
    if (/^[抗軟]/.test(generic) || /^\d/.test(generic) || /ml\)$/i.test(generic)) continue;
    // Handle semicolons: "Acetylsalicylic acid; Aspirin; ASA" → try each
    const candidates = generic.includes(';') ? generic.split(';').map(s => s.trim()) : [generic];
    for (const candidate of candidates) {
      const result = tryMatch(candidate);
      if (result) return result;
    }
  }
  return null;
}

export function DrugInteractionsPage() {
  const [drugs, setDrugs] = useState<string[]>(['', '']);
  const [searchResults, setSearchResults] = useState<DisplayInteraction[]>([]);
  const [overallSeverity, setOverallSeverity] = useState<string>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  // Patient selector state (from shared cache)
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [medsLoading, setMedsLoading] = useState(false);

  // Load patient list from shared cache (skip if sync cache hit)
  useEffect(() => {
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { toast.error('無法載入病患列表'); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // When patient is selected, load their active medications
  const handlePatientSelect = useCallback(async (patientId: string) => {
    setSelectedPatientId(patientId);
    if (!patientId) return;

    setMedsLoading(true);
    try {
      const resp = await getMedications(patientId, { status: 'active', limit: 200 });
      const allMeds = resp.medications || [];
      // Try matching on both name and genericName for each medication
      const matchedSet = new Set<string>();
      for (const m of allMeds) {
        const fromName = m.name ? matchDrugName(m.name) : null;
        if (fromName) { matchedSet.add(fromName); continue; }
        const fromGeneric = m.genericName ? matchDrugName(m.genericName) : null;
        if (fromGeneric) matchedSet.add(fromGeneric);
      }
      const matched = [...matchedSet];

      if (matched.length === 0) {
        toast('該病患目前無可比對的用藥');
        return;
      }

      const newDrugs = matched.length >= MIN_DRUGS
        ? matched
        : [...matched, ...Array(MIN_DRUGS - matched.length).fill('')];
      setDrugs(newDrugs);
      setSearchResults([]);
      setHasSearched(false);
      toast.success(`已載入 ${matched.length} 種用藥`);
    } catch {
      toast.error('載入病患用藥失敗');
    } finally {
      setMedsLoading(false);
    }
  }, []);

  const updateDrug = (index: number, value: string) => {
    setDrugs(prev => prev.map((d, i) => i === index ? value : d));
  };

  const addDrug = () => {
    setDrugs(prev => [...prev, '']);
  };

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

    // Helper: query local DB for all pairwise combinations (parallel)
    const queryDatabase = async () => {
      const pairs: Array<[string, string, number, number]> = [];
      for (let i = 0; i < validDrugs.length; i++) {
        for (let j = i + 1; j < validDrugs.length; j++) {
          pairs.push([validDrugs[i], validDrugs[j], i, j]);
        }
      }
      const pairResults = await Promise.all(
        pairs.map(async ([drugA, drugB, i, j]) => {
          try {
            const resp = await getDrugInteractions({ drugA, drugB }, { suppressErrorToast: true });
            return (resp.interactions || []).map((r: any, idx: number) => ({
              id: r.id || `db-int-${i}-${j}-${idx}`,
              drug1: r.drug1 || drugA,
              drug2: r.drug2 || drugB,
              severity: mapSeverity(r.severity || ''),
              mechanism: r.mechanism || '',
              clinicalEffect: r.clinicalEffect || '',
              management: r.management || '',
              references: r.references || '',
              riskRating: r.riskRating || '',
              riskRatingDescription: r.riskRatingDescription || '',
              severityLabel: r.severityLabel || '',
              reliabilityRating: r.reliabilityRating || '',
              routeDependency: r.routeDependency || '',
              discussion: r.discussion || '',
              footnotes: r.footnotes || '',
              dependencies: r.dependencies || [],
              dependencyTypes: r.dependencyTypes || [],
              interactingMembers: r.interactingMembers || [],
              pubmedIds: r.pubmedIds || [],
            }));
          } catch {
            return [];
          }
        })
      );
      return pairResults.flat();
    };

    try {
      // Fire AI and DB queries in parallel — use AI results if available, else DB
      const [aiResult, dbResults] = await Promise.all([
        checkInteractions({ drugList: validDrugs }, { suppressErrorToast: true }).catch(() => null),
        queryDatabase(),
      ]);

      const aiFindings = aiResult?.findings || [];

      if (aiFindings.length > 0) {
        setOverallSeverity(aiResult?.overall_severity || 'none');
        const mapped: DisplayInteraction[] = aiFindings.map((f, idx) => ({
          id: `int-${idx}`,
          drug1: f.drugA || f.drug_a || validDrugs[0],
          drug2: f.drugB || f.drug_b || validDrugs[1],
          severity: mapSeverity(f.severity),
          mechanism: f.mechanism || '',
          clinicalEffect: f.clinical_effect || '',
          management: f.recommended_action || '',
          references: f.dose_adjustment_hint || '',
          riskRating: f.risk_rating || '',
          riskRatingDescription: f.risk_rating_description || '',
          severityLabel: f.severity_label || '',
          reliabilityRating: f.reliability_rating || '',
          routeDependency: f.route_dependency || '',
          discussion: f.discussion || '',
          footnotes: f.footnotes || '',
          dependencies: f.dependencies || [],
          dependencyTypes: f.dependency_types || [],
          interactingMembers: f.interacting_members || [],
          pubmedIds: f.pubmed_ids || [],
        }));
        const riskOrder: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };
        mapped.sort((a, b) => (riskOrder[a.riskRating] ?? 5) - (riskOrder[b.riskRating] ?? 5));
        setSearchResults(mapped);
      } else {
        if (dbResults.length) {
          const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
          const max = dbResults.reduce((acc: string, it: DisplayInteraction) => (rank[it.severity] > rank[acc] ? it.severity : acc), 'low');
          setOverallSeverity(max);
        } else {
          setOverallSeverity('none');
        }
        setSearchResults(dbResults);
      }
    } catch (err) {
      console.error('查詢交互作用失敗:', err);
      toast.error('查詢失敗，請確認後端服務是否正常運行');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewReference = async (ref: string) => {
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

  const mapSeverity = (s?: string): string => {
    if (!s) return 'low';
    const lower = s.toLowerCase();
    if (lower === 'contraindicated' || lower === 'major') return 'high';
    if (lower === 'moderate') return 'medium';
    return 'low';
  };

  const getRiskRatingBadge = (interaction: DisplayInteraction) => {
    const rr = interaction.riskRating;
    if (!rr) {
      return getSeverityBadge(interaction.severity);
    }
    const config = RISK_RATING_CONFIG[rr];
    if (!config) return null;
    return (
      <Badge variant="outline" className={`gap-1 border ${config.bgColor} ${config.color} font-semibold`}>
        <ShieldAlert className="h-3.5 w-3.5" />
        {config.label}
      </Badge>
    );
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />高風險</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="gap-1 bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200"><AlertCircle className="h-3.5 w-3.5" />中風險</Badge>;
      case 'low':
        return <Badge variant="outline" className="gap-1"><Info className="h-3.5 w-3.5" />低風險</Badge>;
      default:
        return null;
    }
  };

  const filledCount = drugs.filter(d => d.trim()).length;
  const pairCount = filledCount >= 2 ? (filledCount * (filledCount - 1)) / 2 : 0;

  // ── 摘要計算 ──
  const summary = useMemo(() => {
    if (searchResults.length === 0) return null;
    const validDrugs = drugs.map(d => d.trim()).filter(Boolean);

    // 風險分佈
    const riskCounts: Record<string, number> = {};
    for (const r of searchResults) {
      const rr = r.riskRating || '?';
      riskCounts[rr] = (riskCounts[rr] || 0) + 1;
    }

    // 最高風險
    const riskOrder = ['X', 'D', 'C', 'B', 'A'];
    const highestRisk = riskOrder.find(r => riskCounts[r]) || '?';

    // 配對速查 — 用輸入的藥物名合併同對、取最高風險
    const pairMap = new Map<string, { a: string; b: string; risk: string; count: number }>();
    for (const item of searchResults) {
      const d1l = (item.drug1 || '').toLowerCase();
      const d2l = (item.drug2 || '').toLowerCase();
      // 建 side1 / side2 名稱集合
      const side1: string[] = [d1l];
      const side2: string[] = [d2l];
      for (const g of item.interactingMembers) {
        const gn = (g.group_name || '').toLowerCase();
        const ms = g.members.map(m => m.toLowerCase());
        if (gn === d1l) side1.push(...ms);
        else if (gn === d2l) side2.push(...ms);
      }
      // 找出匹配的輸入藥物
      let matchA = '';
      let matchB = '';
      for (const drug of validDrugs) {
        const dl = drug.toLowerCase();
        if (!matchA && side1.some(n => n.includes(dl) || dl.includes(n))) matchA = drug;
        if (!matchB && side2.some(n => n.includes(dl) || dl.includes(n))) matchB = drug;
      }
      if (!matchA || !matchB || matchA.toLowerCase() === matchB.toLowerCase()) continue;
      const [sortedA, sortedB] = [matchA, matchB].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
      const key = `${sortedA.toLowerCase()}|${sortedB.toLowerCase()}`;
      const existing = pairMap.get(key);
      const ro: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };
      const curRisk = ro[item.riskRating] ?? 5;
      if (!existing) {
        pairMap.set(key, { a: sortedA, b: sortedB, risk: item.riskRating || '?', count: 1 });
      } else {
        existing.count++;
        if (curRisk < (ro[existing.risk] ?? 5)) existing.risk = item.riskRating;
      }
    }
    const pairs = [...pairMap.values()].sort((a, b) => {
      const ro: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };
      return (ro[a.risk] ?? 5) - (ro[b.risk] ?? 5);
    });

    return { riskCounts, highestRisk, pairs };
  }, [searchResults, drugs]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">交互作用查詢</h1>
        <p className="text-muted-foreground text-sm mt-1">查詢藥物之間的交互作用與處理建議</p>
      </div>

      {/* 搜尋區 */}
      <Card>
        <CardHeader>
          <CardTitle>藥品選擇</CardTitle>
          <CardDescription>選擇至少兩種藥品，系統將自動比對所有兩兩組合的交互作用</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 病患選擇（可選） */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-16 shrink-0">
              <User className="inline h-3.5 w-3.5 mr-1" />
              病患
            </label>
            <div className="flex-1">
              <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={patientsLoading ? '載入中...' : '選擇病患自動帶入用藥（可選）'} />
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
                variant="ghost"
                size="icon"
                className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setSelectedPatientId('');
                  setDrugs(['', '']);
                  setSearchResults([]);
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

          <div className="space-y-3">
            {drugs.map((drug, index) => (
              <div key={index} className="flex items-center gap-2">
                <label className="text-sm font-medium w-16 shrink-0">藥品 {index + 1}</label>
                <div className="flex-1">
                  <DrugCombobox
                    value={drug}
                    onValueChange={(val) => updateDrug(index, val)}
                    placeholder={`選擇藥品 ${index + 1}...`}
                    drugList={DRUG_LIST}
                    checkHasData={hasInteractionData}
                  />
                </div>
                {drugs.length > MIN_DRUGS && (
                  <Button
                    variant="ghost"
                    size="icon"
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

          {/* 新增藥物按鈕 + 提示 */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={addDrug}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增藥物
            </Button>
            <span className="text-xs text-muted-foreground">
              已選 {drugs.length} 種藥品
              {pairCount > 0 && `，將比對 ${pairCount} 對組合`}
            </span>
          </div>

          <Separator />

          {/* 操作按鈕 */}
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
                setSearchResults([]);
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
          {searchResults.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                {overallSeverity === 'none'
                  ? '未發現藥物交互作用。'
                  : '未找到相關的藥物交互作用資料。請確認藥品名稱是否正確。'}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 摘要卡片 */}
              {summary && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5" />
                        查詢摘要
                      </CardTitle>
                      <span className="text-sm text-muted-foreground">
                        查詢 {filledCount} 種藥品，找到 {searchResults.length} 筆交互作用
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 整體風險 */}
                    {RISK_RATING_CONFIG[summary.highestRisk] && (
                      <Alert className={`border ${RISK_RATING_CONFIG[summary.highestRisk].bgColor}`}>
                        <ShieldAlert className={`h-4 w-4 ${RISK_RATING_CONFIG[summary.highestRisk].color}`} />
                        <AlertDescription className={RISK_RATING_CONFIG[summary.highestRisk].color}>
                          <span className="font-semibold">整體最高風險：{RISK_RATING_CONFIG[summary.highestRisk].label}</span>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* 風險分佈 */}
                    <div>
                      <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">風險分佈</h4>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {(['X', 'D', 'C', 'B', 'A'] as const).map(r => {
                          const count = summary.riskCounts[r];
                          if (!count) return null;
                          const cfg = RISK_RATING_CONFIG[r];
                          return (
                            <span key={r} className={cfg?.color || ''}>
                              {cfg?.label || `Risk ${r}`}：{count} 筆
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* 配對速查 */}
                    {summary.pairs.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">配對速查</h4>
                        <div className="border rounded-md overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/40">
                                <th className="text-left px-3 py-1.5 font-medium">藥物配對</th>
                                <th className="text-left px-3 py-1.5 font-medium">最高風險</th>
                                <th className="text-right px-3 py-1.5 font-medium">筆數</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.pairs.map((p, i) => {
                                const cfg = RISK_RATING_CONFIG[p.risk];
                                return (
                                  <tr key={i} className="border-b last:border-0">
                                    <td className="px-3 py-1.5">{p.a} ↔ {p.b}</td>
                                    <td className="px-3 py-1.5">
                                      {cfg ? (
                                        <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-muted-foreground">{p.count}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <h2>詳細交互作用</h2>

              <div className="grid gap-4">
                {searchResults.map((interaction) => (
                  <Card key={interaction.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <CardTitle className="flex items-center gap-2">
                            {interaction.drug1} + {interaction.drug2}
                          </CardTitle>
                          <div className="flex flex-wrap items-center gap-2">
                            {getRiskRatingBadge(interaction)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="查看文獻來源"
                          onClick={() => handleViewReference(interaction.references)}
                        >
                          <BookOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* 給藥途徑警示 */}
                      {interaction.routeDependency && (
                        <Alert className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30">
                          <Route className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <AlertDescription className="text-amber-800 dark:text-amber-200">
                            <span className="font-medium">給藥途徑注意：</span>{interaction.routeDependency}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* 依賴條件 */}
                      {interaction.dependencies.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">依賴條件</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {interaction.dependencies.map((dep, i) => (
                              <Badge key={i} variant="outline" className="text-xs bg-slate-50 dark:bg-slate-800">
                                {dep}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 交互作用藥物群組 */}
                      {interaction.interactingMembers.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">交互作用藥物群組</h4>
                          <div className="space-y-2">
                            {interaction.interactingMembers.map((group, i) => (
                              <div key={i} className="text-sm border rounded-md p-2.5 bg-muted/20">
                                <span className="font-medium text-foreground/90">{group.group_name}</span>
                                {group.members.length > 0 && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    成員：{group.members.join('、')}
                                  </p>
                                )}
                                {group.exceptions.length > 0 && (
                                  <p className="text-xs text-orange-600 mt-1">
                                    例外：{group.exceptions.join('、')}
                                    {group.exceptions_note && ` (${group.exceptions_note})`}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 交互作用說明 */}
                      {interaction.clinicalEffect && (
                        <div>
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">交互作用說明</h4>
                          <p className="text-sm">{interaction.clinicalEffect}</p>
                        </div>
                      )}

                      {/* 處理建議 — 更醒目的底色 */}
                      {interaction.management && (
                        <>
                          <Separator />
                          <div>
                            <h4 className="font-medium mb-2 text-sm text-muted-foreground">臨床處置建議</h4>
                            <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30">
                              <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              <AlertDescription className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed">{interaction.management}</AlertDescription>
                            </Alert>
                          </div>
                        </>
                      )}

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
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-brand" />
          <p className="text-muted-foreground">查詢中...</p>
        </div>
      )}

    </div>
  );
}
