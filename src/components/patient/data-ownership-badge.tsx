import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';

export type DataOwnership = 'auto' | 'manual' | 'orphan';

const ownershipClasses: Record<DataOwnership, string> = {
  auto: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  manual: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  orphan: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
};

export function DataOwnershipBadge({ kind, compact = false }: { kind: DataOwnership; compact?: boolean }) {
  const { t } = useTranslation('patient-tabs');
  return (
    <Badge
      variant="outline"
      title={t(`ownership.${kind}Description`)}
      className={`${ownershipClasses[kind]} shrink-0 font-medium ${compact ? 'h-4 px-1 text-[9px]' : 'h-5 px-1.5 text-[10px]'}`}
    >
      {t(`ownership.${kind}`)}
    </Badge>
  );
}

export function DataOwnershipLegend() {
  const { t } = useTranslation('patient-tabs');
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>{t('ownership.legend')}</span>
      <DataOwnershipBadge kind="auto" />
      <DataOwnershipBadge kind="manual" />
      <DataOwnershipBadge kind="orphan" />
    </div>
  );
}
