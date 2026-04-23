import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  ArrowUpCircle,
  ClipboardCheck,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { EmptyState, ErrorDisplay } from '../components/ui/state-display';
import { TableSkeleton } from '../components/ui/skeletons';
import { DischargeCheckPanel } from '../components/patient/discharge-check-panel';

type DischargeType = 'discharge' | 'transfer' | 'death' | 'other';

const DISCHARGE_TYPE_LABEL: Record<DischargeType, string> = {
  discharge: '一般出院',
  transfer: '轉院/轉出',
  death: '死亡',
  other: '其他',
};

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
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dischargeCheckPatient, setDischargeCheckPatient] = useState<Patient | null>(null);

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
      console.error('載入已出院病人失敗:', err);
      setError('無法載入已出院病人，請稍後再試');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

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

  const handleRestore = async (patient: Patient) => {
    const label = `${patient.bedNumber ?? ''} ${maskPatientName(patient.name)}`.trim();
    if (!confirm(`確定要將病患「${label}」復住院？\n\n此操作會將病人重新加入住院中清單。`)) return;
    setRestoringId(patient.id);
    try {
      await patientsApi.archivePatient(patient.id, { archived: false });
      toast.success(`已復住院：${label}`);
      refetchFromStart();
    } catch (err: unknown) {
      console.error('復住院失敗:', err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || '復住院失敗，請稍後再試');
    } finally {
      setRestoringId(null);
    }
  };

  const handleHardDelete = async (patient: Patient) => {
    const label = `${patient.bedNumber ?? ''} ${maskPatientName(patient.name)}`.trim();
    const typed = prompt(`⚠️ 永久刪除病患「${label}」\n\n此操作無法復原，將永久刪除病人所有歷史資料（用藥/檢驗/培養/報告/對話）。\n\n請輸入病人床號「${patient.bedNumber}」以確認：`);
    if (typed !== patient.bedNumber) {
      if (typed !== null) toast.error('床號不符，已取消刪除');
      return;
    }
    setDeletingId(patient.id);
    try {
      await patientsApi.dischargePatient(patient.id);
      toast.success(`已永久刪除：${label}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(patient.id);
        return next;
      });
      refetchFromStart();
    } catch (err: unknown) {
      console.error('永久刪除失敗:', err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || '永久刪除失敗，請稍後再試');
    } finally {
      setDeletingId(null);
    }
  };

  const handleChatSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error('請先勾選至少一位病患');
      return;
    }
    if (ids.length === 1) {
      navigate(`/ai-chat?patientId=${encodeURIComponent(ids[0])}`);
      return;
    }
    if (ids.length > 10) {
      toast.error('一次最多可選 10 位病患進行 AI 問答');
      return;
    }
    navigate(`/ai-chat?patientIds=${ids.map(encodeURIComponent).join(',')}`);
  };

  const canHardDelete = user?.role === 'admin';

  return (
    <div className="p-6 space-y-6">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
        <FlaskConical className="h-3.5 w-3.5" />
        模擬資料
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Archive className="h-6 w-6 text-brand" />
            已出院病人
          </h1>
          <p className="text-muted-foreground text-sm mt-1">回顧歷史出院病人資料，可篩選並對選取病人發起 AI 問答</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋姓名 / 床號 / 病例號..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">主治醫師</Label>
              <Select value={physician} onValueChange={setPhysician}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  {physicianOptions.map((doc) => (
                    <SelectItem key={doc} value={doc}>{doc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">出院日期（起）</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">出院日期（迄）</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading && <TableSkeleton rows={6} columns={8} />}

          {error && !loading && (
            <ErrorDisplay type="server" title="載入失敗" message={error} onRetry={refetchFromStart} />
          )}

          {!loading && !error && filtered.length === 0 && (
            <EmptyState
              icon={Archive}
              title={patients.length === 0 ? '目前沒有已出院病人' : '找不到符合條件的病人'}
              description={patients.length === 0 ? '當病人被辦理出院後，將會出現在此' : '請嘗試調整篩選條件'}
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
                        aria-label="全選"
                      />
                    </TableHead>
                    <TableHead>病例號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>主治醫師</TableHead>
                    <TableHead>入院診斷</TableHead>
                    <TableHead>入ICU日</TableHead>
                    <TableHead>出院日</TableHead>
                    <TableHead>住院天</TableHead>
                    <TableHead>出院類別</TableHead>
                    <TableHead className="text-center">操作</TableHead>
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
                            aria-label={`選擇 ${p.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{p.medicalRecordNumber}</TableCell>
                        <TableCell className="font-medium">{maskPatientName(p.name)}</TableCell>
                        <TableCell>{p.attendingPhysician}</TableCell>
                        <TableCell className="whitespace-normal text-xs leading-snug">
                          {p.diagnosis?.split(/[;；]/).map((d, i) => {
                            const t = d.trim();
                            return t ? <div key={i}>{t}</div> : null;
                          })}
                        </TableCell>
                        <TableCell className="text-xs">{p.icuAdmissionDate || '—'}</TableCell>
                        <TableCell className="text-xs">{p.dischargeDate || '—'}</TableCell>
                        <TableCell>
                          {stayDays !== null ? (
                            <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300">
                              {stayDays} 天
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={DISCHARGE_TYPE_BADGE[typeKey]}>
                            {DISCHARGE_TYPE_LABEL[typeKey]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/patient/${p.id}`)}
                              title="檢視病歷"
                              className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/ai-chat?patientId=${encodeURIComponent(p.id)}`)}
                              title="AI 問答"
                              className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDischargeCheckPatient(p)}
                              title="出院用藥檢查"
                              className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <ClipboardCheck className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleRestore(p)}
                              disabled={restoringId === p.id}
                              title="復住院"
                              className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                            >
                              {restoringId === p.id ? <ButtonLoadingIndicator compact /> : <ArrowUpCircle className="h-4 w-4" />}
                            </Button>
                            {canHardDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleHardDelete(p)}
                                disabled={deletingId === p.id}
                                title="永久刪除（admin）"
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
                已載入 <span className="font-semibold text-foreground">{patients.length}</span> / 共 {total} 位
                {hasMore && (
                  <span className="ml-2">（第 {page} / {totalPages} 頁）</span>
                )}
              </div>
              {(search || physician !== 'all' || fromDate || toDate) && hasMore && (
                <div className="text-amber-700 dark:text-amber-300">
                  篩選條件僅套用於已載入的資料，若找不到病人請往下捲動或點「載入更多」載入全部
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
                      載入中...
                    </>
                  ) : (
                    <>載入更多（還有 {total - patients.length} 位）</>
                  )}
                </Button>
              )}
              {!hasMore && patients.length > 0 && (
                <div className="text-muted-foreground">已載入全部</div>
              )}
              {/* Intersection sentinel — triggers auto-load when visible */}
              <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 出院用藥檢查 Dialog */}
      <Dialog
        open={dischargeCheckPatient !== null}
        onOpenChange={(open) => {
          if (!open) setDischargeCheckPatient(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-brand" />
              出院用藥檢查
            </DialogTitle>
            <DialogDescription>
              {dischargeCheckPatient && (
                <>
                  {dischargeCheckPatient.bedNumber ? `${dischargeCheckPatient.bedNumber} · ` : ''}
                  {maskPatientName(dischargeCheckPatient.name)}
                  {dischargeCheckPatient.dischargeDate
                    ? ` · 出院日 ${dischargeCheckPatient.dischargeDate}`
                    : ''}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {dischargeCheckPatient && (
            <DischargeCheckPanel patientId={dischargeCheckPatient.id} />
          )}
        </DialogContent>
      </Dialog>

      {/* 底部選取操作列 */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur px-4 py-3 shadow-lg">
          <div className="text-sm">
            已選擇 <span className="font-semibold">{selectedIds.size}</span> 位病患
            {selectedIds.size > 10 && (
              <span className="text-red-600 ml-2">（AI 問答最多 10 位）</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
              清除選取
            </Button>
            <Button
              size="sm"
              onClick={handleChatSelected}
              disabled={selectedIds.size === 0 || selectedIds.size > 10}
              className="bg-brand hover:bg-brand-hover"
            >
              <MessageSquare className="h-4 w-4 mr-1.5" />
              對選取病人 AI 問答
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
