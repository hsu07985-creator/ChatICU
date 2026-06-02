// Advice-record statistics computation, extracted from
// src/pages/pharmacy/advice-statistics.tsx so the page body stays focused on
// rendering. Behavior-preserving: same numbers, same ordering, same colors.
//
// The previous in-page implementation built `barData` with an O(n²)
// `records.find(...)` inside a `.map(...)` over the distinct advice codes. For a
// 500-record month that meant up to 500×(distinct codes) scans. Here we capture
// the representative record for each code in a single pass while tallying
// counts, so the whole thing is O(n).

import {
  PHARMACY_ADVICE_CATEGORIES,
  PHARMACY_ADVICE_CATEGORY_COLORS,
  getAdviceCategoryColor,
} from '../pharmacy-master-data';
import type { PharmacyAdviceRecord } from '../api/pharmacy';

export interface AdvicePieDatum {
  name: string;
  value: number;
  color: string;
}

export interface AdviceBarDatum {
  code: string;
  fullLabel: string;
  label: string;
  category: string;
  count: number;
  color: string;
}

export interface AdviceCategoryAcceptRate {
  key: string;
  /** Stored DB label for this category (used for i18n defaultValue). */
  label: string;
  labelKey?: string;
  total: number;
  accepted: number;
  /** Integer percent 0–100; 0 when total is 0. */
  rate: number;
  color: string;
}

export interface AdviceStats {
  /** Per-category counts keyed by the category's stored DB label. */
  categoryStats: Record<string, number>;
  totalAdvices: number;
  pieData: AdvicePieDatum[];
  acceptedCount: number;
  rejectedCount: number;
  /** Integer percent 0–100; 0 when there are no records. */
  acceptRate: number;
  barData: AdviceBarDatum[];
  /** Per-category accept-rate breakdown, in master-data category order. */
  categoryAcceptRates: AdviceCategoryAcceptRate[];
}

export function computeAdviceStats(records: PharmacyAdviceRecord[]): AdviceStats {
  // ── 類別計數 ──
  const categoryStats: Record<string, number> = {};
  Object.values(PHARMACY_ADVICE_CATEGORIES).forEach((cat) => {
    categoryStats[cat.label] = 0;
  });
  records.forEach((r) => {
    if (categoryStats[r.category] !== undefined) categoryStats[r.category]++;
  });
  const totalAdvices = Object.values(categoryStats).reduce((s, v) => s + v, 0);

  const pieData: AdvicePieDatum[] = Object.entries(categoryStats)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({
      name,
      value,
      color: getAdviceCategoryColor(name),
    }));

  // ── 接受率 ──
  const acceptedCount = records.filter((r) => r.accepted === true).length;
  const rejectedCount = records.filter((r) => r.accepted === false).length;
  const acceptRate = totalAdvices > 0 ? Math.round((acceptedCount / totalAdvices) * 100) : 0;

  // ── 細項計數 + 代表紀錄（單次遍歷，O(n)）──
  // We tally per-code counts and capture the first record seen for each code so
  // we can derive its label/category without a second O(n) lookup per code.
  const codeStats: Record<string, number> = {};
  const codeSample: Record<string, PharmacyAdviceRecord> = {};
  records.forEach((r) => {
    codeStats[r.adviceCode] = (codeStats[r.adviceCode] || 0) + 1;
    if (codeSample[r.adviceCode] === undefined) codeSample[r.adviceCode] = r;
  });
  const barData: AdviceBarDatum[] = Object.entries(codeStats)
    .map(([code, count]) => {
      const rec = codeSample[code];
      return {
        code,
        fullLabel: `${code} ${rec?.adviceLabel || code}`,
        label: rec?.adviceLabel || code,
        category: rec?.category || '',
        count,
        color: getAdviceCategoryColor(rec?.category || ''),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // ── 各類別接受率 ──
  // Single pass to tally per-category totals/accepted, then assemble in
  // master-data category order so the UI list stays stable.
  const catTotals: Record<string, number> = {};
  const catAcceptedTotals: Record<string, number> = {};
  records.forEach((r) => {
    if (categoryStats[r.category] === undefined) return;
    catTotals[r.category] = (catTotals[r.category] || 0) + 1;
    if (r.accepted === true) {
      catAcceptedTotals[r.category] = (catAcceptedTotals[r.category] || 0) + 1;
    }
  });
  const categoryAcceptRates: AdviceCategoryAcceptRate[] = Object.values(
    PHARMACY_ADVICE_CATEGORIES,
  ).map((cat) => {
    const total = catTotals[cat.label] || 0;
    const accepted = catAcceptedTotals[cat.label] || 0;
    const rate = total > 0 ? Math.round((accepted / total) * 100) : 0;
    return {
      key: cat.key,
      label: cat.label,
      labelKey: cat.labelKey,
      total,
      accepted,
      rate,
      // Preserve the original page's exact fallback chain
      // (PHARMACY_ADVICE_CATEGORY_COLORS[cat.key] || '#999'), which differs
      // from getAdviceCategoryColor's var(--color-brand) fallback.
      color: PHARMACY_ADVICE_CATEGORY_COLORS[cat.key] || '#999',
    };
  });

  return {
    categoryStats,
    totalAdvices,
    pieData,
    acceptedCount,
    rejectedCount,
    acceptRate,
    barData,
    categoryAcceptRates,
  };
}
