// SanMedCard — compact card for an S/A/N (sedation / analgesia / NMB) medication.
// Extracted from patient-medications-tab.tsx (behavior-preserving).
import { useTranslation } from 'react-i18next';
import type { Medication } from '../../../lib/api';
import { formatDoseValue, formatMedDate } from '../../../lib/medications/medication-formatters';
import { Badge } from '../../ui/badge';

const SAN_BADGES = {
  A: { labelKey: 'tab.main.painMedsLabel', color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300' },
  S: { labelKey: 'tab.main.sedationMedsLabel', color: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300' },
  N: { labelKey: 'tab.main.nmbMedsLabel', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300' },
} as const;

export function SanCategoryBadge({
  category,
  className = '',
}: {
  category: Medication['sanCategory'];
  className?: string;
}) {
  const { t } = useTranslation('medications');
  if (!category) return null;
  const badge = SAN_BADGES[category];
  return (
    <Badge variant="secondary" className={`h-4 px-1.5 py-0 text-xs ${badge.color} ${className}`}>
      {category} {t(badge.labelKey)}
    </Badge>
  );
}

export function SanMedCard({
  medication,
  onDetail,
}: {
  medication: Medication;
  onDetail: (med: Medication) => void;
}) {
  const { t } = useTranslation('medications');
  const spec = medication.concentration || null;
  const noteText = medication.notes || null;
  const regimen = [
    [formatDoseValue(medication.dose), medication.unit].filter(Boolean).join(' '),
    medication.frequency,
    medication.route,
  ].filter(Boolean).join(' · ');
  const orderedAt = formatMedDate(medication.orderedAt);

  return (
    <div className="rounded-md border dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 space-y-1.5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onDetail(medication)}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium leading-tight">
          {medication.name || '—'}
          {spec && <span className="font-normal text-muted-foreground ml-1.5">{spec}</span>}
        </p>
        <SanCategoryBadge category={medication.sanCategory} />
      </div>
      {(regimen || orderedAt) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {regimen && <span>{regimen}</span>}
          {orderedAt && <span>{t('tab.sanMedCard.orderedAt', { date: orderedAt })}</span>}
        </div>
      )}
      {noteText && (
        <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('tab.sanMedCard.orderNote')}</p>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{noteText}</p>
        </div>
      )}
    </div>
  );
}
