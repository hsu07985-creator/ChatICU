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
import { getAuditLogs, AuditLog, AuditLogsResponse } from '../../lib/api/admin';
import { getApiErrorMessage } from '../../lib/api-client';

// 稽核紀錄頁面
export function AuditPage() {
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
      console.error('載入稽核紀錄失敗:', err);
      setError(getApiErrorMessage(err, '載入稽核紀錄失敗，請稍後重試'));
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
      return <Badge className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800">成功</Badge>;
    }
    return <Badge className="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800">失敗</Badge>;
  };

  const getRoleBadge = (role: string) => {
    const config: Record<string, { label: string; color: string; icon: typeof ShieldCheck }> = {
      '管理者': { label: '系統管理員', color: 'bg-brand text-white', icon: ShieldCheck },
      '醫師': { label: '醫師', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200', icon: Shield },
      '護理師': { label: '護理師', color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200', icon: Shield },
      '藥師': { label: '藥師', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200', icon: Shield },
    };

    const entry = config[role];
    if (entry) {
      const Icon = entry.icon;
      return (
        <Badge className={entry.color}>
          <Icon className="h-3.5 w-3.5 mr-1" />
          {entry.label}
        </Badge>
      );
    }
    return (
      <Badge className="bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-200">
        <Shield className="h-3.5 w-3.5 mr-1" />
        {role}
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">稽核紀錄</h1>
          <p className="text-muted-foreground text-sm mt-1">系統操作與存取記錄查詢</p>
        </div>
        <Button
          variant="outline"
          onClick={loadData}
          disabled={loading}
          className="border-brand text-brand hover:bg-brand hover:text-white"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          重新整理
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">今日總操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">成功操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.success}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">失敗操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">活躍用戶</CardTitle>
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
                稽核記錄列表
              </CardTitle>
              <CardDescription className="text-sm mt-2">
                所有系統操作與存取的詳細記錄
              </CardDescription>
            </div>
            <div className="w-[300px]">
              <Input
                placeholder="搜尋用戶、操作或目標..."
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
                    時間
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    用戶
                  </div>
                </TableHead>
                <TableHead>角色</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>目標</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>IP 位址</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-sm">{log.timestamp}</TableCell>
                  <TableCell className="font-medium">{log.user}</TableCell>
                  <TableCell>{getRoleBadge(log.role)}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.target}</TableCell>
                  <TableCell>{getStatusBadge(log.status)}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{log.ip}</TableCell>
                </TableRow>
              ))}
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
                上一頁
              </Button>
              <span className="text-sm text-muted-foreground">
                第 {page} / {totalPages} 頁
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一頁
              </Button>
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p>載入中...</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                重新載入
              </Button>
            </div>
          )}

          {!loading && !error && filteredLogs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p>沒有符合條件的稽核記錄</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 導出用於路由的頁面
export { AuditPage as default };
