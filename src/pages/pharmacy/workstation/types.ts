import { PHARMACY_ADVICE_CATEGORIES } from '../../../lib/pharmacy-master-data';

export interface DrugInteraction {
  id: string;
  drugA: string;
  drugB: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references?: string;
  // Risk Rating from interactions DB (X/D/C/B/A)
  riskRating?: 'X' | 'D' | 'C' | 'B' | 'A';
  riskRatingDescription?: string;
  reliabilityRating?: string;
  routeDependency?: string;
  discussion?: string;
  dependencies?: string[];
  pubmedIds?: string[];
}

export interface IVCompatibility {
  id: string;
  drugA: string;
  drugB: string;
  solution: 'NS' | 'D5W' | 'LR' | 'D5NS' | 'multiple';
  compatible: boolean;
  timeStability?: string;
  notes?: string;
  concentration?: string;
  references?: string;
}

export interface ExtendedPatientData {
  height: number | null;
  weight: number | null;
  egfr: number | null;
  hepaticFunction: 'normal' | 'mild' | 'moderate' | 'severe';
  sbp?: number | null;
  hr?: number | null;
  rr?: number | null;
  k?: number | null;
}

export interface DosageResult {
  drugName: string;
  normalDose: string;
  adjustedDose: string;
  renalAdjustment: string;
  hepaticWarning: string;
  warnings: string[];
  references?: string;
  // Enhanced fields
  calculationSteps?: string[];
  status: 'calculated' | 'requires_input' | 'service_unavailable';
  clinicalSummary: string;
  supportingNote?: string;
  targetDose?: string;
  targetDoseTitle?: string;
  calculatedRate: string;
  calculatedRateTitle?: string;
  orderSummary?: string;
  orderTypeLabel?: string;
  isEquivalentEstimate?: boolean;
  // Inline recalculation params
  padKey?: string;
  doseRangeMin?: number;
  doseRangeMax?: number;
  currentTargetPerKgHr?: number;
  doseUnit?: string;
  weightKg?: number;
  concentration?: number;
  concentrationUnit?: string;
  defaultConcentration?: number;
  concentrationRange?: [number, number];
  sex?: string;
  heightCm?: number;
  weightBasis?: string;
  dosingWeightKg?: number;
  rateAtMin?: number;
  rateAtMax?: number;
}

export interface CompatibilitySummary {
  compatible: number;
  incompatible: number;
  noData: number;
  queryFailed: number;
  pairsChecked: number;
}

export interface AssessmentResults {
  interactions: DrugInteraction[];
  compatibility: IVCompatibility[];
  dosage: DosageResult[];
  adviceRecommendations: string[];
  compatibilitySummary?: CompatibilitySummary;
  compatibilityPairsChecked: number;
}

export type ExpandedSections = {
  interactions: boolean;
  compatibility: boolean;
  dosage: boolean;
  advice: boolean;
};

export const adviceCategories = PHARMACY_ADVICE_CATEGORIES;
