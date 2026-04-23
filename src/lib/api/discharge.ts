import apiClient, { ensureData } from '../api-client';
import type { DuplicateAlert, DuplicateSeverityCounts } from './medications';

// ── Discharge medication reconciliation (Wave 6a) ──────────────────────
// Backed by GET /patients/{patient_id}/discharge-check — see
// docs/duplicate-medication-integration-plan.md §4.5 (出院管理).
//
// Surfaces two categories of discharge-related med issues:
//   1) missedDiscontinuations — inpatient meds that were active at discharge
//      but not carried on the discharge order (classic SUP-PPI trap).
//   2) dischargeDuplicates — duplicate-detector alerts run against the
//      discharge order set itself (DuplicateDetector context="discharge").

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export type DischargeMissedCategory =
  | 'sup_ppi'
  | 'empirical_antibiotic'
  | 'prn_only'
  | 'other';

export type DischargeMissedSeverity = 'high' | 'moderate' | 'low';

export interface DischargeInpatientActiveMed {
  medicationId: string;
  genericName: string;
  atcCode: string | null;
  indication: string | null;
  startDate: string | null;
}

export interface DischargeOrderMed {
  medicationId: string;
  genericName: string;
  atcCode: string | null;
  daysSupply: number | null;
}

export interface DischargeMissedDiscontinuation {
  medicationId: string;
  genericName: string;
  atcCode: string | null;
  category: DischargeMissedCategory;
  severity: DischargeMissedSeverity;
  reason: string;
  inpatientStartDate: string | null;
}

export interface DischargeCheckResponse {
  patientId: string;
  dischargeDate: string | null;
  dischargeType: string | null;
  inpatientActiveAtDischarge: DischargeInpatientActiveMed[];
  dischargeMedications: DischargeOrderMed[];
  missedDiscontinuations: DischargeMissedDiscontinuation[];
  dischargeDuplicates: DuplicateAlert[];
  counts: {
    missedDiscontinuations: number;
    dischargeDuplicates: DuplicateSeverityCounts;
  };
}

export async function getDischargeCheck(
  patientId: string
): Promise<DischargeCheckResponse> {
  const response = await apiClient.get<ApiResponse<DischargeCheckResponse>>(
    `/patients/${patientId}/discharge-check`
  );
  return ensureData(response.data, 'API contract');
}
