import { Search, Plus, BookOpen, AlertTriangle, AlertCircle, Info, Loader2, ShieldAlert, Route, X, User, ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { checkInteractions, type InteractionCheckResponse } from '../../lib/api/ai';
import { maskPatientName } from '../../lib/utils/patient-name';
import { getDrugInteractions } from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync, subscribePatientsCache } from '../../lib/patients-cache';
import { getMedications, type Medication } from '../../lib/api/medications';
import { selectPharmacyReviewMeds } from '../../lib/medication-scope';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { DrugCombobox } from '../../components/ui/drug-combobox';
import { DRUG_LIST, hasInteractionData } from '../../lib/drug-list';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('pharmacy');
  const [drugs, setDrugs] = useState<string[]>(['', '']);
  const [searchResults, setSearchResults] = useState<DisplayInteraction[]>([]);
  const [overallSeverity, setOverallSeverity] = useState<string>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultSource, setResultSource] = useState<'ai' | 'database'>('database');

  // Patient selector state (from shared cache)
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [medsLoading, setMedsLoading] = useState(false);
  const [skippedMeds, setSkippedMeds] = useState<Medication[]>([]);
  const [skippedExpanded, setSkippedExpanded] = useState(false);

  // Load patient list from shared cache (skip if sync cache hit)
  useEffect(() => {
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { toast.error('無法載入病患列表'); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribePatientsCache((nextPatients) => {
      setPatients(nextPatients);
      setPatientsLoading(false);
    });
  }, []);

  // When patient is selected, load their active medications
  const handlePatientSelect = useCallback(async (patientId: string) => {
    setSelectedPatientId(patientId);
    if (!patientId) return;

    setMedsLoading(true);
    try {
      const resp = await getMedications(patientId, { status: 'active', limit: 200 });
      const allMeds = resp.medications || [];

      const { reviewed, skipped } = selectPharmacyReviewMeds(allMeds);
      setSkippedMeds(skipped);

      // Try matching on both name and genericName for each medication
      const matchedSet = new Set<string>();
      for (const m of reviewed) {
        const fromName = m.name ? matchDrugName(m.name) : null;
        if (fromName) { matchedSet.add(fromName); continue; }
        const fromGeneric = m.genericName ? matchDrugName(m.genericName) : null;
        if (fromGeneric) matchedSet.add(fromGeneric);
      }
      const matched = [...matchedSet];

      if (matched.length === 0) {
        toast(t('interactions.patientPicker.noMeds'));
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
      toast.error(t('common.loadingPatientMeds'));
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
      toast.error(t('interactions.validation.needTwo'));
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
        setResultSource('ai');
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
        setResultSource('database');
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
      console.error(`${t('interactions.validation.queryErrorLog')}:`, err);
      toast.error(t('interactions.validation.queryError'));
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewReference = async (ref: string) => {
    const trimmed = String(ref || '').trim();
    if (!trimmed) {
      toast.message(t('interactions.sourceToast.noLiterature'));
      return;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
      return;
    }
    const ok = await copyToClipboard(trimmed);
    if (ok) toast.success(t('interactions.sourceToast.copySuccess'));
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
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />{t('interactions.risk.high')}</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="gap-1 bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200"><AlertCircle className="h-3.5 w-3.5" />{t('interactions.risk.medium')}</Badge>;
      case 'low':
        return <Badge variant="outline" className="gap-1"><Info className="h-3.5 w-3.5" />{t('interactions.risk.low')}</Badge>;
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
    // Word-boundary matching helpers — replaces previous bidirectional `includes`
    // pollution where `prednisolone` ⊂ `methylprednisolone` collapsed two distinct
    // rows into one summary key. See docs/drug-interactions-substring-bug-and-fix.md §4.1.
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);

    const wordPattern = (name: string): RegExp | null => {
      if (!name) return null;
      const head = isWord(name[0]) ? '\\b' : '';
      const tail = isWord(name[name.length - 1]) ? '\\b' : '';
      return new RegExp(`${head}${escapeRe(name)}${tail}`, 'i');
    };

    const wordMatch = (a: string, b: string): boolean => {
      if (!a || !b) return false;
      if (a === b) return true;
      const pa = wordPattern(a);
      const pb = wordPattern(b);
      return (pa !== null && pa.test(b)) || (pb !== null && pb.test(a));
    };

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
        if (!matchA && side1.some(n => wordMatch(dl, n))) matchA = drug;
        if (!matchB && side2.some(n => wordMatch(dl, n))) matchB = drug;
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
        <h1 className="text-2xl font-bold">{t('interactions.header.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('interactions.header.subtitleDetail')}
        </p>
      </div>

      {/* 共用病患選擇器（Tab 1 / Tab 2 共用） */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium w-16 shrink-0">
              <User className="inline h-3.5 w-3.5 mr-1" />
              {t('common.patient')}
            </label>
            <div className="flex-1">
              <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={patientsLoading ? t('interactions.patientPicker.placeholderLoading') : t('interactions.patientPicker.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {t('interactions.patientPicker.option', {
                        bed: p.bedNumber,
                        name: maskPatientName(p.name),
                        mrn: p.medicalRecordNumber,
                      })}
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
                  setSkippedMeds([]);
                  setSkippedExpanded(false);
                }}
                aria-label={t('interactions.patientPicker.clear')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {medsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('interactions.patientPicker.loadingMeds')}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">

      {/* 搜尋區 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('interactions.drugCard.title')}</CardTitle>
          <CardDescription>{t('interactions.drugCard.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {skippedMeds.length > 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-amber-800 dark:text-amber-300 font-medium hover:bg-amber-100/60 dark:hover:bg-amber-900/40 rounded-md transition-colors"
                onClick={() => setSkippedExpanded(v => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {t('interactions.skipped.outpatient', { count: skippedMeds.length })}
                </span>
                {skippedExpanded
                  ? <ChevronUp className="h-4 w-4 shrink-0" />
                  : <ChevronDown className="h-4 w-4 shrink-0" />
                }
              </button>
              {skippedExpanded && (
                <ul className="px-3 pb-2.5 space-y-1 border-t border-amber-200 dark:border-amber-700 mt-0 pt-2">
                  {skippedMeds.map(m => (
                    <li key={m.id} className="flex items-baseline gap-2 text-amber-700 dark:text-amber-400">
                      <span className="font-medium truncate flex-1">{m.name}</span>
                      {m.prescribingDepartment && (
                        <span className="text-xs text-amber-500 dark:text-amber-500 shrink-0">{m.prescribingDepartment}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            {drugs.map((drug, index) => (
              <div key={index} className="flex items-center gap-2">
                <label className="text-sm font-medium w-16 shrink-0">{t('interactions.drugRow.label', { index: index + 1 })}</label>
                <div className="flex-1">
                  <DrugCombobox
                    value={drug}
                    onValueChange={(val) => updateDrug(index, val)}
                    placeholder={t('interactions.drugRow.placeholder', { index: index + 1 })}
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
                    aria-label={t('interactions.drugRow.removeAria', { index: index + 1 })}
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
              {t('interactions.actions.addDrug')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('interactions.drugCount.selected', { count: drugs.length })}
              {pairCount > 0 && t('interactions.drugCount.willCompare', { count: pairCount })}
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
              {t('interactions.actions.search')}
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
              {t('interactions.actions.clear')}
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
                  ? t('interactions.results.noData')
                  : t('interactions.results.noDataAlt')}
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
                        {t('interactions.summary.title')}
                      </CardTitle>
                      <span className="text-sm text-muted-foreground">
                        {t('interactions.summary.queryStats', { drugs: filledCount, count: searchResults.length })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 整體風險 */}
                    {RISK_RATING_CONFIG[summary.highestRisk] && (
                      <Alert className={`border ${RISK_RATING_CONFIG[summary.highestRisk].bgColor}`}>
                        <ShieldAlert className={`h-4 w-4 ${RISK_RATING_CONFIG[summary.highestRisk].color}`} />
                        <AlertDescription className={RISK_RATING_CONFIG[summary.highestRisk].color}>
                          <span className="font-semibold">{t('interactions.summary.overallRisk', { label: RISK_RATING_CONFIG[summary.highestRisk].label })}</span>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* 風險分佈 */}
                    <div>
                      <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">{t('interactions.summary.riskDistribution')}</h4>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {(['X', 'D', 'C', 'B', 'A'] as const).map(r => {
                          const count = summary.riskCounts[r];
                          if (!count) return null;
                          const cfg = RISK_RATING_CONFIG[r];
                          return (
                            <span key={r} className={cfg?.color || ''}>
                              {t('interactions.summary.riskCount', { label: cfg?.label || `Risk ${r}`, count })}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* 配對速查 */}
                    {summary.pairs.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">{t('interactions.summary.pairLookup')}</h4>
                        <div className="border rounded-md overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/40">
                                <th className="text-left px-3 py-1.5 font-medium">{t('interactions.summary.tableHeaders.pair')}</th>
                                <th className="text-left px-3 py-1.5 font-medium">{t('interactions.summary.tableHeaders.highestRisk')}</th>
                                <th className="text-right px-3 py-1.5 font-medium">{t('interactions.summary.tableHeaders.count')}</th>
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

              {/* 資料來源說明 */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                {resultSource === 'ai' ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 font-medium border border-purple-200 dark:border-purple-700">
                      {t('interactions.source.aiBadge')}
                    </span>
                    <span>{t('interactions.results.aiNote')}</span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 font-medium border border-blue-200 dark:border-blue-700">
                      {t('interactions.source.dbBadge')}
                    </span>
                    <span>{t('interactions.results.dbNote')}</span>
                  </>
                )}
              </div>

              <h2>{t('interactions.results.detailHeading')}</h2>

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
                            {interaction.reliabilityRating && (
                              <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">
                                {t('interactions.detail.evidenceLabel', { rating: interaction.reliabilityRating })}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('interactions.results.viewSourceAria')}
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
                            <span className="font-medium">{t('interactions.results.routeDependencyLabel')}</span>{interaction.routeDependency}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* 依賴條件 */}
                      {interaction.dependencies.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">{t('interactions.results.dependencyConditionsLabel')}</h4>
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
                          <h4 className="font-medium mb-1.5 text-sm text-muted-foreground">{t('interactions.results.interactionGroupsLabel')}</h4>
                          <div className="space-y-2">
                            {interaction.interactingMembers.map((group, i) => (
                              <div key={i} className="text-sm border rounded-md p-2.5 bg-muted/20">
                                <span className="font-medium text-foreground/90">{group.group_name}</span>
                                {group.members.length > 0 && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {t('interactions.detail.membersLabel', { members: group.members.join('、') })}
                                  </p>
                                )}
                                {group.exceptions.length > 0 && (
                                  <p className="text-xs text-orange-600 mt-1">
                                    {t('interactions.detail.exceptionsLabel', { exceptions: group.exceptions.join('、') })}
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
                          <h4 className="font-medium mb-1 text-sm text-muted-foreground">{t('interactions.results.interactionDescriptionLabel')}</h4>
                          <p className="text-sm">{interaction.clinicalEffect}</p>
                        </div>
                      )}

                      {/* 處理建議 — 更醒目的底色 */}
                      {interaction.management && (
                        <>
                          <Separator />
                          <div>
                            <h4 className="font-medium mb-2 text-sm text-muted-foreground">{t('interactions.results.clinicalManagementLabel')}</h4>
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
          <p className="text-muted-foreground">{t('interactions.results.loading')}</p>
        </div>
      )}

      </div>

    </div>
  );
}
