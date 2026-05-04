import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Pill } from 'lucide-react';
import {
  getDischargeCheck,
  type DischargeCheckResponse,
  type DischargeMissedCategory,
  type DischargeMissedDiscontinuation,
  type DischargeMissedSeverity,
} from '../../lib/api/discharge';
import { useApiQuery } from '../../hooks/use-api-query';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/utils';
import { MedicationDuplicateBadges } from './medication-duplicate-badges';
import { useTranslation } from 'react-i18next';

/**
 * Wave 6a — 出院用藥檢查 panel
 *
 * Renders two diagnostic sections for a discharged patient:
 *   1. Missed discontinuations (住院啟用但出院未列的藥物)
 *   2. Discharge medication duplicates (reuses <MedicationDuplicateBadges />)
 *
 * Data source: `GET /patients/{id}/discharge-check` — typed client in
 * `src/lib/api/discharge.ts`.
 */

// ── UI constants ────────────────────────────────────────────────────
// Category labels resolved via t('discharge.categories.<key>').

const SEVERITY_CONFIG: Record<DischargeMissedSeverity, { icon: string; label: string; pill: string; row: string; text: string }> = {
  high: {
    icon: '🔴',
    label: 'High',
    pill: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-800',
    row: 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-900',
    text: 'text-red-800 dark:text-red-300',
  },
  moderate: {
    icon: '🟡',
    label: 'Moderate',
    pill: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
    row: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800',
    text: 'text-yellow-800 dark:text-yellow-300',
  },
  low: {
    icon: '🔵',
    label: 'Low',
    pill: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700',
    row: 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800',
    text: 'text-blue-800 dark:text-blue-300',
  },
};

// ── Component ───────────────────────────────────────────────────────
export interface DischargeCheckPanelProps {
  patientId: string;
  className?: string;
}

export function DischargeCheckPanel({ patientId, className }: DischargeCheckPanelProps) {
  const { t } = useTranslation('patient-chat');
  const { data, isLoading, isError, error } = useApiQuery<DischargeCheckResponse>({
    queryKey: ['discharge-check', patientId],
    queryFn: () => getDischargeCheck(patientId),
    enabled: Boolean(patientId),
    staleTime: 30_000,
    retry: 0,
  });

  return (
    <Card className={cn('border-brand/30', className)}>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ClipboardCheck className="h-4 w-4 text-brand" />
            {t('discharge.title')}
          </CardTitle>
          {data && <SummaryCounts data={data} />}
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('discharge.loading')}
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">{t('discharge.errorTitle')}</div>
              <div className="opacity-80">
                {error instanceof Error ? error.message : t('discharge.retryHint')}
              </div>
            </div>
          </div>
        )}

        {data && !isLoading && !isError && (
          <DischargeCheckBody data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCounts({ data }: { data: DischargeCheckResponse }) {
  const { t } = useTranslation('patient-chat');
  const missed = data.counts.missedDiscontinuations;
  const dup = data.counts.dischargeDuplicates;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <Badge
        variant="outline"
        className={cn(
          missed > 0
            ? 'bg-red-50 border-red-300 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300'
            : 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300',
        )}
      >
        {t('discharge.missedSummary', { count: missed })}
      </Badge>
      {(['critical', 'high', 'moderate', 'low', 'info'] as const).map((lvl) => {
        const n = dup[lvl];
        if (!n) return null;
        const palette: Record<typeof lvl, string> = {
          critical: 'bg-red-100 border-red-300 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300',
          high: 'bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-300',
          moderate: 'bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-950/40 dark:border-yellow-700 dark:text-yellow-300',
          low: 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-300',
          info: 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300',
        };
        return (
          <Badge key={lvl} variant="outline" className={palette[lvl]}>
            {t('discharge.duplicateSummary', { level: lvl, count: n })}
          </Badge>
        );
      })}
    </div>
  );
}

function DischargeCheckBody({ data }: { data: DischargeCheckResponse }) {
  const { t } = useTranslation('patient-chat');
  const missed = data.missedDiscontinuations ?? [];
  const duplicates = data.dischargeDuplicates ?? [];
  const bothEmpty = missed.length === 0 && duplicates.length === 0;

  if (bothEmpty) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="font-medium">{t('discharge.allClear')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section A — missed discontinuations */}
      {missed.length > 0 && (
        <section>
          <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            {t('discharge.missedSection', { count: missed.length })}
          </h5>
          <ul className="space-y-1.5">
            {missed.map((m, idx) => {
              const cfg = SEVERITY_CONFIG[m.severity] ?? SEVERITY_CONFIG.low;
              return (
                <li
                  key={`${m.medicationId}-${idx}`}
                  className={cn('rounded-md border px-3 py-2 text-xs', cfg.row)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold tabular-nums',
                        cfg.pill,
                      )}
                    >
                      <span>{cfg.icon} {cfg.label}</span>
                    </span>
                    <Pill className={cn('h-3 w-3 shrink-0', cfg.text)} aria-hidden />
                    <span className={cn('font-semibold', cfg.text)}>
                      {m.genericName || '—'}
                      {m.atcCode && (
                        <span className="opacity-75 font-normal">{t('discharge.atcCode', { code: m.atcCode })}</span>
                      )}
                    </span>
                    <span className={cn('opacity-90', cfg.text)}>
                      — {t(`discharge.categories.${m.category}`, { defaultValue: t('discharge.categories.other') })}
                    </span>
                    {m.inpatientStartDate && (
                      <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {t('discharge.inpatientStartLabel', { date: m.inpatientStartDate })}
                      </span>
                    )}
                  </div>
                  {m.reason && (
                    <p className={cn('mt-1 text-[11px] leading-relaxed', cfg.text)}>
                      {m.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Section B — discharge medication duplicates */}
      {duplicates.length > 0 && (
        <section>
          <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            {t('discharge.duplicateSection', { count: duplicates.length })}
          </h5>
          <MedicationDuplicateBadges alerts={duplicates} />
        </section>
      )}
    </div>
  );
}

export default DischargeCheckPanel;
