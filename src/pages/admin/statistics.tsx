import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { toast } from 'sonner';
import apiClient from '../../lib/api-client';

type MedicationAdviceCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W';

const ADVICE_TYPE_MAP: Record<MedicationAdviceCode, { name: string; category: string; code: string }> = {
  A: { name: 'A.建議新增藥品', category: '1.建議處方', code: 'A' },
  B: { name: 'B.建議停用藥品', category: '1.建議處方', code: 'B' },
  C: { name: 'C.建議修改劑量', category: '1.建議處方', code: 'C' },
  D: { name: 'D.建議修改途徑', category: '1.建議處方', code: 'D' },
  E: { name: 'E.建議修改頻率', category: '1.建議處方', code: 'E' },
  F: { name: 'F.建議修改劑型', category: '1.建議處方', code: 'F' },
  G: { name: 'G.建議藥品替換', category: '1.建議處方', code: 'G' },
  H: { name: 'H.藥品交互作用處理', category: '1.建議處方', code: 'H' },
  I: { name: 'I.重複用藥處理', category: '1.建議處方', code: 'I' },
  J: { name: 'J.禁忌症用藥處理', category: '1.建議處方', code: 'J' },
  K: { name: 'K.過敏史用藥處理', category: '1.建議處方', code: 'K' },
  L: { name: 'L.特殊族群用藥調整', category: '1.建議處方', code: 'L' },
  M: { name: 'M.其他處方建議', category: '1.建議處方', code: 'M' },
  N: { name: 'N.營養支持建議', category: '2.主動建議', code: 'N' },
  O: { name: 'O.感染管理建議', category: '2.主動建議', code: 'O' },
  P: { name: 'P.疼痛管理建議', category: '2.主動建議', code: 'P' },
  Q: { name: 'Q.其他主動建議', category: '2.主動建議', code: 'Q' },
  R: { name: 'R.藥物血中濃度監測', category: '3.建議監測', code: 'R' },
  S: { name: 'S.肝腎功能監測', category: '3.建議監測', code: 'S' },
  T: { name: 'T.其他監測建議', category: '3.建議監測', code: 'T' },
  U: { name: 'U.入院用藥整合', category: '4.用藥連貫性', code: 'U' },
  V: { name: 'V.轉科用藥銜接', category: '4.用藥連貫性', code: 'V' },
  W: { name: 'W.出院用藥衛教', category: '4.用藥連貫性', code: 'W' },
};

// 四大類別的顏色配置
const CATEGORY_COLORS: Record<string, string> = {
  '1.建議處方': '#7f265b',
  '2.主動建議': '#f59e0b',
  '3.建議監測': '#1a1a1a',
  '4.用藥連貫性': '#3b82f6'
};

interface AdviceStatisticsData {
  totalReports: number;
  resolvedRate: number;
  severityCounts: {
    low: number;
    moderate: number;
    high: number;
  };
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export function StatisticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdviceStatisticsData | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<ApiResponse<AdviceStatisticsData>>('/pharmacy/advice-statistics');
      setStats(response.data.data || null);
    } catch (err) {
      console.error('載入統計資料失敗:', err);
      setError('無法連線至伺服器，請確認後端服務是否正常運行');
      toast.error('載入統計資料失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 嚴重程度分佈圖表資料
  const severityChartData = stats ? [
    { name: '輕微 (Low)', count: stats.severityCounts.low, color: '#22c55e' },
    { name: '中度 (Moderate)', count: stats.severityCounts.moderate, color: '#f59e0b' },
    { name: '嚴重 (High)', count: stats.severityCounts.high, color: '#ef4444' },
  ] : [];

  // A-W 分類代碼參考資料（目前 API 未提供每個代碼的統計，顯示為 0）
  const getCategoryCodeData = (category: string, codes: string[]) => {
    return codes.map(code => {
      const info = ADVICE_TYPE_MAP[code as MedicationAdviceCode];
      return {
        code,
        name: info.name,
        category: info.category,
        count: 0,
        color: CATEGORY_COLORS[category]
      };
    });
  };

  // 自訂 Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-[#e5e7eb]">
          <p className="text-sm font-bold text-[#1a1a1a] mb-1">{data.name}</p>
          {data.category && <p className="text-xs text-muted-foreground mb-1">{data.category}</p>}
          <p className="text-sm font-bold" style={{ color: data.color }}>{data.count} 筆</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[#7f265b]" />
          <p className="text-muted-foreground">載入統計資料中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <p className="text-red-600 font-medium">{error}</p>
          <button onClick={loadData} className="mt-4 text-sm text-[#7f265b] hover:underline">
            重新載入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#7f265b]">用藥建議統計分析</h1>
        <p className="text-muted-foreground mt-1">臨床藥事照護介入分類統計（A-W 共 23 項）</p>
      </div>

      {/* 統計摘要卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-[#7f265b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總回報數</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#7f265b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">
              {stats?.totalReports ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">累計回報</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#22c55e]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">解決率</CardTitle>
            <CheckCircle2 className="h-5 w-5 text-[#22c55e]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#22c55e]">
              {stats?.resolvedRate !== undefined ? `${(stats.resolvedRate * 100).toFixed(1)}%` : '-'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">已解決比例</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#f59e0b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">中度事件</CardTitle>
            <AlertCircle className="h-5 w-5 text-[#f59e0b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#f59e0b]">
              {stats?.severityCounts?.moderate ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">中度嚴重程度</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#ef4444]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">嚴重事件</CardTitle>
            <AlertCircle className="h-5 w-5 text-[#ef4444]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#ef4444]">
              {stats?.severityCounts?.high ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">高嚴重程度</p>
          </CardContent>
        </Card>
      </div>

      {/* 嚴重程度分佈圖表 */}
      <Card>
        <CardHeader>
          <CardTitle>嚴重程度分佈</CardTitle>
          <CardDescription>各嚴重程度回報數量</CardDescription>
        </CardHeader>
        <CardContent>
          {severityChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={severityChartData} margin={{ top: 5, right: 50, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 12 }} />
                <YAxis stroke="#6b7280" />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="count"
                  radius={[4, 4, 0, 0]}
                  name="回報數量"
                  label={{ position: 'top', fontSize: 12 }}
                  fill="#7f265b"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>尚無統計資料</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 圖表區域 - 分類別顯示（代碼參考） */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. 建議處方 (A-M) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-3 w-3 rounded" style={{ backgroundColor: CATEGORY_COLORS['1.建議處方'] }}></div>
              1. 建議處方
            </CardTitle>
            <CardDescription>A-M 項目（待後端提供詳細分類統計）</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const completeData = getCategoryCodeData('1.建議處方', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
              return (
                <ResponsiveContainer width="100%" height={Math.max(500, completeData.length * 35)}>
                  <BarChart
                    data={completeData}
                    layout="horizontal"
                    margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={280}
                      stroke="#6b7280"
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      fill={CATEGORY_COLORS['1.建議處方']}
                      radius={[0, 4, 4, 0]}
                      name="建議數量"
                      label={{ position: 'right', fontSize: 11 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>

        {/* 2. 主動建議 (N-Q) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-3 w-3 rounded" style={{ backgroundColor: CATEGORY_COLORS['2.主動建議'] }}></div>
              2. 主動建議
            </CardTitle>
            <CardDescription>N-Q 項目（待後端提供詳細分類統計）</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const completeData = getCategoryCodeData('2.主動建議', ['N', 'O', 'P', 'Q']);
              return (
                <ResponsiveContainer width="100%" height={Math.max(220, completeData.length * 45)}>
                  <BarChart
                    data={completeData}
                    layout="horizontal"
                    margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={180}
                      stroke="#6b7280"
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      fill={CATEGORY_COLORS['2.主動建議']}
                      radius={[0, 4, 4, 0]}
                      name="建議數量"
                      label={{ position: 'right', fontSize: 11 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>

        {/* 3. 建議監測 (R-T) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-3 w-3 rounded" style={{ backgroundColor: CATEGORY_COLORS['3.建議監測'] }}></div>
              3. 建議監測
            </CardTitle>
            <CardDescription>R-T 項目（待後端提供詳細分類統計）</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const completeData = getCategoryCodeData('3.建議監測', ['R', 'S', 'T']);
              return (
                <ResponsiveContainer width="100%" height={Math.max(200, completeData.length * 55)}>
                  <BarChart
                    data={completeData}
                    layout="horizontal"
                    margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={180}
                      stroke="#6b7280"
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      fill={CATEGORY_COLORS['3.建議監測']}
                      radius={[0, 4, 4, 0]}
                      name="建議數量"
                      label={{ position: 'right', fontSize: 11 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>

        {/* 4. 用藥連貫性 (U-W) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-3 w-3 rounded" style={{ backgroundColor: CATEGORY_COLORS['4.用藥連貫性'] }}></div>
              4. 用藥連貫性
            </CardTitle>
            <CardDescription>U-W 項目（待後端提供詳細分類統計）</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const completeData = getCategoryCodeData('4.用藥連貫性', ['U', 'V', 'W']);
              return (
                <ResponsiveContainer width="100%" height={Math.max(200, completeData.length * 55)}>
                  <BarChart
                    data={completeData}
                    layout="horizontal"
                    margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={180}
                      stroke="#6b7280"
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      fill={CATEGORY_COLORS['4.用藥連貫性']}
                      radius={[0, 4, 4, 0]}
                      name="建議數量"
                      label={{ position: 'right', fontSize: 11 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* 建議代碼參考 */}
      <Card>
        <CardHeader>
          <CardTitle>建議代碼參考</CardTitle>
          <CardDescription>臨床藥事照護介入分類（A-W 共 23 項）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(Object.entries(ADVICE_TYPE_MAP) as [MedicationAdviceCode, { name: string; category: string; code: string }][]).map(([code, info]) => (
              <div key={code} className="flex items-center gap-2 p-2 border rounded-lg">
                <Badge
                  className="text-white text-xs"
                  style={{ backgroundColor: CATEGORY_COLORS[info.category] }}
                >
                  {code}
                </Badge>
                <span className="text-sm">{info.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
