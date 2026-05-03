import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Patient as ApiPatient } from '../../lib/api/patients';
import {
  getCachedPatients,
  getCachedPatientsSync,
  isPatientsCacheFresh,
  subscribePatientsCache,
} from '../../lib/patients-cache';
import { getCachedPadDrugs } from '../../lib/pad-drugs-cache';
import { normalizePatientGender } from '../../lib/patient-gender';
import { maskPatientName } from '../../lib/utils/patient-name';
import { useAuth } from '../../lib/auth-context';
import { getLatestLabData, type LabData as ApiLabData } from '../../lib/api/lab-data';
import { getLatestVitalSigns, type VitalSigns as ApiVitalSigns } from '../../lib/api/vital-signs';
import { checkInteractions, polishClinicalText, type PatientContext } from '../../lib/api/ai';
import { createAdviceRecord, getDrugInteractions, getIVCompatibilityBatch, padCalculate, type PadDrugInfo } from '../../lib/api/pharmacy';
import {
  getMedications,
  fetchPharmacyDuplicateSummary,
  getMedicationDuplicates,
  type DuplicateAlert,
  type DuplicateSeverityCounts,
} from '../../lib/api/medications';
import { useApiQuery } from '../../hooks/use-api-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ScrollArea } from '../../components/ui/scroll-area';
import { ButtonLoadingIndicator } from '../../components/ui/button-loading-indicator';
import { AssessmentResultsPanel } from './workstation/assessment-results-panel';
import { PharmacyReportView } from './workstation/pharmacy-report-view';
import { AdviceSubmitDialog } from './workstation/advice-submit-dialog';
import {
  adviceCategories,
  type AssessmentResults,
  type CompatibilitySummary,
  type DosageResult,
  type DrugInteraction,
  type DuplicateSummary,
  type ExpandedSections,
  type ExtendedPatientData,
  type IVCompatibility,
} from './workstation/types';
import {
  Plus,
  X,
  Info,
  Pill,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

// Wave 5b: inline per-patient duplicate-medication severity badge. Only
// renders non-zero buckets so the Select row stays compact. Intentionally
// small (text-[10px]) so it fits inside <SelectItem> without pushing the
// main label.
function DuplicateCountsBadge({
  counts,
  computing = false,
}: {
  counts?: DuplicateSeverityCounts;
  computing?: boolean;
}) {
  const { t } = useTranslation('pharmacy');
  // P1-D5 follow-up: when backend is still warming the cache (computing=true),
  // show a neutral "計算中" placeholder so the UI doesn't render "0 critical"
  // (a misleading clean bill of health) on a fresh patient that may actually
  // have RAAS-blockade or other critical duplicates.
  if (computing) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] leading-none rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5 font-medium"
        aria-label={t('workstation.duplicateBadge.computing')}
      >
        ⏳ {t('workstation.assess.computing')}
      </span>
    );
  }
  if (!counts) return null;
  const { critical, high, moderate, low } = counts;
  if (!critical && !high && !moderate && !low) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] leading-none" aria-label={t('workstation.duplicateBadge.warning')}>
      {critical > 0 && (
        <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 font-medium">
          🔴 {critical}
        </span>
      )}
      {high > 0 && (
        <span className="rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 font-medium">
          🟠 {high}
        </span>
      )}
      {moderate > 0 && (
        <span className="rounded-full bg-yellow-100 text-yellow-700 px-1.5 py-0.5 font-medium">
          🟡 {moderate}
        </span>
      )}
      {low > 0 && (
        <span className="rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 font-medium">
          🔵 {low}
        </span>
      )}
    </span>
  );
}

export function PharmacyWorkstationPage() {
  const { t } = useTranslation('pharmacy');
  const { user } = useAuth();
  const navigate = useNavigate();

  // 病患列表（從共用快取載入）
  const [patients, setPatients] = useState<ApiPatient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());
  const [patientsError, setPatientsError] = useState<string | null>(null);

  useEffect(() => {
    // Skip if sync cache already populated initial state
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { setPatientsError(t('workstation.patientSelect.loadError')); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribePatientsCache((nextPatients) => {
      setPatients(nextPatients);
      setPatientsLoading(false);
    });
  }, []);

  // Wave 5b: batched duplicate-medication severity counts for the patient
  // dropdown. Key is derived from the sorted patient id list so adding or
  // removing a patient refetches; staleTime keeps the first-click snappy.
  const patientIdsKey = patients.map(p => p.id).sort().join(',');
  const { data: duplicateSummary } = useApiQuery<
    Awaited<ReturnType<typeof fetchPharmacyDuplicateSummary>>
  >({
    queryKey: ['pharmacy-duplicate-summary', patientIdsKey],
    queryFn: () => fetchPharmacyDuplicateSummary(patients.map(p => p.id)),
    enabled: patients.length > 0,
    staleTime: 60_000,
  });

  // 病患選擇
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const selectedPatient = selectedPatientId
    ? (patients.find(p => p.id === selectedPatientId) ?? null)
    : null;
  const [hepaticFunction, setHepaticFunction] = useState<ExtendedPatientData['hepaticFunction']>('normal');
  const [latestLab, setLatestLab] = useState<ApiLabData | null>(null);
  const [latestVital, setLatestVital] = useState<ApiVitalSigns | null>(null);

  // 當選擇病患時載入最新檢驗/生命徵象，提供 eGFR/血壓等臨床參數
  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      if (!selectedPatientId) {
        setLatestLab(null);
        setLatestVital(null);
        return;
      }
      try {
        const lab = await getLatestLabData(selectedPatientId);
        if (!cancelled) setLatestLab((lab as ApiLabData) || null);
      } catch {
        if (!cancelled) setLatestLab(null);
      }
      try {
        const vital = await getLatestVitalSigns(selectedPatientId);
        if (!cancelled) setLatestVital((vital as ApiVitalSigns) || null);
      } catch {
        if (!cancelled) setLatestVital(null);
      }
    };
    loadContext();
    return () => { cancelled = true; };
  }, [selectedPatientId]);

  const extendedData: ExtendedPatientData | null = selectedPatient ? {
    height: selectedPatient.height ?? null,
    weight: selectedPatient.weight ?? null,
    egfr: latestLab?.biochemistry?.eGFR?.value ?? null,
    hepaticFunction,
    sbp: latestVital?.bloodPressure?.systolic ?? null,
    hr: latestVital?.heartRate ?? null,
    rr: latestVital?.respiratoryRate ?? null,
    k: latestLab?.biochemistry?.K?.value ?? null,
  } : null;

  // 藥品列表
  const [drugList, setDrugList] = useState<string[]>([]);
  // name → atcCode for PAD/class matching. Populated from loadActiveMeds().
  // Lookup happens by case-insensitive trim match against this map.
  const [drugAtcByName, setDrugAtcByName] = useState<Record<string, string>>({});
  const [currentDrug, setCurrentDrug] = useState('');

  // 評估結果
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);

  // 用藥建議表單
  const [adviceContent, setAdviceContent] = useState('');
  const [isPolishingAdvice, setIsPolishingAdvice] = useState(false);

  // 用藥建議送出對話框
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedAdviceCode, setSelectedAdviceCode] = useState<string>('');

  // 檢視模式：assessment（評估詳情）或 report（結構化報告）
  const [viewMode, setViewMode] = useState<'assessment' | 'report'>('assessment');

  // 當選擇病患時，自動載入病患用藥
  useEffect(() => {
    let cancelled = false;
    const loadActiveMeds = async () => {
      if (!selectedPatient) return;
      try {
        const resp = await getMedications(selectedPatient.id, { status: 'active', limit: 200 });
        const meds = resp.medications || [];
        const names = meds.map(m => m.name).filter(Boolean);
        const unique = Array.from(new Set(names));
        // Build name → atcCode lookup for downstream PAD matcher (PR-1 ATC enrichment).
        const atcMap: Record<string, string> = {};
        for (const m of meds) {
          if (m.name && m.atcCode) {
            atcMap[m.name.trim().toLowerCase()] = m.atcCode;
          }
        }
        if (!cancelled) {
          setDrugList(unique);
          setDrugAtcByName(atcMap);
        }
      } catch (err) {
        console.error(`${t('workstation.drugList.loadOrdersErrorLog')}:`, err);
        const sedation = selectedPatient.sedation || selectedPatient.sanSummary?.sedation || [];
        const analgesia = selectedPatient.analgesia || selectedPatient.sanSummary?.analgesia || [];
        const nmb = selectedPatient.nmb || selectedPatient.sanSummary?.nmb || [];
        const patientMeds = [...sedation, ...analgesia, ...nmb].filter(Boolean);
        if (!cancelled) setDrugList(patientMeds);
        toast.message(t('workstation.drugList.ordersFallback'));
      } finally {
        if (!cancelled) {
          setAssessmentResults(null);
          setHepaticFunction('normal');
        }
      }
    };
    loadActiveMeds();
    return () => { cancelled = true; };
  }, [selectedPatient]);

  // 新增藥品
  const handleAddDrug = () => {
    if (currentDrug.trim() && !drugList.includes(currentDrug.trim())) {
      setDrugList([...drugList, currentDrug.trim()]);
      setCurrentDrug('');
      setAssessmentResults(null); // 重置評估結果
    }
  };

  // 移除藥品
  const handleRemoveDrug = (drug: string) => {
    setDrugList(drugList.filter(d => d !== drug));
    setAssessmentResults(null); // 重置評估結果
  };

  const handleComprehensiveAssessment = async () => {
    if (drugList.length === 0) {
      toast.error(t('workstation.drugList.addError'));
      return;
    }

    if (!selectedPatient) {
      toast.error(t('workstation.drugList.needPatient'));
      return;
    }

    setIsAssessing(true);
    try {
      const uniqueDrugs = Array.from(new Set(drugList.map(d => d.trim()).filter(Boolean)));
      const mapSeverity = (s?: string): 'high' | 'medium' | 'low' => {
        if (!s) return 'low';
        const v = s.toLowerCase();
        if (v === 'contraindicated' || v === 'major' || v === 'high') return 'high';
        if (v === 'moderate' || v === 'medium') return 'medium';
        return 'low';
      };

      const hepaticMap: Record<ExtendedPatientData['hepaticFunction'], string | undefined> = {
        normal: undefined,
        mild: 'child_pugh_a',
        moderate: 'child_pugh_b',
        severe: 'child_pugh_c',
      };

      const patientContext: PatientContext = {
        age_years: selectedPatient.age,
        height_cm: extendedData?.height ?? undefined,
        weight_kg: extendedData?.weight ?? undefined,
        sex: normalizePatientGender(selectedPatient.gender),
        crcl_ml_min: extendedData?.egfr ?? undefined,
        hepatic_class: hepaticMap[extendedData?.hepaticFunction || 'normal'],
        sbp_mmHg: extendedData?.sbp ?? undefined,
        hr_bpm: extendedData?.hr ?? undefined,
        rr_bpm: extendedData?.rr ?? undefined,
        k_mmol_l: extendedData?.k ?? undefined,
      };

      // ── Helper functions ──
      const mapRiskRating = (r?: string): DrugInteraction['riskRating'] | undefined => {
        if (!r) return undefined;
        const v = r.toUpperCase().trim();
        if (v === 'X' || v === 'D' || v === 'C' || v === 'B' || v === 'A') return v;
        return undefined;
      };

      // ── Run all 4 tasks in parallel ──
      const [interactions, { compatibility, compatibilitySummary, limitedPairsCount }, dosage, duplicateResult] = await Promise.all([
        // Task 1: Interactions
        (async (): Promise<DrugInteraction[]> => {
          try {
            const res = await checkInteractions(
              { drugList: uniqueDrugs, patientContext },
              { suppressErrorToast: true },
            );
            return (res.findings || [])
              .map((f, idx) => ({
                id: `int_${idx}`,
                drugA: f.drugA || f.drug_a || '',
                drugB: f.drugB || f.drug_b || '',
                severity: mapSeverity(f.severity),
                description: f.clinical_effect || f.mechanism || '',
                mechanism: f.mechanism || '',
                clinicalEffect: f.clinical_effect || '',
                management: f.recommended_action || '',
                references: f.dose_adjustment_hint || (Array.isArray(f.monitoring) ? f.monitoring.join('、') : ''),
                riskRating: mapRiskRating(f.risk_rating),
                riskRatingDescription: f.risk_rating_description || '',
                reliabilityRating: f.reliability_rating || '',
                routeDependency: f.route_dependency || '',
                discussion: f.discussion || '',
                dependencies: f.dependencies || [],
                pubmedIds: f.pubmed_ids || [],
              }))
              .filter(x => x.drugA && x.drugB);
          } catch (err) {
            console.warn('Evidence 交互作用引擎不可用，改用本地資料庫查詢', err);
            try {
              // P1-Ph4: previous fallback only called getDrugInteractions
              // with drugA per-drug and filtered where both sides happened
              // to be in the input set. The backend's _pair_on_different_sides
              // filter requires a paired drugA+drugB so polypharmacy XD pairs
              // where only one side is the canonical drug name (the other
              // side comes back as a "stored as group" pair) were silently
              // dropped. Now we walk every (i,j) and call drugA+drugB so
              // the backend resolves cross-class XD correctly.
              const pairCalls: Promise<Awaited<ReturnType<typeof getDrugInteractions>>>[] = [];
              for (let i = 0; i < uniqueDrugs.length; i++) {
                for (let j = i + 1; j < uniqueDrugs.length; j++) {
                  pairCalls.push(getDrugInteractions({
                    drugA: uniqueDrugs[i],
                    drugB: uniqueDrugs[j],
                  }));
                }
              }
              const respList = await Promise.all(pairCalls);
              const all = respList.flatMap((resp) => resp.interactions || []);
              const byId = new Map<string, typeof all[number]>();
              for (const it of all) {
                const id = String(it.id || '');
                if (!id) continue;
                if (!byId.has(id)) byId.set(id, it);
              }
              return Array.from(byId.values())
                .map((it) => ({
                  id: it.id,
                  drugA: it.drug1,
                  drugB: it.drug2,
                  severity: mapSeverity(it.severity),
                  description: it.clinicalEffect || '',
                  mechanism: it.mechanism || '',
                  clinicalEffect: it.clinicalEffect || '',
                  management: it.management || '',
                  references: it.references || '',
                  riskRating: mapRiskRating(it.riskRating),
                  riskRatingDescription: it.riskRatingDescription || '',
                  reliabilityRating: it.reliabilityRating || '',
                  routeDependency: it.routeDependency || '',
                  discussion: it.discussion || '',
                  dependencies: it.dependencies || [],
                  pubmedIds: it.pubmedIds || [],
                }));
            } catch (fallbackErr) {
              console.error(`${t('workstation.assess.ddiLogFail')}:`, fallbackErr);
              return [];
            }
          }
        })(),

        // Task 2: IV Compatibility (single batch request)
        (async () => {
          const pairs: Array<[string, string]> = [];
          for (let i = 0; i < uniqueDrugs.length; i++) {
            for (let j = i + 1; j < uniqueDrugs.length; j++) {
              pairs.push([uniqueDrugs[i], uniqueDrugs[j]]);
            }
          }
          // P0-3: backend accepts up to 30 pairs (interactions.py:_BatchRequest
          // max_length=30); the previous 20-pair cap silently dropped pairs
          // for ≥7 IV drugs and counted them as `noData` in the summary,
          // hiding potentially incompatible pairs as "全相容". Raise to 30 to
          // match the backend, surface a banner when truncation happens, and
          // expose `truncatedPairsCount` so the panel can warn.
          const IV_BATCH_LIMIT = 30;
          const limitedPairs = pairs.slice(0, IV_BATCH_LIMIT);
          const truncatedPairsCount = pairs.length - limitedPairs.length;

          let failedCount = 0;
          let pairResults: IVCompatibility[][] = [];
          try {
            const batchResp = await getIVCompatibilityBatch(
              limitedPairs.map(([a, b]) => ({ drugA: a, drugB: b })),
              { suppressErrorToast: true },
            );
            pairResults = (batchResp.results || []).map(item => {
              if (item.source === 'error') { failedCount++; return []; }
              return (item.compatibilities || []).map(row => ({
                id: row.id || '',
                drugA: row.drug1 || item.drugA,
                drugB: row.drug2 || item.drugB,
                solution: (row.solution as IVCompatibility['solution']) || 'multiple',
                compatible: Boolean(row.compatible),
                timeStability: row.timeStability || undefined,
                notes: row.notes || undefined,
                references: row.references || undefined,
              }));
            });
          } catch (err) {
            console.warn(`${t('workstation.assess.compatLogFail')}:`, err);
            failedCount = limitedPairs.length;
            pairResults = limitedPairs.map(() => []);
          }

          const compatibility: IVCompatibility[] = pairResults.flat();
          const compatPairsWithData = pairResults.filter(rows => rows.length > 0).length;

          // Count by deduplicated pairs
          const compatPairMap = new Map<string, boolean>();
          for (const c of compatibility) {
            const key = [c.drugA, c.drugB].sort().join('|');
            if (!compatPairMap.has(key) || !c.compatible) {
              compatPairMap.set(key, c.compatible);
            }
          }
          const compatibilitySummary: CompatibilitySummary = {
            compatible: [...compatPairMap.values()].filter(v => v).length,
            incompatible: [...compatPairMap.values()].filter(v => !v).length,
            noData: limitedPairs.length - compatPairsWithData - failedCount,
            queryFailed: failedCount,
            pairsChecked: limitedPairs.length,
            // P0-3: do NOT count truncated pairs as noData — they were never
            // checked. Surface them separately so the UI can warn.
            truncatedPairs: truncatedPairsCount,
            totalPairs: pairs.length,
          };

          return { compatibility, compatibilitySummary, limitedPairsCount: limitedPairs.length };
        })(),

        // Task 3: PAD Dosage (getPadDrugs + parallel padCalculate)
        (async (): Promise<DosageResult[]> => {
          const KNOWN_PAD_KEYS = [
            'dexmedetomidine', 'fentanyl', 'midazolam', 'cisatracurium',
            'propofol', 'norepinephrine', 'vasopressin', 'nicardipine', 'ketamine',
          ];

          // ATC codes for the 9 PAD drugs — lets us match by standardized code
          // instead of brand-name string. Fixes cases like Nimbex (brand) where
          // the brand name string doesn't contain "cisatracurium".
          const PAD_KEY_TO_ATC: Record<string, string> = {
            fentanyl:        'N01AH01',
            morphine:        'N02AA01',
            midazolam:       'N05CD08',
            lorazepam:       'N05BA06',
            propofol:        'N01AX10',
            dexmedetomidine: 'N05CM18',
            cisatracurium:   'M03AC11',
            rocuronium:      'M03AC09',
            haloperidol:     'N05AD01',
          };

          let padDrugCatalog: PadDrugInfo[] = [];
          try {
            padDrugCatalog = await getCachedPadDrugs();
          } catch {
            console.warn(t('workstation.assess.padCatalogWarn'));
            padDrugCatalog = KNOWN_PAD_KEYS.map(key => ({
              key,
              label: key.charAt(0).toUpperCase() + key.slice(1),
              concentration: 0, concentration_unit: '', dose_unit: '',
              dose_range: '', weight_basis: 'weight',
            }));
          }

          const matchPadDrug = (medName: string): PadDrugInfo | null => {
            // Path 1 (PR-1): try the standardized ATC code. Covers brand names
            // (Nimbex → cisatracurium via M03AC11, Dormicum → midazolam via N05CD08).
            const atc = drugAtcByName[medName.trim().toLowerCase()];
            if (atc) {
              for (const pad of padDrugCatalog) {
                if (PAD_KEY_TO_ATC[pad.key] === atc) return pad;
              }
            }

            // Path 2 (legacy string match): falls back when ATC isn't populated
            // (e.g. drug was hand-typed by user) or when the PAD key isn't in
            // PAD_KEY_TO_ATC (future drugs).
            const alpha = medName.replace(/[^a-zA-Z]/g, '').toLowerCase();
            const firstWord = medName.toLowerCase().split(/[\s(,/]/)[0].replace(/[^a-z]/g, '');
            for (const pad of padDrugCatalog) {
              const padAlpha = pad.key.replace(/[^a-zA-Z]/g, '').toLowerCase();
              const padLabel = pad.label.replace(/[^a-zA-Z]/g, '').toLowerCase();
              if (padAlpha === alpha || padLabel === alpha) return pad;
              if (firstWord === padAlpha || firstWord === padLabel) return pad;
              if (firstWord.length >= 6 && padAlpha.startsWith(firstWord)) return pad;
              if (padAlpha.length >= 6 && firstWord.startsWith(padAlpha)) return pad;
            }
            return null;
          };

          const padMatchedDrugs = uniqueDrugs
            .map(drug => ({ drug, padInfo: matchPadDrug(drug) }))
            .filter((m): m is { drug: string; padInfo: PadDrugInfo } => m.padInfo !== null);

          const patientWeight = extendedData?.weight ?? null;
          const patientSex = normalizePatientGender(selectedPatient.gender);
          const patientHeight = extendedData?.height ?? selectedPatient.height ?? undefined;

          return Promise.all(
            padMatchedDrugs.map(async ({ drug, padInfo }) => {
              if (!patientWeight || patientWeight <= 0) {
                return {
                  drugName: padInfo.label || drug,
                  normalDose: '—', adjustedDose: t('workstation.assess.noBody'),
                  renalAdjustment: '', hepaticWarning: '',
                  warnings: [t('workstation.assess.noBodyMissing')],
                  calculationSteps: [],
                  status: 'requires_input' as DosageResult['status'],
                  clinicalSummary: t('workstation.assess.noBodySummary'),
                  calculatedRate: '—',
                };
              }
              const isFixed = padInfo.weight_basis === 'fixed';
              let defaultTarget = 0;
              let rangeMin = 0;
              let rangeMax = 0;
              if (!isFixed && padInfo.dose_range) {
                const parts = padInfo.dose_range.split('–');
                if (parts.length === 2) {
                  const lo = parseFloat(parts[0]);
                  const hi = parseFloat(parts[1]);
                  if (!isNaN(lo) && !isNaN(hi)) {
                    rangeMin = lo;
                    rangeMax = hi;
                    defaultTarget = parseFloat(((lo + hi) / 2).toFixed(4));
                  }
                }
              }
              try {
                const res = await padCalculate({
                  drug: padInfo.key,
                  weight_kg: patientWeight,
                  target_dose_per_kg_hr: isFixed ? 0 : defaultTarget,
                  concentration: padInfo.concentration || 1,
                  sex: patientSex,
                  height_cm: patientHeight,
                });
                const conc = padInfo.concentration || 1;
                const rateStr = `${res.rate_ml_hr} ml/hr`;
                const doseStr = `${res.dose_per_hr} ${padInfo.dose_unit?.replace('/kg', '') || '/hr'}`;
                // Compute rate range at min/max dose
                const dosingWt = res.dosing_weight_kg;
                const rateAtMin = rangeMin > 0 ? parseFloat((dosingWt * rangeMin / conc).toFixed(1)) : 0;
                const rateAtMax = rangeMax > 0 ? parseFloat((dosingWt * rangeMax / conc).toFixed(1)) : 0;
                return {
                  drugName: padInfo.label || drug,
                  normalDose: `${defaultTarget} ${padInfo.dose_unit || ''}`,
                  adjustedDose: rateStr,
                  renalAdjustment: '', hepaticWarning: '',
                  warnings: res.note ? [res.note] : [],
                  calculationSteps: res.steps,
                  status: 'calculated' as DosageResult['status'],
                  clinicalSummary: `${res.weight_basis} ${res.dosing_weight_kg}kg → ${rateStr}`,
                  supportingNote: res.steps.length > 1 ? res.steps.slice(1).join('；') : undefined,
                  targetDose: doseStr, targetDoseTitle: t('workstation.assess.perHour'),
                  calculatedRate: rateStr, calculatedRateTitle: t('workstation.assess.rateLabel'),
                  orderSummary: `${padInfo.label} ${rateStr}`,
                  orderTypeLabel: t('workstation.assess.continuousInfusion'),
                  isEquivalentEstimate: false,
                  padKey: padInfo.key,
                  doseRangeMin: rangeMin,
                  doseRangeMax: rangeMax,
                  currentTargetPerKgHr: defaultTarget,
                  doseUnit: padInfo.dose_unit || '',
                  weightKg: patientWeight,
                  concentration: conc,
                  concentrationUnit: padInfo.concentration_unit || '',
                  defaultConcentration: conc,
                  concentrationRange: padInfo.concentration_range,
                  sex: patientSex,
                  heightCm: patientHeight,
                  weightBasis: res.weight_basis,
                  dosingWeightKg: dosingWt,
                  rateAtMin,
                  rateAtMax,
                };
              } catch {
                return {
                  drugName: padInfo.label || drug,
                  normalDose: '—', adjustedDose: t('workstation.assess.padCalcFail'),
                  renalAdjustment: '', hepaticWarning: '',
                  warnings: [], calculationSteps: [],
                  status: 'service_unavailable' as DosageResult['status'],
                  clinicalSummary: t('workstation.assess.padCalcFail'),
                  calculatedRate: '—',
                };
              }
            })
          );
        })(),

        // Task 4: Duplicate medication detection.
        // Use getMedicationDuplicates(patientId) so the result aligns 1:1 with the
        // patient-list duplicate dots — same backend, same data fidelity (full
        // DB metadata: ATC, route, isPrn, lastAdminAt), same default context.
        (async (): Promise<{ alerts: DuplicateAlert[]; queryFailed: boolean }> => {
          try {
            const res = await getMedicationDuplicates(selectedPatient.id);
            return { alerts: res.alerts || [], queryFailed: false };
          } catch (err) {
            console.warn(`${t('workstation.assess.duplicateLogFail')}:`, err);
            return { alerts: [], queryFailed: true };
          }
        })(),
      ]);

      // Aggregate duplicate severity counts
      const duplicateSummary: DuplicateSummary = {
        total: duplicateResult.alerts.length,
        critical: duplicateResult.alerts.filter(a => a.level === 'critical').length,
        high: duplicateResult.alerts.filter(a => a.level === 'high').length,
        moderate: duplicateResult.alerts.filter(a => a.level === 'moderate').length,
        low: duplicateResult.alerts.filter(a => a.level === 'low').length,
        info: duplicateResult.alerts.filter(a => a.level === 'info').length,
        queryFailed: duplicateResult.queryFailed,
      };

      // 5) Recommendations (rule-based hints; not LLM-generated)
      const adviceRecommendations: string[] = [];
      if (duplicateSummary.critical + duplicateSummary.high > 0) {
        adviceRecommendations.push(
          t('workstation.assess.advice.duplicateHighRisk', { count: duplicateSummary.critical + duplicateSummary.high })
        );
      } else if (duplicateSummary.total > 0) {
        adviceRecommendations.push(
          t('workstation.assess.advice.duplicateGeneral', { count: duplicateSummary.total })
        );
      }
      if (duplicateSummary.queryFailed) {
        adviceRecommendations.push(t('workstation.assess.advice.duplicateError'));
      }
      if (interactions.length > 0) {
        const high = interactions.filter(i => i.severity === 'high').length;
        adviceRecommendations.push(
          high > 0
            ? t('workstation.assess.advice.interactionHigh', { count: high })
            : t('workstation.assess.advice.interactionGeneral', { count: interactions.length })
        );
      }
      const incompatible = compatibility.filter(c => !c.compatible).length;
      if (incompatible > 0) {
        adviceRecommendations.push(t('workstation.assess.advice.incompatible', { count: incompatible }));
      }
      if (compatibilitySummary.queryFailed > 0) {
        adviceRecommendations.push(t('workstation.assess.advice.compatibilityFail', { failed: compatibilitySummary.queryFailed, total: compatibilitySummary.pairsChecked }));
      }
      if (typeof extendedData?.egfr === 'number' && extendedData.egfr < 60) {
        adviceRecommendations.push(t('workstation.assess.advice.egfrLow', { value: extendedData.egfr }));
      }
      if (extendedData?.hepaticFunction && extendedData.hepaticFunction !== 'normal') {
        adviceRecommendations.push(t('workstation.assess.advice.renalAbn'));
      }
      if (dosage.some(d => d.status === 'service_unavailable')) {
        adviceRecommendations.push(t('workstation.assess.advice.padFail'));
      }
      if (dosage.some(d => d.status === 'requires_input')) {
        adviceRecommendations.push(t('workstation.assess.advice.padNeedWeight'));
      }
      const calculatedDosage = dosage.filter(d => d.status === 'calculated');
      if (calculatedDosage.length > 0) {
        adviceRecommendations.push(t('workstation.assess.advice.padCalculatedWith', { count: calculatedDosage.length }));
      }

      setAssessmentResults({
        interactions,
        compatibility,
        dosage,
        duplicates: duplicateResult.alerts,
        duplicateSummary,
        adviceRecommendations,
        compatibilitySummary,
        compatibilityPairsChecked: limitedPairsCount,
      });

      toast.success(t('workstation.assess.complete'));
    } finally {
      setIsAssessing(false);
    }
  };

  // 產生用藥建議報告
  const handleGenerateAdvice = () => {
    if (!assessmentResults) {
      toast.error(t('workstation.assess.needFirst'));
      return;
    }

    let report = `${t('workstation.report.header')}\n\n`;
    report += `${t('workstation.report.patientLine', { name: maskPatientName(selectedPatient?.name), bed: selectedPatient?.bedNumber })}\n`;
    report += `${t('workstation.report.dateLine', { date: new Date().toLocaleString('zh-TW') })}\n`;
    report += `${t('workstation.report.pharmacistLine', { name: user?.name })}\n\n`;
    
    report += `${t('workstation.report.drugsHeader')}\n${drugList.join('、')}\n\n`;

    if (assessmentResults.duplicates.length > 0) {
      const levelLabel: Record<string, string> = {
        critical: t('workstation.assess.duplicateLevels.critical'),
        high: t('workstation.assess.duplicateLevels.high'),
        moderate: t('workstation.assess.duplicateLevels.moderate'),
        low: t('workstation.assess.duplicateLevels.low'),
        info: t('workstation.assess.duplicateLevels.info'),
      };
      report += `${t('workstation.report.duplicateHeader')}\n`;
      assessmentResults.duplicates.forEach((dup, idx) => {
        const drugs = dup.members.map(m => m.genericName).join(' + ');
        report += `${idx + 1}. [${levelLabel[dup.level] ?? dup.level}/${dup.layer}] ${drugs}\n`;
        report += `   ${t('workstation.report.mechanism', { value: dup.mechanism })}\n`;
        if (dup.recommendation) report += `   ${t('workstation.report.recommendation', { value: dup.recommendation })}\n`;
        report += '\n';
      });
    }

    if (assessmentResults.interactions.length > 0) {
      report += `${t('workstation.report.ddiHeader')}\n`;
      assessmentResults.interactions.forEach((int, idx) => {
        report += `${idx + 1}. ${int.drugA} + ${int.drugB} (${t('workstation.report.ddiSeverity', { value: int.severity })})\n`;
        report += `   ${int.description}\n`;
        report += `   ${t('workstation.report.ddiManagement', { value: int.management })}\n\n`;
      });
    }

    if (assessmentResults.compatibility.some(c => !c.compatible)) {
      report += `${t('workstation.report.compatibilityHeader')}\n`;
      assessmentResults.compatibility.filter(c => !c.compatible).forEach((comp, idx) => {
        report += `${idx + 1}. ${comp.drugA} + ${comp.drugB}: ${t('workstation.report.compatibilityIncompatible')}\n`;
        report += `   ${t('workstation.report.compatibilityNote', { value: comp.notes })}\n\n`;
      });
    }

    if (typeof extendedData?.egfr === 'number' && extendedData.egfr < 60) {
      report += `${t('workstation.report.doseAdjustHeader')}\n`;
      report += `${t('workstation.report.renalAdjustment', { value: extendedData.egfr })}\n\n`;
    }

    report += `${t('workstation.report.summaryHeader')}\n`;
    assessmentResults.adviceRecommendations.forEach((rec, idx) => {
      report += `${idx + 1}. ${rec}\n`;
    });

    setAdviceContent(report);
    setViewMode('report');
    toast.success(t('workstation.report.generated'));
  };

  // AI 修飾用藥建議
  const handlePolishAdvice = async () => {
    if (!adviceContent.trim() || !selectedPatientId) return;
    setIsPolishingAdvice(true);
    try {
      const result = await polishClinicalText({
        patientId: selectedPatientId,
        content: adviceContent,
        polishType: 'medication_advice',
      });
      setAdviceContent(result.polished);
      toast.success(t('workstation.advice.polishSuccess'));
    } catch {
      toast.error(t('workstation.advice.polishError'));
    } finally {
      setIsPolishingAdvice(false);
    }
  };

  // 儲存用藥建議
  const handleSaveAdvice = () => {
    if (!adviceContent.trim()) {
      toast.error(t('workstation.advice.needContent'));
      return;
    }

    // 開啟選擇分類對話框
    setShowSubmitDialog(true);
  };

  // 確認送出用藥建議
  const handleConfirmSubmit = async () => {
    if (!selectedPatient) {
      toast.error(t('workstation.advice.needPatient'));
      return;
    }
    if (!adviceContent.trim()) {
      toast.error(t('workstation.advice.needContent'));
      return;
    }
    if (!selectedAdviceCode || !selectedCategory) {
      toast.error(t('workstation.advice.needCategory'));
      return;
    }

    // 取得分類資訊
    const categoryInfo = adviceCategories[selectedCategory as keyof typeof adviceCategories];
    const codeInfo = categoryInfo.codes.find(c => c.code === selectedAdviceCode);
    if (!codeInfo) {
      toast.error(t('workstation.advice.invalidCode'));
      return;
    }

    try {
      await createAdviceRecord({
        patientId: selectedPatient.id,
        adviceCode: selectedAdviceCode,
        adviceLabel: codeInfo.label,
        category: categoryInfo.label,
        content: adviceContent.trim(),
        linkedMedications: drugList,
      });
      toast.success(t('workstation.advice.submittedToBoardWith', { label: codeInfo.label }));
      setAdviceContent('');
      setShowSubmitDialog(false);
      setSelectedCategory('');
      setSelectedAdviceCode('');
    } catch (err) {
      console.error(`${t('workstation.advice.submitErrorLog')}:`, err);
      toast.error(t('workstation.advice.submitError'));
    }
  };

  // 跳轉到用藥建議與統計頁面
  const handleGoToStatistics = () => {
    navigate('/pharmacy/advice-statistics');
  };

  const assessReady = !!selectedPatient && drugList.length > 0 && !isAssessing;
  const assessHint = !selectedPatient
    ? t('workstation.assessHint.needPatient')
    : drugList.length === 0
      ? t('workstation.assessHint.needDrug')
      : t('workstation.assessHint.ready');

  return (
    <div className="p-6 space-y-4">
      {/* 標題 */}
      <div>
        <h1 className="text-2xl font-bold">{t('workstation.header.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('workstation.header.subtitle')}
        </p>
      </div>

      {/* P1-Ph5: md:grid-cols-5 picks up iPad portrait (768-1023px) so the
          assessment panel stays beside the patient picker. Without this the
          layout fell to grid-cols-1 below 1024px and pushed the "執行全面評估"
          CTA below the fold on every common tablet. */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 左側：病患與用藥管理 (40%) */}
        <div className="md:col-span-2 space-y-4">
          {/* 病患選擇 */}
          <Card className="border-brand">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-5 w-5 text-brand" />
                {t('workstation.patientSelect.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId} disabled={patientsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={patientsLoading ? t('workstation.patientSelect.loading') : patientsError ? t('workstation.patientSelect.loadFail') : t('workstation.patientSelect.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      <span className="inline-flex items-center gap-2 w-full">
                        <span>
                          {patient.bedNumber} - {maskPatientName(patient.name)} ({t('workstation.patientSelect.labels.ageWithSuffix', { age: patient.age })})
                        </span>
                        <DuplicateCountsBadge
                          counts={duplicateSummary?.counts?.[patient.id]}
                          computing={duplicateSummary?.computing?.[patient.id] ?? false}
                        />
                      </span>
                    </SelectItem>
                  ))}
                  {!patientsLoading && patients.length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      {patientsError || t('workstation.patientSelect.empty')}
                    </div>
                  )}
                </SelectContent>
              </Select>

              {selectedPatient && extendedData && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.bed')}</p>
                      <p className="font-semibold">{selectedPatient.bedNumber}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.name')}</p>
                      <p className="font-semibold flex items-center gap-2">
                        {maskPatientName(selectedPatient.name)}
                        <DuplicateCountsBadge
                          counts={duplicateSummary?.counts?.[selectedPatient.id]}
                          computing={duplicateSummary?.computing?.[selectedPatient.id] ?? false}
                        />
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.ageHeightWeight')}</p>
                      <p className="font-semibold">
                        {t('workstation.patientSelect.labels.ageWithSuffix', { age: selectedPatient.age })} / {typeof extendedData.height === 'number' ? `${extendedData.height}cm` : 'N/A'} / {typeof extendedData.weight === 'number' ? `${extendedData.weight}kg` : 'N/A'}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">{t('workstation.patientSelect.labels.diagnosis')}</p>
                      <p className="font-semibold text-sm">{selectedPatient.diagnosis}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 用藥列表管理 */}
          {selectedPatient && (
            <Card className="border-brand">
              <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Pill className="h-5 w-5 text-brand" />
                    {t('workstation.drugList.title')}
                  </CardTitle>
                  <Badge className="bg-brand">
                    {t('workstation.drugList.countSuffix', { count: drugList.length })}
                  </Badge>
                </div>
                <CardDescription className="text-xs">{t('workstation.drugList.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {/* 新增藥品 */}
                <div className="flex gap-2">
                  <Input
                    placeholder={t('workstation.drugList.addPlaceholder')}
                    value={currentDrug}
                    onChange={(e) => setCurrentDrug(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddDrug();
                      }
                    }}
                  />
                  <Button 
                    onClick={handleAddDrug}
                    disabled={!currentDrug.trim()}
                    className="bg-brand hover:bg-brand-hover"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* 藥品列表 */}
                {drugList.length > 0 ? (
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-2 pr-3">
                      {drugList.map((drug, index) => (
                        <div 
                          key={index}
                          className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border dark:border-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground w-5 text-right">{index + 1}.</span>
                            <span className="font-medium text-sm">{drug}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveDrug(drug)}
                            className="h-7 w-7"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <Alert className="py-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      {t('workstation.drugList.empty')}
                    </AlertDescription>
                  </Alert>
                )}

              </CardContent>
            </Card>
          )}
        </div>

        {viewMode === 'report' && assessmentResults ? (
          <PharmacyReportView
            selectedPatient={selectedPatient ? {
              name: maskPatientName(selectedPatient.name),
              bedNumber: selectedPatient.bedNumber,
              age: selectedPatient.age,
              diagnosis: selectedPatient.diagnosis,
            } : null}
            assessmentResults={assessmentResults}
            drugList={drugList}
            extendedData={extendedData}
            pharmacistName={user?.name || ''}
            adviceContent={adviceContent}
            onAdviceContentChange={setAdviceContent}
            onSaveAdvice={handleSaveAdvice}
            onBackToAssessment={() => setViewMode('assessment')}
            patientId={selectedPatientId}
            onPolishAdvice={handlePolishAdvice}
            isPolishing={isPolishingAdvice}
          />
        ) : (
          <AssessmentResultsPanel
            selectedPatient={selectedPatient}
            assessmentResults={assessmentResults}
            drugList={drugList}
            expandedSections={{ interactions: true, compatibility: true, dosage: true, duplicates: true, advice: true }}
            toggleSection={() => {}}
            extendedData={extendedData}
            adviceContent={adviceContent}
            onAdviceContentChange={setAdviceContent}
            onGoToStatistics={handleGoToStatistics}
            onGenerateAdvice={handleGenerateAdvice}
            onSaveAdvice={handleSaveAdvice}
            onRunAssessment={handleComprehensiveAssessment}
            assessReady={assessReady}
            assessHint={assessHint}
            isAssessing={isAssessing}
          />
        )}

      </div>

      <AdviceSubmitDialog
        open={showSubmitDialog}
        onOpenChange={setShowSubmitDialog}
        selectedCategory={selectedCategory}
        selectedAdviceCode={selectedAdviceCode}
        onCategoryChange={(value) => {
          setSelectedCategory(value);
          setSelectedAdviceCode('');
        }}
        onAdviceCodeChange={setSelectedAdviceCode}
        onConfirm={handleConfirmSubmit}
        onCancel={() => {
          setShowSubmitDialog(false);
          setSelectedCategory('');
          setSelectedAdviceCode('');
        }}
      />
    </div>
  );
}
