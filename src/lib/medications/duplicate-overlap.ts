// ─────────────────────────────────────────────────────────────────────────────
// INTENTIONALLY-DIFFERENT lightweight, in-tab duplicate-overlap check.
//
// This is NOT the canonical backend DuplicateDetector (used by the standalone
// 「重複用藥」/pharmacy/duplicates tool). Per the medications-tab's own note, the
// in-tab "重複用藥 ({N})" toggle is a *different* heuristic: same-generic overlap
// between active inpatient orders and active outpatient/self-supplied meds.
//
// medCompareKey() relies on fragile regex parsing of drug-name parentheses and
// must be kept lightweight for a fast view-level check — do NOT replace it with
// the backend ATC-based detector here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Medication } from '../api';

/** Extract a comparison key for duplicate detection.
 *  Priority: actual generic from parentheses > genericName field > brand prefix.
 *  Returns alpha-only lowercase string to handle Tall Man Lettering. */
export function medCompareKey(med: Medication): string {
  // 1. Try to extract actual generic from parenthesized content in drug name
  //    e.g. "Seroquel [25mg] tab (Quetiapine)" → "quetiapine"
  //    e.g. "[包] Actein 發泡顆粒 600mg (Acetylcysteine)" → "acetylcysteine"
  const parens = [...(med.name || '').matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim());
  for (let i = parens.length - 1; i >= 0; i--) {
    const p = parens[i];
    // Skip non-drug markers: 抗3, 軟袋, digits, ml suffix
    if (/^[抗軟]/.test(p) || /^\d/.test(p) || /ml$/i.test(p)) continue;
    // Take first semicolon segment if compound
    const first = p.includes(';') ? p.split(';')[0].trim() : p;
    const alpha = first.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (alpha.length >= 3) return alpha;
  }
  // 2. Fall back to genericName field (brand prefix from converter)
  const gn = (med.genericName || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (gn.length >= 3) return gn;
  // 3. Last resort: first English word from name
  const fw = (med.name || '').match(/^(?:\[.*?\]\s*)*([A-Za-z]{3,})/);
  return fw ? fw[1].toLowerCase() : '';
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
      // Display the actual generic from parentheses if available
      const parens = [...(m.name || '').matchAll(/\(([^)]+)\)/g)].map(p => p[1].trim());
      const displayGeneric = parens.filter(p => /^[A-Za-z]/.test(p) && !/^[抗軟]/.test(p)).pop();
      result.set(key, {
        generic: displayGeneric || m.genericName || m.name,
        inpatient: inpMap.get(key)!,
        outpatient: [],
      });
    }
    result.get(key)!.outpatient.push(m);
  }

  return [...result.values()];
}
