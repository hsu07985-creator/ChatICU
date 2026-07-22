// SanMedCard — compact card for an S/A/N (sedation / analgesia / NMB) medication.
// Extracted from patient-medications-tab.tsx (behavior-preserving).
import { useTranslation } from 'react-i18next';
import type { Medication } from '../../../lib/api';

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

  return (
    <div className="rounded-md border dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 space-y-1.5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onDetail(medication)}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium leading-tight">
          {medication.name || '—'}
          {spec && <span className="font-normal text-muted-foreground ml-1.5">{spec}</span>}
        </p>
      </div>
      {noteText && (
        <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('tab.sanMedCard.orderNote')}</p>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{noteText}</p>
        </div>
      )}
    </div>
  );
}
