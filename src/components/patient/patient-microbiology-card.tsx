import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Microscope,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  getCultureSusceptibility,
  type CulturePanel,
  type CultureRecordType,
  type CultureStatus,
  type CultureSusceptibilityData,
  type SusceptibilityResult,
} from '../../lib/api/microbiology';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../ui/state-display';

type SpecimenCategory = 'sputum' | 'urine' | 'blood' | 'other';
type RecordFilter = 'all' | CultureRecordType;
type SpecimenFilter = 'all' | SpecimenCategory;

const STATUS_STYLES: Record<CultureStatus, string> = {
  positive: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  negative: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
  normal_flora: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  indeterminate: 'border-border bg-muted text-muted-foreground',
  reported: 'border-brand/25 bg-brand/5 text-brand dark:border-brand/40 dark:bg-brand/10',
};

const RESULT_STYLES: Record<SusceptibilityResult['result'], string> = {
  R: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  I: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  S: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
};

function classifySpecimen(specimen: string): SpecimenCategory {
  const value = specimen.toLowerCase();
  if (value.includes('sputum') || value.includes('痰')) return 'sputum';
  if (value.includes('urine') || value.includes('尿')) return 'urine';
  if (value.includes('blood') || value.includes('血')) return 'blood';
  return 'other';
}

function sortSusceptibility(items: SusceptibilityResult[]): SusceptibilityResult[] {
  const order = { R: 0, I: 1, S: 2 };
  return [...items].sort((a, b) => order[a.result] - order[b.result]
    || a.antibiotic.localeCompare(b.antibiotic));
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function SummaryChip({ label, value, icon, tone }: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-gradient-to-br from-white to-slate-50 px-2.5 py-1.5 text-sm dark:from-slate-900 dark:to-slate-800">
      <span className={tone}>{icon}</span>
      <strong className="tabular-nums text-foreground">{value}</strong>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function ResultCounts({ panel }: { panel: CulturePanel }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(['R', 'I', 'S'] as const).map((result) => {
        const count = panel.susceptibility.filter((item) => item.result === result).length;
        return count > 0 ? (
          <Badge key={result} variant="outline" className={`h-5 px-1.5 font-semibold ${RESULT_STYLES[result]}`}>
            {result} {count}
          </Badge>
        ) : null;
      })}
    </div>
  );
}

function WorklistRow({ panel, locale }: { panel: CulturePanel; locale: string }) {
  const { t } = useTranslation('microbiology');
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const susceptibility = useMemo(
    () => sortSusceptibility(panel.susceptibility),
    [panel.susceptibility],
  );
  const timestamp = panel.collectedAt ?? panel.reportedAt;
  const isStain = panel.recordType === 'gram_stain';
  const hasResistance = panel.susceptibility.some((item) => item.result === 'R');
  const isAlert = panel.alerts.length > 0 || hasResistance;
  const summary = isStain
    ? panel.stainResults.map((item) => `${item.label} ${item.value}`).join(' · ')
      || panel.result || t('labels.awaitingResult')
    : panel.isolates.map((item) => item.organism).join(', ')
      || panel.result || t('labels.awaitingResult');
  const hasDetails = panel.alerts.length > 0
    || panel.isolates.length > 0
    || susceptibility.length > 0
    || panel.stainResults.length > 0;

  return (
    <article
      className={`border-l-4 bg-card ${
        isAlert
          ? 'border-l-red-400'
          : isStain
            ? 'border-l-brand'
            : 'border-l-transparent'
      }`}
      data-testid="microbiology-worklist-entry"
    >
      <button
        type="button"
        disabled={!hasDetails}
        className="grid w-full gap-2 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default md:grid-cols-[8.5rem_minmax(9rem,1fr)_minmax(13rem,1.5fr)_minmax(8rem,.8fr)_auto] md:items-center"
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? detailsId : undefined}
        onClick={() => hasDetails && setOpen((value) => !value)}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground">
          {hasDetails
            ? open
              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <span className="w-4" />}
          {formatDateTime(timestamp, locale)}
        </span>

        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">
            {panel.specimen || t('labels.unknownSpecimen')}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline" className={`h-5 px-1.5 ${
              isStain
                ? 'border-brand/25 bg-brand/5 text-brand dark:border-brand/40 dark:bg-brand/10'
                : 'border-brand/20 bg-brand/5 text-brand dark:border-brand/40 dark:bg-brand/10'
            }`}>
              {isStain ? <Microscope className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
              {t(`recordTypes.${panel.recordType}`)}
            </Badge>
            <Badge variant="outline" className={`h-5 px-1.5 ${STATUS_STYLES[panel.status]}`}>
              {t(`statuses.${panel.status}`)}
            </Badge>
            {panel.qScore != null && (
              <Badge variant="outline" className="h-5 border-border bg-muted px-1.5 text-muted-foreground">
                Q{panel.qScore}
              </Badge>
            )}
          </span>
        </span>

        <span className={`min-w-0 truncate text-sm ${isStain ? 'text-brand' : 'text-foreground'}`}>
          {summary}
        </span>

        <span className="min-w-0 text-xs text-muted-foreground">
          {[panel.campusName, panel.department].filter(Boolean).join(' · ') || '—'}
        </span>

        <span className="flex items-center justify-between gap-2 md:justify-end">
          <ResultCounts panel={panel} />
          {isAlert && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-label={t('labels.alert')} />}
        </span>
      </button>

      {open && hasDetails && (
        <div id={detailsId} className="space-y-4 border-t border-border bg-muted/30 px-4 py-4">
          {panel.alerts.map((alert) => (
            <div key={alert} className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span><strong>{t('labels.alert')}:</strong> {alert}</span>
            </div>
          ))}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {panel.department && <span>{t('labels.department')}: {panel.department}</span>}
            {panel.campusName && <span>{t('labels.campus')}: {panel.campusName}</span>}
            {panel.reportedAt && panel.reportedAt !== timestamp && (
              <span>{t('labels.reportedAt')}: {formatDateTime(panel.reportedAt, locale)}</span>
            )}
          </div>

          {panel.isolates.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-semibold text-muted-foreground">{t('labels.organisms')}</h5>
              <div className="flex flex-wrap gap-2">
                {panel.isolates.map((isolate) => (
                  <span key={`${isolate.code}-${isolate.organism}`} className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground">
                    <span className="font-semibold">{isolate.organism}</span>
                    {isolate.colonies && <span className="ml-2 text-xs text-muted-foreground">{t('labels.colonies')}: {isolate.colonies}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {panel.stainResults.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-semibold text-brand">{t('labels.stainResults')}</h5>
              <div className="grid gap-2 sm:grid-cols-2">
                {panel.stainResults.map((item) => (
                  <div key={`${item.code}-${item.label}`} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <strong className="text-foreground">{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {susceptibility.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t('labels.antibiotic')}</th>
                    <th className="px-3 py-2 text-center font-semibold">{t('labels.interpretation')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('labels.mic')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {susceptibility.map((item) => (
                    <tr key={`${item.code}-${item.antibiotic}`}>
                      <td className="px-3 py-2 font-medium text-foreground">{item.antibiotic}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={`h-5 min-w-7 px-1.5 font-semibold ${RESULT_STYLES[item.result]}`}>
                          {item.result}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{item.mic || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

interface PatientMicrobiologyCardProps {
  patientId: string;
}

export function PatientMicrobiologyCard({ patientId }: PatientMicrobiologyCardProps) {
  const { t, i18n } = useTranslation('microbiology');
  const [data, setData] = useState<CultureSusceptibilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordFilter, setRecordFilter] = useState<RecordFilter>('all');
  const [specimenFilter, setSpecimenFilter] = useState<SpecimenFilter>('all');
  const [onlyResistant, setOnlyResistant] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCultureSusceptibility(patientId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause?.message || t('error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patientId, t]);

  const cultures = useMemo(() => data?.cultures ?? [], [data]);
  const summary = useMemo(() => ({
    total: cultures.length,
    positive: cultures.filter((panel) => panel.status === 'positive').length,
    resistant: cultures.filter((panel) => panel.susceptibility.some((item) => item.result === 'R')).length,
    stains: cultures.filter((panel) => panel.recordType === 'gram_stain').length,
    alerts: cultures.reduce((count, panel) => count + panel.alerts.length, 0),
  }), [cultures]);

  const filtered = useMemo(() => cultures
    .filter((panel) => recordFilter === 'all' || panel.recordType === recordFilter)
    .filter((panel) => specimenFilter === 'all' || classifySpecimen(panel.specimen) === specimenFilter)
    .filter((panel) => !onlyResistant || panel.susceptibility.some((item) => item.result === 'R'))
    .sort((a, b) => (b.collectedAt ?? b.reportedAt ?? '').localeCompare(a.collectedAt ?? a.reportedAt ?? '')),
  [cultures, onlyResistant, recordFilter, specimenFilter]);

  const hasFilters = recordFilter !== 'all' || specimenFilter !== 'all' || onlyResistant;
  const resetFilters = () => {
    setRecordFilter('all');
    setSpecimenFilter('all');
    setOnlyResistant(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoadingSpinner size="md" text={t('loading')} />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>;
  }

  return (
    <section className="space-y-3" aria-label={t('title')}>
      <div className="flex flex-wrap gap-2 pr-12" data-testid="microbiology-summary">
        <SummaryChip label={t('summary.total')} value={summary.total} tone="text-muted-foreground" icon={<FlaskConical className="h-3.5 w-3.5" />} />
        <SummaryChip label={t('summary.positive')} value={summary.positive} tone="text-red-600 dark:text-red-400" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <SummaryChip label={t('summary.resistant')} value={summary.resistant} tone="text-orange-600 dark:text-orange-400" icon={<ShieldAlert className="h-3.5 w-3.5" />} />
        <SummaryChip label={t('summary.stains')} value={summary.stains} tone="text-brand" icon={<Microscope className="h-3.5 w-3.5" />} />
        <SummaryChip label={t('summary.alerts')} value={summary.alerts} tone="text-destructive" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 rounded-xl border border-border bg-slate-50 p-2 sm:flex sm:flex-wrap sm:items-center dark:bg-slate-800">
        <div className="col-span-3 inline-flex h-9 rounded-lg border border-border bg-background p-0.5 sm:col-auto dark:bg-slate-900" aria-label={t('filters.recordType')}>
          {(['all', 'culture', 'gram_stain'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={recordFilter === type}
              onClick={() => setRecordFilter(type)}
              className={`flex-1 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 sm:flex-none ${
                recordFilter === type
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {type === 'all' ? t('filters.allRecords') : t(`recordTypes.${type}`)}
            </button>
          ))}
        </div>

        <label className="sr-only" htmlFor="microbiology-specimen-filter">{t('filters.specimen')}</label>
        <select
          id="microbiology-specimen-filter"
          value={specimenFilter}
          onChange={(event) => setSpecimenFilter(event.target.value as SpecimenFilter)}
          className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-shadow focus:border-ring focus:ring-3 focus:ring-ring/50 sm:min-w-40 dark:bg-input/30"
        >
          <option value="all">{t('filters.allSpecimens')}</option>
          {(['sputum', 'urine', 'blood', 'other'] as const).map((category) => (
            <option key={category} value={category}>{t(`categories.${category}`)}</option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={onlyResistant}
          onClick={() => setOnlyResistant((value) => !value)}
          className={`h-9 rounded-md border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
            onlyResistant
              ? 'border-brand bg-brand text-white'
              : 'border-input bg-background text-foreground hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50'
          }`}
        >
          {t('filters.onlyResistant')}
        </button>

        <button
          type="button"
          disabled={!hasFilters}
          onClick={resetFilters}
          aria-label={t('filters.reset')}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('filters.reset')}</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
          {hasFilters ? t('empty.filtered') : t('empty.none')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="microbiology-worklist">
          <div className="hidden grid-cols-[8.5rem_minmax(9rem,1fr)_minmax(13rem,1.5fr)_minmax(8rem,.8fr)_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid">
            <span>{t('labels.date')}</span>
            <span>{t('labels.specimenResult')}</span>
            <span>{t('labels.result')}</span>
            <span>{t('labels.location')}</span>
            <span className="text-right">{t('labels.susceptibility')}</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((panel) => (
              <WorklistRow
                key={`${panel.sourceCampus || 'main'}-${panel.sheetNumber}-${panel.recordType}`}
                panel={panel}
                locale={i18n.resolvedLanguage || i18n.language}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
