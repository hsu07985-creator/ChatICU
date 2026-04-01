import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import { LoadingSpinner, EmptyState } from '../../components/ui/state-display';
import { FileText, Loader2, User, Tag, Pill, Send, TrendingUp, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAdviceRecords,
  createAdviceRecord,
  type PharmacyAdviceRecord,
} from '../../lib/api/pharmacy';
import { getPatients, type Patient } from '../../lib/api/patients';
import {
  PHARMACY_ADVICE_CATEGORIES,
  PHARMACY_ADVICE_CATEGORY_COLORS,
} from '../../lib/pharmacy-master-data';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

export function PharmacyAdviceStatisticsPage() {
  // ── 病患清單 ──
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);

  // ── 表單 ──
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [accepted, setAccepted] = useState<string>('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── 紀錄 ──
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [records, setRecords] = useState<PharmacyAdviceRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  // 載入病患清單
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPatientsLoading(true);
      try {
        const res = await getPatients({ limit: 200 });
        if (!cancelled) setPatients(res.patients);
      } catch {
        if (!cancelled) toast.error('載入病患清單失敗');
      } finally {
        if (!cancelled) setPatientsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 載入紀錄
  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await getAdviceRecords({ month: currentMonth, limit: 500 });
      setRecords(res.records);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 取得選中的類別物件
  const selectedCategory = selectedCategoryKey
    ? PHARMACY_ADVICE_CATEGORIES[selectedCategoryKey]
    : null;

  // 取得選中的細項
  const selectedCodeItem = selectedCategory?.codes.find((c) => c.code === selectedCode);

  // 送出
  const handleSubmit = async () => {
    if (!selectedPatientId || !selectedCategory || !selectedCodeItem) {
      toast.error('請選擇病患與建議類別');
      return;
    }
    setSubmitting(true);
    try {
      await createAdviceRecord({
        patientId: selectedPatientId,
        adviceCode: selectedCodeItem.code,
        adviceLabel: selectedCodeItem.label,
        category: selectedCategory.label,
        content: content.trim() || selectedCodeItem.label,
        accepted: accepted === 'yes' ? true : accepted === 'no' ? false : undefined,
      });
      toast.success('藥事紀錄已建立');
      setSelectedPatientId('');
      setSelectedCategoryKey('');
      setSelectedCode('');
      setAccepted('');
      setContent('');
      await fetchRecords();
    } catch {
      toast.error('建立紀錄失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 統計 ──
  const categoryStats: Record<string, number> = {};
  Object.values(PHARMACY_ADVICE_CATEGORIES).forEach((cat) => {
    categoryStats[cat.label] = 0;
  });
  records.forEach((r) => {
    if (categoryStats[r.category] !== undefined) categoryStats[r.category]++;
  });
  const totalAdvices = Object.values(categoryStats).reduce((s, v) => s + v, 0);

  const pieData = Object.entries(categoryStats)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({
      name,
      value,
      color: PHARMACY_ADVICE_CATEGORY_COLORS[name] || '#999',
    }));

  const codeStats: Record<string, number> = {};
  records.forEach((r) => {
    codeStats[r.adviceCode] = (codeStats[r.adviceCode] || 0) + 1;
  });
  const barData = Object.entries(codeStats)
    .map(([code, count]) => {
      const rec = records.find((r) => r.adviceCode === code);
      return {
        code,
        label: rec?.adviceLabel || code,
        category: rec?.category || '',
        count,
        color: PHARMACY_ADVICE_CATEGORY_COLORS[rec?.category || ''] || '#7f265b',
      };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const renderBarTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload?: typeof barData[number] }> }) => {
    if (!active || !payload?.[0]?.payload) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-semibold">{d.code} {d.label}</p>
        <p className="text-muted-foreground text-xs">{d.category}</p>
        <p className="font-bold mt-1 text-base">{d.count} 筆</p>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1>用藥建議與統計</h1>
        <p className="text-muted-foreground text-sm mt-0.5">藥師照護介入紀錄與分類統計（四大類 23 細項）</p>
      </div>

      {/* ── 新增紀錄 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">新增藥事紀錄</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            {/* 病患 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">病患 *</label>
              {patientsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground h-9">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 載入中...
                </div>
              ) : (
                <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="選擇病患" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.bedNumber} {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 類別 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">建議類別 *</label>
              <Select
                value={selectedCategoryKey}
                onValueChange={(v) => {
                  setSelectedCategoryKey(v);
                  setSelectedCode('');
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="選擇類別" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => (
                    <SelectItem key={key} value={key}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 細項 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">細項 *</label>
              <Select
                value={selectedCode}
                onValueChange={setSelectedCode}
                disabled={!selectedCategory}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={selectedCategory ? '選擇細項' : '先選類別'} />
                </SelectTrigger>
                <SelectContent>
                  {selectedCategory?.codes.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 醫師是否接受 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">醫師是否接受</label>
              <Select value={accepted} onValueChange={setAccepted}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">接受</SelectItem>
                  <SelectItem value="no">不接受</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 備註 + 送出 */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Textarea
                placeholder="備註說明（選填）"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[60px] resize-none"
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedPatientId || !selectedCode}
              className="h-[60px] px-6"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  送出
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 統計卡片 ── */}
      <div className="grid gap-3 md:grid-cols-5">
        <Card className="border-[#7f265b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月總計</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#7f265b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">{totalAdvices}</div>
          </CardContent>
        </Card>

        {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => {
          const color = PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#999';
          return (
            <Card key={key} className="border-l-4" style={{ borderLeftColor: color }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{cat.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color }}>
                  {categoryStats[cat.label] ?? 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{cat.codes.length} 細項</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── 圖表 ── */}
      {totalAdvices > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">類別分佈</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={90}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">細項分析（{barData.length} 項）</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="code"
                    stroke="#6b7280"
                    tick={{ fontSize: 12, fontWeight: 600 }}
                    axisLine={{ stroke: '#d1d5db' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={renderBarTooltip} />
                  <Bar
                    dataKey="count"
                    radius={[6, 6, 0, 0]}
                    barSize={barData.length <= 4 ? 48 : undefined}
                    label={{ position: 'top', fontSize: 13, fontWeight: 700 }}
                  >
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 紀錄清單 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            紀錄清單
            <Badge variant="secondary">{records.length} 筆</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <LoadingSpinner text="載入中..." />
          ) : records.length > 0 ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {records.map((record) => (
                  <div
                    key={record.id}
                    className="border-l-4 rounded-lg p-3 bg-white hover:shadow-md transition-shadow"
                    style={{ borderLeftColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          className="text-white"
                          style={{ backgroundColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                        >
                          {record.adviceCode}
                        </Badge>
                        <span className="font-medium text-sm">{record.adviceLabel}</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {new Date(record.timestamp).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 mb-1.5 text-xs">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{record.bedNumber} {record.patientName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{record.pharmacistName}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{record.category}</Badge>
                      {record.accepted === true && (
                        <Badge className="bg-green-600 text-white text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> 已接受
                        </Badge>
                      )}
                      {record.accepted === false && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <XCircle className="h-3 w-3" /> 未接受
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm text-[#1a1a1a] leading-relaxed whitespace-pre-line">
                      {record.content}
                    </p>

                    {record.linkedMedications && record.linkedMedications.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                        <Pill className="h-3 w-3 text-muted-foreground" />
                        {record.linkedMedications.map((med, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">{med}</Badge>
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
              title="本月尚無紀錄"
              description="使用上方表單新增藥師照護介入紀錄"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
