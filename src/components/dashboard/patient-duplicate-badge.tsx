import type { DuplicateSeverityCounts } from '../../lib/api/medications';

// Wave 6c: compact per-patient duplicate-medication severity badge for the
// ICU dashboard card. Parallels the inline badge in pharmacy/workstation.tsx
// (intentional copy rather than shared symbol — see
// docs/duplicate-medication-integration-plan.md §4.7) so dashboard sizing
// can diverge without affecting the workstation dropdown.
//
// Renders only non-zero severity buckets so a "clean" patient shows nothing
// at all (no dead pixels in the common case).
export interface PatientDuplicateBadgeProps {
  counts?: DuplicateSeverityCounts;
  /** `xs` is for packed layouts (6-col grid); `sm` is the dashboard default. */
  size?: 'sm' | 'xs';
}

export function PatientDuplicateBadge({ counts, size = 'sm' }: PatientDuplicateBadgeProps) {
  if (!counts) return null;
  const { critical, high, moderate, low } = counts;
  if (!critical && !high && !moderate && !low) return null;

  const pillBase =
    size === 'xs'
      ? 'rounded-full px-1 py-[1px] text-[9px] font-semibold leading-none'
      : 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none';

  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label="重複用藥警示"
      title="重複用藥警示（紅 Critical / 橘 High / 黃 Moderate / 藍 Low）"
    >
      {critical > 0 && (
        <span className={`${pillBase} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200`}>
          🔴 {critical}
        </span>
      )}
      {high > 0 && (
        <span className={`${pillBase} bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200`}>
          🟠 {high}
        </span>
      )}
      {moderate > 0 && (
        <span className={`${pillBase} bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200`}>
          🟡 {moderate}
        </span>
      )}
      {low > 0 && (
        <span className={`${pillBase} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200`}>
          🔵 {low}
        </span>
      )}
    </span>
  );
}

export default PatientDuplicateBadge;
