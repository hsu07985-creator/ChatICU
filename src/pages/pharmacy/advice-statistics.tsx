import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { getAdviceRecords, type PharmacyAdviceRecord } from '../../lib/api/pharmacy';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Calendar, TrendingUp, FileText, Tag, User, Pill, Loader2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../../components/ui/state-display';

// 四大類別的顏色配置
const CATEGORY_COLORS: Record<string, string> = {
  '1. 建議處方': '#7f265b',
  '2. 主動建議': '#f59e0b',
  '3. 建議監測': '#1a1a1a',
  '4. 用藥適從性': '#3b82f6'
};

// 四大類別定義（UI 靜態配置）
const ADVICE_CATEGORIES = {
  prescription: {
    label: '1. 建議處方',
    codes: [
      { code: '1-1', label: '建議更適當用藥/配方組成' },
      { code: '1-2', label: '用藥途徑或劑型問題' },
      { code: '1-3', label: '用藥期間/數量問題（包含停藥）' },
      { code: '1-4', label: '用藥劑量/頻次問題' },
      { code: '1-5', label: '不符健保給付規定' },
      { code: '1-6', label: '其他' },
      { code: '1-7', label: '藥品相容性問題' },
      { code: '1-8', label: '疑似藥品不良反應' },
      { code: '1-9', label: '藥品交互作用' },
      { code: '1-10', label: '藥品併用問題' },
      { code: '1-11', label: '用藥替急問題（包括過敏史）' },
      { code: '1-12', label: '適應症問題' },
      { code: '1-13', label: '給藥問題（途徑、輸注方式、濃度或稀釋液）' }
    ]
  },
  proactive: {
    label: '2. 主動建議',
    codes: [
      { code: '2-1', label: '建議靜脈營養配方' },
      { code: '2-2', label: '建議藥物治療療程' },
      { code: '2-3', label: '建議用藥/建議增加用藥' },
      { code: '2-4', label: '藥品不良反應評估' }
    ]
  },
  monitoring: {
    label: '3. 建議監測',
    codes: [
      { code: '3-1', label: '建議藥品濃度監測' },
      { code: '3-2', label: '建議藥品不良反應監測' },
      { code: '3-3', label: '建議藥品療效監測' }
    ]
  },
  appropriateness: {
    label: '4. 用藥適從性',
    codes: [
      { code: '4-1', label: '病人用藥適從性問題' },
      { code: '4-2', label: '藥品辨識/自備藥辨識' },
      { code: '4-3', label: '藥歷查核與整合' }
    ]
  }
};

export function PharmacyAdviceStatisticsPage() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>(
    `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [records, setRecords] = useState<PharmacyAdviceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 生成月份選項（過去 12 個月）
  const generateMonthOptions = () => {
    const options = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
      options.push({ value, label });
    }
    return options;
  };

  const monthOptions = generateMonthOptions();

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: { month?: string; category?: string } = { month: selectedMonth };
      if (selectedCategory !== 'all') {
        params.category = selectedCategory;
      }
      const response = await getAdviceRecords(params);
      setRecords(response.records);
    } catch (err) {
      console.error('載入用藥建議記錄失敗:', err);
      setError('無法載入用藥建議記錄，請稍後再試');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedCategory]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 根據選擇的類別篩選（API 已篩月份，前端再篩類別作為備援）
  const filteredRecords = selectedCategory === 'all'
    ? records
    : records.filter(r => r.category === selectedCategory);

  // 統計各分類數量
  const getCategoryStats = () => {
    const stats: Record<string, number> = {
      '1. 建議處方': 0,
      '2. 主動建議': 0,
      '3. 建議監測': 0,
      '4. 用藥適從性': 0
    };

    records.forEach(record => {
      if (stats[record.category] !== undefined) {
        stats[record.category]++;
      }
    });

    return stats;
  };

  const categoryStats = getCategoryStats();
  const totalAdvices = Object.values(categoryStats).reduce((sum, val) => sum + val, 0);

  // 統計各細項代碼數量
  const getCodeStats = () => {
    const stats: Record<string, number> = {};

    filteredRecords.forEach(record => {
      stats[record.adviceCode] = (stats[record.adviceCode] || 0) + 1;
    });

    return Object.entries(stats).map(([code, count]) => ({
      code,
      label: filteredRecords.find(r => r.adviceCode === code)?.adviceLabel || code,
      category: filteredRecords.find(r => r.adviceCode === code)?.category || '',
      count
    })).sort((a, b) => a.code.localeCompare(b.code));
  };

  const codeStats = getCodeStats();

  // 圓餅圖資料
  const pieData = Object.entries(categoryStats).map(([category, count]) => ({
    name: category,
    value: count,
    color: CATEGORY_COLORS[category] || '#999'
  }));

  // Loading state
  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold text-[#7f265b] mb-6">用藥建議與統計</h1>
        <LoadingSpinner message="載入用藥建議記錄中..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold text-[#7f265b] mb-6">用藥建議與統計</h1>
        <ErrorDisplay
          type="server"
          title="載入失敗"
          message={error}
          onRetry={fetchRecords}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 標題 */}
      <div>
        <h1 className="text-3xl font-bold text-[#7f265b]">用藥建議與統計</h1>
        <p className="text-muted-foreground mt-1">藥師照護介入紀錄與分類統計（四大類 23 細項）</p>
      </div>

      {/* 篩選控制 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <label className="text-sm font-medium mb-2 block">選擇月份</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue placeholder="選擇月份" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <label className="text-sm font-medium mb-2 block">建議類別</label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="選擇類別" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類別</SelectItem>
                <SelectItem value="1. 建議處方">1. 建議處方</SelectItem>
                <SelectItem value="2. 主動建議">2. 主動建議</SelectItem>
                <SelectItem value="3. 建議監測">3. 建議監測</SelectItem>
                <SelectItem value="4. 用藥適從性">4. 用藥適從性</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* 統計摘要卡片 */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-2 border-[#7f265b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總計</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#7f265b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">{totalAdvices}</div>
            <p className="text-xs text-muted-foreground mt-1">本月建議總數</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#7f265b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">1. 建議處方</CardTitle>
            <FileText className="h-5 w-5 text-[#7f265b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">
              {categoryStats['1. 建議處方']}
            </div>
            <p className="text-xs text-muted-foreground mt-1">13 細項</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#f59e0b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">2. 主動建議</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#f59e0b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#f59e0b]">
              {categoryStats['2. 主動建議']}
            </div>
            <p className="text-xs text-muted-foreground mt-1">4 細項</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#1a1a1a]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">3. 建議監測</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#1a1a1a]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#1a1a1a]">
              {categoryStats['3. 建議監測']}
            </div>
            <p className="text-xs text-muted-foreground mt-1">3 細項</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-[#3b82f6]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">4. 用藥適從性</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#3b82f6]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#3b82f6]">
              {categoryStats['4. 用藥適從性']}
            </div>
            <p className="text-xs text-muted-foreground mt-1">3 細項</p>
          </CardContent>
        </Card>
      </div>

      {/* 圖表區域 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 圓餅圖 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#7f265b]" />
              類別分佈
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalAdvices > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>本月尚無建議記錄</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 長條圖：細項統計 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#7f265b]" />
              細項分析 ({codeStats.length} 項)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {codeStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={codeStats} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" stroke="#6b7280" />
                  <YAxis
                    dataKey="code"
                    type="category"
                    width={60}
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill="#7f265b"
                    radius={[0, 4, 4, 0]}
                    label={{ position: 'right', fontSize: 11 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>本月尚無建議記錄</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 建議明細清單 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#7f265b]" />
            建議明細清單
            <Badge variant="secondary" className="ml-2">{filteredRecords.length} 筆</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRecords.length > 0 ? (
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {filteredRecords.map(record => (
                  <div key={record.id} className="border-l-4 rounded-lg p-4 bg-white hover:shadow-md transition-shadow"
                    style={{ borderLeftColor: CATEGORY_COLORS[record.category] || '#999' }}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          className="text-white"
                          style={{ backgroundColor: CATEGORY_COLORS[record.category] || '#999' }}
                        >
                          {record.adviceCode}
                        </Badge>
                        <span className="font-medium text-sm">{record.adviceLabel}</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">{record.timestamp}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">病患：</span>
                        <span className="font-medium">{record.bedNumber} {record.patientName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">藥師：</span>
                        <span className="font-medium">{record.pharmacistName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs">
                          {record.category}
                        </Badge>
                      </div>
                    </div>

                    <p className="text-sm text-[#1a1a1a] leading-relaxed mb-2 whitespace-pre-line">{record.content}</p>

                    {record.linkedMedications && record.linkedMedications.length > 0 && (
                      <div className="pt-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                        <Pill className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">關聯藥品：</span>
                        {record.linkedMedications.map((med, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {med}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState
              icon={FileText}
              title="無符合條件的建議資料"
              description="本月尚無藥師照護介入紀錄"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
