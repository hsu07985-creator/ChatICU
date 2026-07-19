// 藥師工作站「全面評估」的純協調邏輯:4 個並行任務(交互作用/相容性/
// 劑量/重複用藥)+ 規則式建議彙整,回傳 AssessmentResults。
// 從 workstation.tsx 抽出(D1 page-split,2026-07-20);無 React/setState 副作用。
import type { TFunction } from 'i18next';

import type { Patient as ApiPatient } from '../../../lib/api/patients';
import { normalizePatientGender } from '../../../lib/patient-gender';
import { checkInteractions, type PatientContext } from '../../../lib/api/ai';
import { getDrugInteractions, getIVCompatibilityBatch, padCalculate, type PadDrugInfo } from '../../../lib/api/pharmacy';
import { getMedicationDuplicates, type DuplicateAlert } from '../../../lib/api/medications';
import { getCachedPadDrugs } from '../../../lib/pad-drugs-cache';
import type {
  AssessmentResults,
  CompatibilitySummary,
  DosageResult,
  DrugInteraction,
  DuplicateSummary,
  ExtendedPatientData,
  IVCompatibility,
} from './types';

interface RunAssessmentParams {
  drugList: string[];
  selectedPatient: ApiPatient;
  extendedData: ExtendedPatientData | null;
  drugAtcByName: Record<string, string>;
  t: TFunction;
}

export async function runComprehensiveAssessment(
  { drugList, selectedPatient, extendedData, drugAtcByName, t }: RunAssessmentParams,
): Promise<AssessmentResults> {
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
    adviceRecommendations.push(t('workstation.assess.advice.hepaticAbn'));
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

  return {
    interactions,
    compatibility,
    dosage,
    duplicates: duplicateResult.alerts,
    duplicateSummary,
    adviceRecommendations,
    compatibilitySummary,
    compatibilityPairsChecked: limitedPairsCount,
  };
}
