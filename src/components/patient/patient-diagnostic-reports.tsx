import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getDiagnosticReports, type DiagnosticReport } from '../../lib/api/diagnostic-reports';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  imaging: { label: '影像', color: 'bg-sky-100 text-sky-700' },
  procedure: { label: '檢查', color: 'bg-violet-100 text-violet-700' },
  other: { label: '其他', color: 'bg-slate-100 text-slate-600' },
};

const COLLAPSED_HEIGHT = 120; // px for body text area

function ReportCard({ report }: { report: DiagnosticReport }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_LABELS[report.reportType] || TYPE_LABELS.other;

  const examDate = report.examDate
    ? new Date(report.examDate).toLocaleDateString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : '';

  return (
    <Card className="border-border flex flex-col w-[340px] min-w-[340px] max-w-[340px] h-[420px] overflow-hidden">
      {/* Header — fixed height */}
      <CardHeader className="pb-2 pt-3 px-4 flex-shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-800 line-clamp-1">{report.examName}</h3>
            <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 flex-shrink-0 ${typeInfo.color}`}>
              {typeInfo.label}
            </Badge>
            {report.status === 'preliminary' && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 flex-shrink-0 bg-amber-100 text-amber-700">
                初步報告
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {examDate}
            {report.reporterName && <span> · 報告者: {report.reporterName}</span>}
          </p>
        </div>
      </CardHeader>

      {/* Body — scrollable / collapsible */}
      <CardContent className="pt-0 px-4 pb-3 flex-1 overflow-hidden flex flex-col gap-2">
        <div className={`relative flex-1 overflow-hidden ${!expanded ? 'max-h-[' + COLLAPSED_HEIGHT + 'px]' : ''}`}
          style={!expanded ? { maxHeight: `${COLLAPSED_HEIGHT}px` } : undefined}
        >
          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
            {report.bodyText}
          </pre>
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground flex-shrink-0 self-start"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <><ChevronUp className="h-3 w-3 mr-1" />收合</> : <><ChevronDown className="h-3 w-3 mr-1" />展開全文</>}
        </Button>

        {report.impression && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex-shrink-0">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">IMP</p>
            <pre className="text-xs text-amber-900 whitespace-pre-wrap font-sans leading-relaxed line-clamp-3">
              {report.impression}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PatientDiagnosticReports({ patientId }: { patientId: string }) {
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const data = await getDiagnosticReports(patientId);
      setReports(data);
    } catch (err) {
      console.error('Failed to load diagnostic reports:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  const filtered = filterType ? reports.filter((r) => r.reportType === filterType) : reports;
  const imagingCount = reports.filter((r) => r.reportType === 'imaging').length;
  const procedureCount = reports.filter((r) => r.reportType === 'procedure').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        載入報告中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-3 text-xs rounded-md ${filterType === null ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => setFilterType(null)}
            >
              全部 ({reports.length})
            </Button>
            {imagingCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-3 text-xs rounded-md ${filterType === 'imaging' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setFilterType(filterType === 'imaging' ? null : 'imaging')}
              >
                影像 ({imagingCount})
              </Button>
            )}
            {procedureCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-3 text-xs rounded-md ${filterType === 'procedure' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setFilterType(filterType === 'procedure' ? null : 'procedure')}
              >
                檢查 ({procedureCount})
              </Button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {reports.length === 0 ? '尚無檢查報告' : '無符合篩選條件的報告'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {filtered.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
