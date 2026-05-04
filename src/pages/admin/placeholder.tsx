import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { FileText, User, Clock, AlertCircle, RefreshCw, ShieldCheck, Shield } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import { getAuditLogs, AuditLog, AuditLogsResponse } from '../../lib/api/admin';
import { getApiErrorMessage } from '../../lib/api-client';

// ── helpers ───────────────────────────────────────────────────────────
// DB 存 UTC，顯示一律台北時間 (UTC+8)
function formatTaipei(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: iso, time: '' };
  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat(i18n.language, {
    timeZone: 'Asia/Taipei',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return {
    date: dateFmt.format(d).replace(/\//g, '-'),
    time: timeFmt.format(d),
  };
}

// 後端回傳的 role 是英文 key；中文 key 對應到對應英文 key 後再走 t() 查表
const LEGACY_ROLE_KEY: Record<string, string> = {
  管理者: 'admin',
  醫師: 'doctor',
  護理師: 'nurse',
  藥師: 'pharmacist',
};
const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-brand text-white',
  doctor: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200',
  nurse: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
  np: 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200',
  pharmacist: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200',
  管理者: 'bg-brand text-white',
  醫師: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200',
  護理師: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
  藥師: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200',
};

// 系統類 target 顯示 dash 比較好掃；ID 類 (pat_/med_/pmsg_) 用 mono
function isIdLike(target: string): boolean {
  return /^(pat|med|pmsg|usr|sess|pi|ord)_/.test(target);
}

// 稽核紀錄頁面
export function AuditPage() {
  const { t } = useTranslation('admin');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [apiData, setApiData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // 從 API 載入數據
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditLogs({ limit: 50 });
      setApiData(data);
    } catch (err: unknown) {
      console.error('audit load failed:', err);
      setError(getApiErrorMessage(err, t('audit.list.loadFail')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 使用 API 數據
  const auditLogs = apiData?.logs || [];
  const stats = apiData?.stats || {
    total: auditLogs.length,
    success: auditLogs.filter(log => log.status === 'success').length,
    failed: auditLogs.filter(log => log.status === 'failed').length,
  };

  const filteredLogs = auditLogs.filter(log =>
    log.user.includes(searchTerm) ||
    log.action.includes(searchTerm) ||
    log.target.includes(searchTerm)
  );

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginatedLogs = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getStatusBadge = (status: 'success' | 'failed') => {
    if (status === 'success') {
      return <Badge className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800">{t('audit.status.success')}</Badge>;
    }
    return <Badge className="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800">{t('audit.status.failed')}</Badge>;
  };

  const getRoleBadge = (role: string) => {
    const normalized = LEGACY_ROLE_KEY[role] ?? role;
    const label = t(`audit.roleLabel.${normalized}`, { defaultValue: role });
    const color = ROLE_COLOR[role] ?? ROLE_COLOR[normalized] ?? 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-200';
    const Icon = normalized === 'admin' ? ShieldCheck : Shield;
    return (
      <Badge className={color}>
        <Icon className="h-3.5 w-3.5 mr-1" />
        {label}
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('audit.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('audit.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          onClick={loadData}
          disabled={loading}
          className="border-brand text-brand hover:bg-brand hover:text-white"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('audit.refresh')}
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('audit.stats.todayTotal')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('audit.stats.successful')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.success}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('audit.stats.failed')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('audit.stats.activeUsers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {new Set(auditLogs.map(log => log.user)).size}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 稽核記錄列表 */}
      <Card>
        <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-6 w-6 text-brand" />
                {t('audit.list.title')}
              </CardTitle>
              <CardDescription className="text-sm mt-2">
                {t('audit.list.description')}
              </CardDescription>
            </div>
            <div className="w-[300px]">
              <Input
                placeholder={t('audit.list.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="border"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {t('audit.list.colTime')}
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {t('audit.list.colUser')}
                  </div>
                </TableHead>
                <TableHead>{t('audit.list.colRole')}</TableHead>
                <TableHead>{t('audit.list.colAction')}</TableHead>
                <TableHead>{t('audit.list.colTarget')}</TableHead>
                <TableHead>{t('audit.list.colStatus')}</TableHead>
                <TableHead>{t('audit.list.colIp')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedLogs.map((log) => {
                const ts = formatTaipei(log.timestamp);
                const isSystemTarget = !log.target || log.target === '系統' || log.target === 'system';
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap font-mono text-sm leading-tight">
                      <div>{ts.date}</div>
                      <div className="text-muted-foreground">{ts.time}</div>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{log.user}</TableCell>
                    <TableCell className="whitespace-nowrap">{getRoleBadge(log.role)}</TableCell>
                    <TableCell className="whitespace-nowrap">{log.action}</TableCell>
                    <TableCell className={`text-sm ${isSystemTarget ? 'text-muted-foreground/50' : isIdLike(log.target) ? 'font-mono text-muted-foreground' : 'text-muted-foreground'}`}>
                      {isSystemTarget ? '—' : log.target}
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground whitespace-nowrap">{log.ip}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {!loading && !error && filteredLogs.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                {t('audit.list.prevPage')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('audit.list.pageOf', { page, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {t('audit.list.nextPage')}
              </Button>
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p>{t('audit.list.loading')}</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                {t('audit.list.reload')}
              </Button>
            </div>
          )}

          {!loading && !error && filteredLogs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p>{t('audit.list.empty')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 導出用於路由的頁面
export { AuditPage as default };
