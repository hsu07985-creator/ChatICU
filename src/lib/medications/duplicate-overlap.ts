// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-tab overlap check. Classification keys come only from
// structured medication fields supplied by the API.
// ─────────────────────────────────────────────────────────────────────────────
import type { Medication } from '../api';

/** Prefer an exact full ATC code; otherwise compare the exact order code. */
export function medCompareKey(med: Medication): string {
  const atcCode = med.atcCode?.trim();
  if (atcCode?.length === 7) return `atc:${atcCode}`;
  const orderCode = med.orderCode?.trim();
  return orderCode ? `order:${orderCode}` : '';
}

export interface DuplicateMedGroup {
  generic: string;        // display name (actual generic when available)
  inpatient: Medication[];
  outpatient: Medication[];
}

export function detectDuplicates(
  inpatientMeds: Medication[],
  outpatientMeds: Medication[],
): DuplicateMedGroup[] {
  // Build map: comparison key → inpatient meds
  const inpMap = new Map<string, Medication[]>();
  for (const m of inpatientMeds) {
    const key = medCompareKey(m);
    if (!key) continue;
    const arr = inpMap.get(key) || [];
    arr.push(m);
    inpMap.set(key, arr);
  }

  // Check outpatient meds against the inpatient map
  const result = new Map<string, DuplicateMedGroup>();
  for (const m of outpatientMeds) {
    const key = medCompareKey(m);
    if (!key || !inpMap.has(key)) continue;
    if (!result.has(key)) {
      result.set(key, {
        generic: m.genericName || m.name,
        inpatient: inpMap.get(key)!,
        outpatient: [],
      });
    }
    result.get(key)!.outpatient.push(m);
  }

  return [...result.values()];
}
