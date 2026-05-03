import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { AdviceRef } from '../../lib/api/ai';
import { useTranslation } from 'react-i18next';

/**
 * F3: deep-link chip group rendered below an assistant bubble whenever the
 * backend's question-prefetch found pharmacy advice records relevant to
 * this turn. Each chip jumps to /pharmacy/advice-statistics?advice_id=...
 * which highlights and scrolls to the record card.
 *
 * Names are already masked server-side; the chip shows bed + date + label
 * only so a pharmacist scanning the chat doesn't accidentally read a
 * patient name from a cross-bed search result.
 *
 * Originally inline in chat-message-thread.tsx; extracted F-PARITY
 * (2026-05-03) so patient-chat-tab can render the same chips.
 */
export interface AdviceRefChipsProps {
  refs: AdviceRef[];
}

const VISIBLE_LIMIT = 5;

export function AdviceRefChips({ refs }: AdviceRefChipsProps) {
  const { t, i18n } = useTranslation('chat');
  if (!refs || refs.length === 0) return null;

  // Cap visible chips to keep the bubble scannable; the rest fold under "+N"
  // (no expansion — the user can re-ask if they need them all).
  const visible = refs.slice(0, VISIBLE_LIMIT);
  const overflow = refs.length - visible.length;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#E5E7EB] dark:border-slate-700 pt-1.5">
      <span className="text-[11px] text-[#9CA3AF]">{t('adviceRefs.header')}</span>
      {visible.map((ref) => {
        const bed = ref.bedNumber || t('adviceRefs.bedFallback');
        const dateLabel = formatAdviceChipDate(ref.timestamp);
        const codeLabel = ref.adviceCode || ref.adviceLabel || '';
        const tooltip = [
          ref.patientNameMasked,
          ref.adviceLabel,
          ref.timestamp ? new Date(ref.timestamp).toLocaleString(i18n.language) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        // Pass both advice_id and month so the target page can swap month
        // before scrolling — without it, an advice from last month never
        // appears in the current-month list and the highlight silently
        // fails.
        const monthQuery = monthFromIso(ref.timestamp);
        const href = monthQuery
          ? `/pharmacy/advice-statistics?advice_id=${encodeURIComponent(ref.id)}&month=${monthQuery}`
          : `/pharmacy/advice-statistics?advice_id=${encodeURIComponent(ref.id)}`;
        return (
          <Link
            key={ref.id}
            to={href}
            title={tooltip || ref.id}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] text-[#374151] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="font-medium">{bed}</span>
            {dateLabel && <span className="text-[#9CA3AF]">{dateLabel}</span>}
            {codeLabel && <span className="text-[#6B7280]">· {codeLabel}</span>}
            <ExternalLink className="h-2.5 w-2.5 text-[#9CA3AF]" />
          </Link>
        );
      })}
      {overflow > 0 && (
        <span className="text-[11px] text-[#9CA3AF]">{t('adviceRefs.overflow', { count: overflow })}</span>
      )}
    </div>
  );
}

function formatAdviceChipDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Compact "5/3 14:30" — short enough for a chip, still anchor-able.
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function monthFromIso(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
