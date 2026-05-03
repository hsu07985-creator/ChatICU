import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Archive,
  Eye,
  FlaskConical,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { patientsApi, type Patient } from '../lib/api';
import { maskPatientName } from '../lib/utils/patient-name';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ButtonLoadingIndicator } from '../components/ui/button-loading-indicator';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { EmptyState, ErrorDisplay } from '../components/ui/state-display';
import { TableSkeleton } from '../components/ui/skeletons';

type DischargeType = 'discharge' | 'transfer' | 'death' | 'other';

const DISCHARGE_TYPE_BADGE: Record<DischargeType, string> = {
  discharge: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200',
  transfer: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200',
  death: 'bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200',
  other: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200',
};

function computeStayDays(icuAdmission: string | null | undefined, discharge: string | null | undefined): number | null {
  if (!icuAdmission || !discharge) return null;
  const start = new Date(icuAdmission).getTime();
  const end = new Date(discharge).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 86400000));
}

export function DischargedPatientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation(['patients', 'dashboard']);

  const PAGE_SIZE = 100;

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [physician, setPhysician] = useState<'all' | string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const resp = await patientsApi.getPatients({
        archived: true,
        page: targetPage,
        limit: PAGE_SIZE,
      });
      const list = (resp.patients ?? []).filter((p) => p.archived !== false);
      setPatients((prev) => (append ? [...prev, ...list] : list));
      setPage(targetPage);
      setTotal(resp.pagination?.total ?? list.length);
      setTotalPages(resp.pagination?.totalPages ?? 1);
    } catch (err) {
      console.error(`${t('patients:discharged.loadErrorLog')}:`, err);
      setError(t('patients:discharged.loadErrorMessage'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [t]);

  const refetchFromStart = useCallback(() => {
    setPatients([]);
    setSelectedIds(new Set());
    void fetchPage(1, false);
  }, [fetchPage]);

  useEffect(() => {
    void fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMore = page < totalPages;
  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    void fetchPage(page + 1, true);
  }, [fetchPage, hasMore, loading, loadingMore, page]);

  // IntersectionObserver — auto-load next page when sentinel is near viewport
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [loadMore]);

  const physicianOptions = useMemo(() => {
    const s = new Set<string>();
    patients.forEach((p) => {
      if (p.attendingPhysician) s.add(p.attendingPhysician);
    });
    return Array.from(s).sort();
  }, [patients]);

  const filtered = useMemo(() => {
    return patients.filter((p) => {
      if (search) {
        const term = search.trim().toLowerCase();
        const haystack = `${p.name ?? ''} ${p.bedNumber ?? ''} ${p.medicalRecordNumber ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (physician !== 'all' && p.attendingPhysician !== physician) return false;
      if (fromDate && p.dischargeDate && p.dischargeDate < fromDate) return false;
      if (toDate && p.dischargeDate && p.dischargeDate > toDate) return false;
      return true;
    });
  }, [patients, search, physician, fromDate, toDate]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleHardDelete = async (patient: Patient) => {
    const label = `${patient.bedNumber ?? ''} ${maskPatientName(patient.name)}`.trim();
    const typed = prompt(t('patients:discharged.hardDeletePrompt', { label, bedNumber: patient.bedNumber }));
    if (typed !== patient.bedNumber) {
      if (typed !== null) toast.error(t('patients:discharged.hardDeleteMismatch'));
      return;
    }
    setDeletingId(patient.id);
    try {
      await patientsApi.dischargePatient(patient.id);
      toast.success(t('patients:discharged.hardDeleteSuccess', { label }));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(patient.id);
        return next;
      });
      refetchFromStart();
    } catch (err: unknown) {
      console.error(`${t('patients:discharged.hardDeleteErrorLog')}:`, err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || t('patients:discharged.hardDeleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleChatSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error(t('patients:discharged.askAiNoneError'));
      return;
    }
    if (ids.length === 1) {
      navigate(`/ai-chat?patientId=${encodeURIComponent(ids[0])}`);
      return;
    }
    if (ids.length > 10) {
      toast.error(t('patients:discharged.askAiTooManyError'));
      return;
    }
    navigate(`/ai-chat?patientIds=${ids.map(encodeURIComponent).join(',')}`);
  };

  const canHardDelete = user?.role === 'admin';

  // Look up the localised label for a discharge type, with safe fallback.
  const dischargeTypeLabel = (type: DischargeType): string => {
    const map: Record<DischargeType, string> = {
      discharge: t('patients:dischargeType.discharge'),
      transfer: t('patients:dischargeType.transfer'),
      death: t('patients:dischargeType.death'),
      other: t('patients:dischargeType.other'),
    };
    return map[type];
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Archive className="h-6 w-6 text-brand" />
              {t('patients:discharged.title')}
            </h1>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <FlaskConical className="h-3.5 w-3.5" />
              {t('dashboard:header.demoDataBadge')}
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{t('patients:discharged.subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('patients:discharged.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">{t('patients:discharged.physicianLabel')}</Label>
              <Select value={physician} onValueChange={setPhysician}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('patients:discharged.physicianAll')}</SelectItem>
                  {physicianOptions.map((doc) => (
                    <SelectItem key={doc} value={doc}>{doc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">{t('patients:discharged.fromDateLabel')}</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">{t('patients:discharged.toDateLabel')}</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading && <TableSkeleton rows={6} columns={8} />}

          {error && !loading && (
            <ErrorDisplay
              type="server"
              title={t('patients:discharged.loadErrorTitle')}
              message={error}
              onRetry={refetchFromStart}
            />
          )}

          {!loading && !error && filtered.length === 0 && (
            <EmptyState
              icon={Archive}
              title={patients.length === 0 ? t('patients:discharged.emptyNone') : t('patients:discharged.emptyNoMatch')}
              description={patients.length === 0 ? t('patients:discharged.emptyHintNone') : t('patients:discharged.emptyHintFiltered')}
            />
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <Table className="compact-table" style={{ tableLayout: 'fixed', minWidth: '1100px' }}>
                <colgroup>
                  <col style={{ width: '40px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '70px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '160px' }} />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAll}
                        aria-label={t('patients:discharged.table.selectAll')}
                      />
                    </TableHead>
                    <TableHead>{t('patients:discharged.table.mrn')}</TableHead>
                    <TableHead>{t('patients:discharged.table.name')}</TableHead>
                    <TableHead>{t('patients:discharged.table.physician')}</TableHead>
                    <TableHead>{t('patients:discharged.table.diagnosis')}</TableHead>
                    <TableHead>{t('patients:discharged.table.icuAdmissionShort')}</TableHead>
                    <TableHead>{t('patients:discharged.table.dischargeDateShort')}</TableHead>
                    <TableHead>{t('patients:discharged.table.stayDaysShort')}</TableHead>
                    <TableHead>{t('patients:discharged.table.dischargeType')}</TableHead>
                    <TableHead className="text-center">{t('patients:discharged.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const stayDays = computeStayDays(p.icuAdmissionDate, p.dischargeDate);
                    const typeKey = (p.dischargeType as DischargeType) ?? 'other';
                    return (
                      <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                        <TableCell className="text-center">
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleOne(p.id)}
                            aria-label={t('patients:discharged.selectRowAria', { name: p.name })}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{p.medicalRecordNumber}</TableCell>
                        <TableCell className="font-medium">{maskPatientName(p.name)}</TableCell>
                        <TableCell>{p.attendingPhysician}</TableCell>
                        <TableCell className="whitespace-normal text-xs leading-snug">
                          {p.diagnosis?.split(/[;；]/).map((d, i) => {
                            const trimmed = d.trim();
                            return trimmed ? <div key={i}>{trimmed}</div> : null;
                          })}
                        </TableCell>
                        <TableCell className="text-xs">{p.icuAdmissionDate || '—'}</TableCell>
                        <TableCell className="text-xs">{p.dischargeDate || '—'}</TableCell>
                        <TableCell>
                          {stayDays !== null ? (
                            <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300">
                              {t('patients:discharged.stayDaysSuffix', { days: stayDays })}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={DISCHARGE_TYPE_BADGE[typeKey]}>
                            {dischargeTypeLabel(typeKey)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/patient/${p.id}`)}
                              title={t('patients:discharged.viewTooltip')}
                              className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/ai-chat?patientId=${encodeURIComponent(p.id)}`)}
                              title={t('patients:discharged.aiChatTooltip')}
                              className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                            {canHardDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleHardDelete(p)}
                                disabled={deletingId === p.id}
                                title={t('patients:discharged.hardDeleteTooltip')}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                              >
                                {deletingId === p.id ? <ButtonLoadingIndicator compact /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 分頁 / 滾動載入 */}
          {!loading && !error && patients.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <div>
                {t('patients:discharged.loadProgress', { loaded: patients.length, total })}
                {hasMore && (
                  <span className="ml-2">{t('patients:discharged.pageInfo', { page, total: totalPages })}</span>
                )}
              </div>
              {(search || physician !== 'all' || fromDate || toDate) && hasMore && (
                <div className="text-amber-700 dark:text-amber-300">
                  {t('patients:discharged.filterWarning')}
                </div>
              )}
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mt-1"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      {t('patients:discharged.loadingMore')}
                    </>
                  ) : (
                    <>{t('patients:discharged.loadMore', { remaining: total - patients.length })}</>
                  )}
                </Button>
              )}
              {!hasMore && patients.length > 0 && (
                <div className="text-muted-foreground">{t('patients:discharged.allLoaded')}</div>
              )}
              {/* Intersection sentinel — triggers auto-load when visible */}
              <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 底部選取操作列 */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur px-4 py-3 shadow-lg">
          <div className="text-sm">
            {t('patients:discharged.selectedCount', { count: selectedIds.size })}
            {selectedIds.size > 10 && (
              <span className="text-red-600 ml-2">{t('patients:discharged.aiChatLimitWarning')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
              {t('patients:discharged.clearSelection')}
            </Button>
            <Button
              size="sm"
              onClick={handleChatSelected}
              disabled={selectedIds.size === 0 || selectedIds.size > 10}
              className="bg-brand hover:bg-brand-hover"
            >
              <MessageSquare className="h-4 w-4 mr-1.5" />
              {t('patients:discharged.askAiAboutSelected')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
