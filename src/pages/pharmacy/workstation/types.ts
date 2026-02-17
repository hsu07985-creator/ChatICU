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
}

export interface AssessmentResults {
  interactions: DrugInteraction[];
  compatibility: IVCompatibility[];
  dosage: DosageResult[];
  adviceRecommendations: string[];
}

export type ExpandedSections = {
  interactions: boolean;
  compatibility: boolean;
  dosage: boolean;
  advice: boolean;
};

export const adviceCategories = PHARMACY_ADVICE_CATEGORIES;
