import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Plus, TrendingUp, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import {
  getErrorReports,
  createErrorReport,
  ErrorReport,
  ErrorReportsResponse
} from '../../lib/api/pharmacy';

export function ErrorReportPage() {
  const [showForm, setShowForm] = useState(false);
  const [errorType, setErrorType] = useState('');
  const [drugName, setDrugName] = useState('');
  const [description, setDescription] = useState('');
  const [patientId, setPatientId] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [severity, setSeverity] = useState('moderate');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiData, setApiData] = useState<ErrorReportsResponse | null>(null);

  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getErrorReports({ limit: 50 });
      setApiData(data);
    } catch (err) {
      console.error('載入錯誤回報列表失敗:', err);
      setError('無法連線至伺服器，請確認後端服務是否正常運行');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const reports = apiData?.reports || [];
  const stats = apiData?.stats || {
    total: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
    byType: {},
    bySeverity: {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!errorType || !drugName || !description) {
      toast.error('請填寫所有必填欄位');
      return;
    }

    setSubmitting(true);
    try {
      await createErrorReport({
        errorType,
        medicationName: drugName,
        description,
        patientId: patientId || undefined,
        actionTaken: actionTaken || undefined,
        severity,
      });

      toast.success('用藥錯誤回報已送出，感謝您的回報');
      setShowForm(false);
      // 重置表單
      setErrorType('');
      setDrugName('');
      setDescription('');
      setPatientId('');
      setActionTaken('');
      setSeverity('moderate');
      // 重新載入資料
      await loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '送出回報失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'resolved') {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          已處理
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
        <Clock className="h-3 w-3 mr-1" />
        處理中
      </Badge>
    );
  };

  const errorTypeCount = reports.reduce((acc, report) => {
    acc[report.errorType] = (acc[report.errorType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>用藥錯誤回報</h1>
          <p className="text-muted-foreground mt-1">回報與追蹤用藥錯誤事件</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" />
          新增回報
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總回報數</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">本月累計</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">處理中</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stats.pending}
            </div>
            <p className="text-xs text-muted-foreground mt-1">待處理事件</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">已處理</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats.resolved}
            </div>
            <p className="text-xs text-muted-foreground mt-1">本月完成</p>
          </CardContent>
        </Card>
      </div>

      {/* 新增回報表單 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>新增用藥錯誤回報</CardTitle>
            <CardDescription>請詳細填寫錯誤資訊，有助於後續分析與改善</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">錯誤類型 *</label>
                  <Select value={errorType} onValueChange={setErrorType} required>
                    <SelectTrigger>
                      <SelectValue placeholder="選擇錯誤類型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="開立錯誤">開立錯誤</SelectItem>
                      <SelectItem value="劑量錯誤">劑量錯誤</SelectItem>
                      <SelectItem value="重複給藥">重複給藥</SelectItem>
                      <SelectItem value="路徑錯誤">路徑錯誤</SelectItem>
                      <SelectItem value="頻次錯誤">頻次錯誤</SelectItem>
                      <SelectItem value="藥品辨識錯誤">藥品辨識錯誤</SelectItem>
                      <SelectItem value="其他">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">涉及藥品 *</label>
                  <Input
                    placeholder="例：Morphine"
                    value={drugName}
                    onChange={(e) => setDrugName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">錯誤描述 *</label>
                <Textarea
                  placeholder="請詳細描述錯誤情況、發生原因與影響..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[100px]"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">後續處理</label>
                <Textarea
                  placeholder="說明已採取的處理措施..."
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">病歷號（可選）</label>
                  <Input
                    placeholder="若涉及特定病患可填寫"
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">嚴重程度</label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">輕微 - 未到達病患</SelectItem>
                      <SelectItem value="moderate">中度 - 無明顯傷害</SelectItem>
                      <SelectItem value="high">嚴重 - 可能造成傷害</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  用藥錯誤回報系統旨在改善用藥安全，非懲罰性機制。您的回報將協助我們找出系統性問題並進行改善。
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      送出中...
                    </>
                  ) : '送出回報'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={submitting}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 錯誤類型統計 */}
      <Card>
        <CardHeader>
          <CardTitle>錯誤類型分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-4">
            {Object.entries(errorTypeCount).map(([type, count]) => (
              <div key={type} className="p-3 border rounded-lg">
                <div className="text-sm text-muted-foreground">{type}</div>
                <div className="text-2xl font-bold mt-1">{count}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 回報記錄列表 */}
      <Card>
        <CardHeader>
          <CardTitle>回報記錄</CardTitle>
          <CardDescription>歷史用藥錯誤回報</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p>載入中...</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>錯誤類型</TableHead>
                  <TableHead>藥品</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead>嚴重程度</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>{report.timestamp}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{report.errorType}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{report.medicationName}</TableCell>
                    <TableCell className="max-w-xs truncate">{report.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{report.severity}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(report.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && !error && reports.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>尚無回報記錄</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
