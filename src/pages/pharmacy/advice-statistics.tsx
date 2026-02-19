import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { getAdviceRecords, type PharmacyAdviceRecord } from '../../lib/api/pharmacy';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Calendar, TrendingUp, FileText, Tag, User, Pill, Loader2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../../components/ui/state-display';
import { PHARMACY_ADVICE_CATEGORIES, PHARMACY_ADVICE_CATEGORY_COLORS } from '../../lib/pharmacy-master-data';

// 四大類別定義（固定 master data，集中管理）
const ADVICE_CATEGORIES = PHARMACY_ADVICE_CATEGORIES;
const CATEGORY_COLORS = PHARMACY_ADVICE_CATEGORY_COLORS;

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
    const stats: Record<string, number> = {};
    Object.values(ADVICE_CATEGORIES).forEach((cat) => {
      stats[cat.label] = 0;
    });

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
        <h1>用藥建議與統計</h1>
        <LoadingSpinner text="載入用藥建議記錄中..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <h1>用藥建議與統計</h1>
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
        <h1>用藥建議與統計</h1>
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
                {Object.values(ADVICE_CATEGORIES).map((cat) => (
                  <SelectItem key={cat.key} value={cat.label}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* 統計摘要卡片 */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-[#7f265b]">
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

      {/* 圖表區域 — 有資料時才顯示 */}
      {totalAdvices > 0 && (
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
            </CardContent>
          </Card>
        </div>
      )}

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
