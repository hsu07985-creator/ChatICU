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
import { FileText, User, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { useState, useEffect } from 'react';
import { getAuditLogs, AuditLog, AuditLogsResponse } from '../../lib/api/admin';
import { getApiErrorMessage } from '../../lib/api-client';

// 稽核紀錄頁面
export function AuditPage() {
  const [searchTerm, setSearchTerm] = useState('');
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

  const getStatusBadge = (status: 'success' | 'failed') => {
    if (status === 'success') {
      return <Badge className="bg-green-100 text-green-800 border-green-200">成功</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800 border-red-200">失敗</Badge>;
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      '管理者': 'bg-[#7f265b] text-white',
      '醫師': 'bg-blue-100 text-blue-800',
      '護理師': 'bg-green-100 text-green-800',
      '藥師': 'bg-purple-100 text-purple-800'
    };

    return (
      <Badge className={colors[role] || 'bg-gray-100 text-gray-800'}>
        {role}
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6 pl-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#3c7acb]">稽核紀錄</h1>
          <p className="text-muted-foreground mt-1">系統操作與存取記錄查詢</p>
        </div>
        <Button
          variant="outline"
          onClick={loadData}
          disabled={loading}
          className="border-[#7f265b] text-[#7f265b] hover:bg-[#7f265b] hover:text-white"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          重新整理
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">今日總操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">成功操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.success}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">失敗操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">活躍用戶</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {new Set(auditLogs.map(log => log.user)).size}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 稽核記錄列表 */}
      <Card className="border-2">
        <CardHeader className="bg-[#f8f9fa] border-b-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-6 w-6 text-[#7f265b]" />
                稽核記錄列表
              </CardTitle>
              <CardDescription className="text-[15px] mt-2">
                所有系統操作與存取的詳細記錄
              </CardDescription>
            </div>
            <div className="w-[300px]">
              <Input
                placeholder="搜尋用戶、操作或目標..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border-2"
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
              {filteredLogs.map((log) => (
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
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
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
