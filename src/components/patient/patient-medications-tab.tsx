import { lazy, Suspense, useState, useMemo } from 'react';
import type { Medication, Patient } from '../../lib/api';
import type { UserRole } from '../../lib/auth-context';
import { isAntibiotic } from '../../lib/antibiotic-codes';
import {
  formatDoseValue,
  isOutpatientExpired,
  isPrnOrStat,
  formatMedDate,
  formatMedDateFromDate,
  parseMedicationTime,
  formatOutpatientGroupDate,
  getMedicationEndDate,
  formatMedicationConcentration,
  MED_CATEGORY_COLORS,
  painColor,
  rassColor,
  formatScoreTimestamp,
} from '../../lib/medications/medication-formatters';
import { detectDuplicates } from '../../lib/medications/duplicate-overlap';
import { ScoreSelector } from './medications/score-selector';
import { DataOwnershipBadge, DataOwnershipLegend } from './data-ownership-badge';
import { SanCategoryBadge, SanMedCard } from './medications/san-med-card';
import { MedicationDetailModal } from './medications/medication-detail-modal';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { MedicationsSkeleton } from '../ui/skeletons';
import { TabsContent } from '../ui/tabs';
import { useTranslation } from 'react-i18next';

// Lazy-load recharts-backed trend chart (H4: keep 411 KB charts-*.js off the critical path)
const ScoreTrendChart = lazy(() =>
  import('../score-trend-chart').then((m) => ({ default: m.ScoreTrendChart }))
);

interface PatientMedicationsTabProps {
  patientId?: string;
  patient?: Patient;
  userRole?: UserRole;
  medicationsLoading: boolean;
  nmbIndication?: string;
  painMedications: Medication[];
  sedationMedications: Medication[];
  nmbMedications: Medication[];
  otherMedications: Medication[];
  outpatientMedications?: Medication[];
  formatDisplayValue: (value: unknown) => string;
  formatMedicationRegimen: (medication: Medication) => string;
  painScoreValue: number | null;
  painScoreOwnership: 'auto' | 'orphan';
  rassScoreValue: number | null;
  painScoreTimestamp?: string | null;
  rassScoreTimestamp?: string | null;
  onRecordScore: (scoreType: 'pain' | 'rass', value: number) => Promise<void>;
  onOpenScoreTrend: (scoreType: 'pain' | 'rass') => void;
  scoreTrendOpen: boolean;
  scoreTrendType: 'pain' | 'rass';
  scoreTrendData: { date: string; value: number }[];
  scoreEntries: import('@/lib/api/scores').ScoreEntry[];
  onDeleteScoreEntry?: (scoreId: string) => Promise<void>;
  onCloseScoreTrend: () => void;
}

export function PatientMedicationsTab({
  patientId,
  medicationsLoading,
  nmbIndication,
  painMedications,
  sedationMedications,
  nmbMedications,
  otherMedications,
  outpatientMedications,
  formatDisplayValue,
  formatMedicationRegimen,
  painScoreValue,
  painScoreOwnership,
  rassScoreValue,
  painScoreTimestamp,
  rassScoreTimestamp,
  onRecordScore,
  onOpenScoreTrend,
  scoreTrendOpen,
  scoreTrendType,
  scoreTrendData,
  scoreEntries,
  onDeleteScoreEntry,
  onCloseScoreTrend,
}: PatientMedicationsTabProps) {
  const { t } = useTranslation('medications');
  // medView：all=全部 / active=使用中 / regular=常規（使用中且非 PRN,STAT）/ discontinued=已停用 / duplicate=重複用藥
  const [medView, setMedView] = useState<'active' | 'regular' | 'discontinued' | 'all' | 'duplicate'>('active');
  const [rassPending, setRassPending] = useState<number | null>(null);
  const [selfSuppliedFilter, setSelfSuppliedFilter] = useState(false);
  const [detailMedication, setDetailMedication] = useState<Medication | null>(null);
  const isDiscontinued = (med: Medication) =>
    med.status === 'discontinued' || med.status === 'completed' || med.status === 'on-hold';

  // Separate active vs discontinued across all groups
  const activePainMeds = painMedications.filter((m) => !isDiscontinued(m));
  const activeSedationMeds = sedationMedications.filter((m) => !isDiscontinued(m));
  const activeNmbMeds = nmbMedications.filter((m) => !isDiscontinued(m));
  const activeOtherMeds = otherMedications.filter((m) => !isDiscontinued(m));

  const allDiscontinuedMeds = [
    ...painMedications.filter(isDiscontinued),
    ...sedationMedications.filter(isDiscontinued),
    ...nmbMedications.filter(isDiscontinued),
    ...otherMedications.filter(isDiscontinued),
  ];

  const allOtherMeds = [...activeOtherMeds, ...allDiscontinuedMeds];
  const regularOtherMeds = activeOtherMeds.filter((m) => !isPrnOrStat(m));
  const activeCount = activeOtherMeds.length;
  const regularCount = regularOtherMeds.length;
  const discontinuedCount = allDiscontinuedMeds.length;
  const totalCount = allOtherMeds.length;

  // Outpatient medications — grouped by start date + department + days supply, sorted by nearest date first
  const allOutpatientMeds = outpatientMedications || [];
  const activeOutpatientMeds = allOutpatientMeds.filter((m) => !isOutpatientExpired(m) && m.status !== 'discontinued');
  const outpatientCount = allOutpatientMeds.length;
  const selfSuppliedMeds = allOutpatientMeds.filter((m) => m.sourceType === 'self-supplied');
  const visibleOutpatientMeds = selfSuppliedFilter ? selfSuppliedMeds : allOutpatientMeds;

  const outpatientGroups = useMemo(() => {
    const groups = new Map<string, { label: string; sortTime: number; meds: Medication[] }>();
    const medsSortedWithinGroup = [...visibleOutpatientMeds].sort((a, b) => {
      const timeDiff = parseMedicationTime(b.startDate) - parseMedicationTime(a.startDate);
      if (timeDiff !== 0) return timeDiff;
      return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
    });

    for (const med of medsSortedWithinGroup) {
      const dept = med.prescribingDepartment || t('tab.outpatientGroup.noDept');
      const groupDate = formatOutpatientGroupDate(med.startDate, t('tab.outpatientGroup.noDate'));
      const key = `${groupDate}__${dept}`;
      const existing = groups.get(key);
      if (existing) {
        existing.meds.push(med);
        existing.sortTime = Math.max(existing.sortTime, parseMedicationTime(med.startDate));
        continue;
      }
      groups.set(key, {
        label: `${groupDate}${dept}`,
        sortTime: parseMedicationTime(med.startDate),
        meds: [med],
      });
    }

    return [...groups.values()].sort((a, b) => b.sortTime - a.sortTime);
  }, [visibleOutpatientMeds, t]);

  // Current base list depends on view mode
  const baseMeds =
    medView === 'active' ? activeOtherMeds
    : medView === 'regular' ? regularOtherMeds
    : medView === 'discontinued' ? allDiscontinuedMeds
    : allOtherMeds;

  // Sort by prescription start date ascending (earliest first)
  const sortOtherMeds = (meds: Medication[]) => [...meds].sort((a, b) => {
    const dateA = a.startDate || '';
    const dateB = b.startDate || '';
    return dateA.localeCompare(dateB);
  });

  const displayedMeds = sortOtherMeds(baseMeds);
  // Duplicate medication detection: same generic across inpatient ↔ outpatient (active only)
  const duplicateMeds = useMemo(() => {
    const allActiveInpatient = [...activePainMeds, ...activeSedationMeds, ...activeNmbMeds, ...activeOtherMeds];
    return detectDuplicates(allActiveInpatient, activeOutpatientMeds);
  }, [activePainMeds, activeSedationMeds, activeNmbMeds, activeOtherMeds, activeOutpatientMeds]);

  return (
    <TabsContent value="meds" className="space-y-3">
      {medicationsLoading ? (
        <MedicationsSkeleton />
      ) : (
        <>
          <DataOwnershipLegend />

          {/* S/A/N 藥物 */}
          <div className="grid gap-3 md:grid-cols-3">
            {/* Pain (A) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.painCardTitle')}</CardTitle>
                    <DataOwnershipBadge kind={painScoreOwnership} compact />
                    {painScoreValue !== null && (
                      <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                        {painScoreValue}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('pain')}
                  >
                    {t('tab.main.trendButton')}
                  </Button>
                </div>
                {painScoreTimestamp && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('tab.main.lastRecorded', { timestamp: formatScoreTimestamp(painScoreTimestamp) })}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {painScoreOwnership === 'orphan' && (
                  <ScoreSelector
                    min={0}
                    max={10}
                    currentValue={painScoreValue}
                    onSelect={(v) => onRecordScore('pain', v)}
                    colorFn={painColor}
                  />
                )}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.painMedsLabel')}</p>
                  {activePainMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">{t('tab.main.painMedsEmpty')}</p>
                  ) : (
                    <div className="space-y-2">
                      {activePainMeds.map((medication) => (
                        <SanMedCard key={medication.id} medication={medication} onDetail={setDetailMedication} />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sedation (S) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.rassCardTitle')}</CardTitle>
                    <DataOwnershipBadge kind="manual" compact />
                    {(() => {
                      const display = rassPending ?? rassScoreValue;
                      if (display === null) return null;
                      return (
                        <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                          {display > 0 ? `+${display}` : display}
                        </span>
                      );
                    })()}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('rass')}
                  >
                    {t('tab.main.trendButton')}
                  </Button>
                </div>
                {rassPending === null && rassScoreTimestamp && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('tab.main.lastRecorded', { timestamp: formatScoreTimestamp(rassScoreTimestamp) })}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreSelector
                  min={-5}
                  max={4}
                  currentValue={rassScoreValue}
                  onSelect={(v) => onRecordScore('rass', v)}
                  onPendingChange={setRassPending}
                  formatLabel={(v) => v > 0 ? `+${v}` : `${v}`}
                  colorFn={rassColor}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.sedationMedsLabel')}</p>
                  {activeSedationMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">{t('tab.main.sedationMedsEmpty')}</p>
                  ) : (
                    <div className="space-y-2">
                      {activeSedationMeds.map((medication) => (
                        <SanMedCard key={medication.id} medication={medication} onDetail={setDetailMedication} />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Neuromuscular Blockade (N) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.nmbCardTitle')}</CardTitle>
                  <DataOwnershipBadge kind="auto" compact />
                </div>
                <CardDescription className="text-sm leading-tight">
                  {nmbIndication || '-'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.nmbMedsLabel')}</p>
                {activeNmbMeds.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">{t('tab.main.nmbMedsEmpty')}</p>
                ) : (
                  <div className="space-y-2">
                    {activeNmbMeds.map((medication) => (
                      <SanMedCard key={medication.id} medication={medication} onDetail={setDetailMedication} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Inpatient Medications */}
          <Card className={`border-border ${medView === 'discontinued' ? 'border-dashed' : ''}`}>
            <CardHeader className="pb-2 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.inpatientCardTitle')}</CardTitle>
              </div>
              {/* 主要切換：全部 / 使用中 / 常規 / 已停用 */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'all' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('all')}
                  >
                    {t('tab.main.viewAll', { count: totalCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'active' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('active')}
                  >
                    {t('tab.main.viewActive', { count: activeCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={regularCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'regular' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('regular')}
                  >
                    {t('tab.main.viewRegular', { count: regularCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={discontinuedCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'discontinued' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('discontinued')}
                  >
                    {t('tab.main.viewDiscontinued', { count: discontinuedCount })}
                  </Button>
                </div>
                {duplicateMeds.length > 0 && (
                  <Button
                    variant={medView === 'duplicate' ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${medView === 'duplicate' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}
                    onClick={() => setMedView(medView === 'duplicate' ? 'active' : 'duplicate')}
                  >
                    {t('tab.main.viewDuplicate', { count: duplicateMeds.length })}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/*
                DDI + duplicate-medication badges are no longer auto-rendered
                on this tab — they live under the standalone 藥事工具 pages:
                「交互作用查詢」 (/pharmacy/interactions) and 「重複用藥」
                (/pharmacy/duplicates). The in-tab "重複用藥 ({N})" toggle
                below is a *different* check: same-generic overlap between
                inpatient orders and outpatient self-supplied meds.
              */}
              {medView === 'duplicate' ? (
                <div className="space-y-2">
                  <p className="text-xs text-orange-700 dark:text-orange-400 mb-2">
                    {t('tab.main.duplicateExplain')}
                  </p>
                  {duplicateMeds.map((dup) => (
                    <div key={dup.generic} className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-semibold text-sm text-orange-900 dark:text-orange-300">{dup.generic}</p>
                        <Badge className="bg-orange-200 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-950/30 text-xs px-1.5 py-0 h-4">
                          {t('tab.main.duplicateBadge')}
                        </Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {dup.inpatient.map((m) => (
                          <div
                            key={m.id}
                            className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer hover:shadow-sm transition-shadow"
                            onClick={() => setDetailMedication(m)}
                          >
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 shrink-0">{t('tab.main.inpatientBadge')}</Badge>
                              <SanCategoryBadge category={m.sanCategory} />
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${formatDoseValue(m.dose)} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
                              {m.startDate && ` (${formatMedDate(m.startDate)})`}
                            </p>
                          </div>
                        ))}
                        {dup.outpatient.map((m) => (
                          <div
                            key={m.id}
                            className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-1.5 cursor-pointer hover:shadow-sm transition-shadow"
                            onClick={() => setDetailMedication(m)}
                          >
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 shrink-0">{t('tab.main.outpatientBadge')}</Badge>
                              <SanCategoryBadge category={m.sanCategory} />
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${formatDoseValue(m.dose)} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
                              {m.prescribingDepartment && ` [${m.prescribingDepartment}]`}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <>
              {medView === 'discontinued' && (
                <p className="mb-2 text-xs text-muted-foreground">{t('tab.main.discontinuedHint')}</p>
              )}
              {displayedMeds.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {medView === 'regular'
                    ? t('tab.main.noRegular')
                    : medView === 'discontinued'
                    ? t('tab.main.noDiscontinued')
                    : medView === 'all'
                    ? t('tab.main.noAll')
                    : t('tab.main.noActive')}
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayedMeds.map((medication) => {
                    const category = medication.category;
                    const categoryColor = category ? MED_CATEGORY_COLORS[category] : undefined;
                    const abx = isAntibiotic(medication);
                    const prn = isPrnOrStat(medication);
                    const isStat = medication.frequency?.toUpperCase() === 'STAT';
                    const discontinued = isDiscontinued(medication);
                    return (
                      <div
                        key={medication.id}
                        className={`rounded-md border px-3 py-2 cursor-pointer hover:shadow-md transition-shadow ${
                          discontinued
                            ? 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-800 opacity-75'
                            : abx
                              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                              : 'bg-[rgba(196,196,196,0.15)] dark:bg-slate-800/50'
                        }`}
                        onClick={() => setDetailMedication(medication)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-medium leading-tight ${discontinued ? 'text-gray-500 dark:text-gray-400 line-through' : ''}`}>
                              {formatDisplayValue(medication.name)}
                            </p>
                            {discontinued ? (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {t(`tab.detailModal.${medication.status === 'completed' ? 'completed' : medication.status === 'on-hold' ? 'onHold' : 'discontinued'}`)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                                {t('tab.detailModal.active')}
                              </Badge>
                            )}
                            {abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 ${discontinued ? 'opacity-60' : ''}`}>
                                {t('tab.main.antibioticBadge')}
                              </Badge>
                            )}
                            {prn && !discontinued && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-violet-100 dark:bg-violet-950/30 text-violet-800 dark:text-violet-300">
                                {isStat ? 'STAT' : 'PRN'}
                              </Badge>
                            )}
                            <SanCategoryBadge
                              category={medication.sanCategory}
                              className={discontinued ? 'opacity-60' : ''}
                            />
                            {categoryColor && !abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 ${categoryColor} ${discontinued ? 'opacity-60' : ''}`}>
                                {t(`tab.categories.${category}`, { defaultValue: category })}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className={`mt-1 flex items-center gap-2 text-sm ${discontinued ? 'text-gray-400 dark:text-gray-500' : 'text-muted-foreground'}`}>
                          <span>{formatMedicationRegimen(medication)}</span>
                          {medication.startDate && (
                            <span className="text-xs">{formatMedDate(medication.startDate)}</span>
                          )}
                          {discontinued && medication.endDate && (
                            <span className="text-xs">→ {formatMedDate(medication.endDate)}</span>
                          )}
                        </div>
                        {!discontinued && formatMedicationConcentration(medication) && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('tab.main.concentrationLabel', { value: formatMedicationConcentration(medication) })}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>

          {/* Outpatient Medications — grouped by prescribing department */}
          {outpatientCount > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20">
              <CardHeader className="pb-2">
                <div className="flex flex-col items-start gap-2">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">
                    {t('tab.main.outpatientCardTitle')}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">({outpatientCount})</span>
                  </CardTitle>
                  <Button
                    variant={selfSuppliedFilter ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={selfSuppliedFilter}
                    className={
                      selfSuppliedFilter
                        ? 'h-7 px-3 text-xs bg-brand text-white border-brand hover:bg-brand-hover'
                        : 'h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]'
                    }
                    onClick={() => setSelfSuppliedFilter((v) => !v)}
                  >
                    {t('tab.main.selfSuppliedFilter')}
                    {selfSuppliedMeds.length > 0 && (
                      <span className={`ml-1 ${selfSuppliedFilter ? 'text-white/80' : 'text-muted-foreground'}`}>
                        ({selfSuppliedMeds.length})
                      </span>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {selfSuppliedFilter && outpatientGroups.length === 0 && (
                  <p className="py-3 text-sm text-muted-foreground">{t('tab.main.noSelfSupplied')}</p>
                )}
                {outpatientGroups.map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                        {group.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{t('tab.outpatientGroup.countSuffix', { count: group.meds.length })}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {group.meds.map((medication) => (
                        (() => {
                          const displayEndDate = getMedicationEndDate(medication);
                          return (
                            <div
                              key={medication.id}
                              className="rounded-md border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 px-3 py-2 cursor-pointer hover:shadow-md transition-shadow"
                              onClick={() => setDetailMedication(medication)}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium leading-tight">
                                  {formatDisplayValue(medication.name)}
                                </p>
                                {medication.sourceCampus && (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                                    {medication.sourceCampus}
                                  </Badge>
                                )}
                                <SanCategoryBadge category={medication.sanCategory} />
                                {medication.sourceType === 'self-supplied' ? (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                                    {t('tab.detailModal.selfSupplied')}
                                  </Badge>
                                ) : medication.isExternal ? (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                                    {t('tab.detailModal.external')}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <span>{formatMedicationRegimen(medication)}</span>
                                {medication.daysSupply != null && (
                                  <span className="text-xs">{t('tab.outpatientGroup.daysSupplyCompact', { days: medication.daysSupply })}</span>
                                )}
                              </div>
                              {medication.startDate && (
                                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                  {t('tab.outpatientGroup.issuedPrefix', { date: formatMedDate(medication.startDate) })}
                                  {displayEndDate && <span> → {t('tab.outpatientGroup.untilSuffix', { date: formatMedDateFromDate(displayEndDate) })}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Score Trend Chart Dialog */}
          {scoreTrendOpen && (
            <Suspense fallback={null}>
              <ScoreTrendChart
                isOpen={scoreTrendOpen}
                onClose={onCloseScoreTrend}
                scoreType={scoreTrendType}
                trendData={scoreTrendData}
                scoreEntries={scoreEntries}
                onDeleteEntry={onDeleteScoreEntry}
              />
            </Suspense>
          )}

          <MedicationDetailModal
            medication={detailMedication}
            open={detailMedication !== null}
            onClose={() => setDetailMedication(null)}
          />

        </>
      )}
    </TabsContent>
  );
}
