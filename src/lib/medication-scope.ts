import type { Medication } from './api/medications';

export interface PharmacyReviewScope {
  reviewed: Medication[];
  skipped: Medication[];
}

// 住院藥全部納入；門診藥僅納入自備藥（sourceType='self-supplied'）或院外藥（isExternal）。
// 排除「門診常規處方」以避免雜訊污染交互作用 / 重複用藥 / 配伍偵測。
export function selectPharmacyReviewMeds(meds: Medication[]): PharmacyReviewScope {
  const reviewed: Medication[] = [];
  const skipped: Medication[] = [];
  for (const m of meds) {
    if (m.sourceType === 'outpatient' && !m.isExternal) {
      skipped.push(m);
    } else {
      reviewed.push(m);
    }
  }
  return { reviewed, skipped };
}
