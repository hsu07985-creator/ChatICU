import { useCallback, useEffect, useState } from 'react';
import {
  getClinicalSummary,
  getReadinessReason,
  type AIReadiness,
} from '../../lib/api/ai';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import {
  X,
  Plus,
  Wand2,
  Save,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getSymptomRecords,
  createSymptomRecord,
  type SymptomRecord,
} from '../../lib/api/symptom-records';

interface PatientSummaryTabPatient {
  id: string;
  name?: string;
  age: number;
  gender?: string | null;
  bmi?: number | null;
  height?: number | null;
  weight?: number | null;
  bedNumber?: string;
  attendingPhysician?: string;
  intubated?: boolean;
  hasDNR?: boolean;
  symptoms?: string[];
  diagnosis?: string | null;
  alerts?: string[];
  admissionDate?: string;
  icuAdmissionDate?: string;
  ventilatorDays?: number;
  department?: string;
  isIsolated?: boolean;
  codeStatus?: string | null;
}

interface PatientSummaryTabProps {
  patient: PatientSummaryTabPatient;
  userRole?: string;
  aiReadiness: AIReadiness | null;
  onPatientUpdate?: (updated: Partial<PatientSummaryTabPatient>) => void;
}

/* ── Helpers ─────────────────────────────────── */

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/** Compute diff between two symptom snapshots */
function computeDiff(
  current: string[],
  previous: string[],
): { added: string[]; removed: string[] } {
  const prevSet = new Set(previous.map((s) => s.toLowerCase()));
  const curSet = new Set(current.map((s) => s.toLowerCase()));
  const added = current.filter((s) => !prevSet.has(s.toLowerCase()));
  const removed = previous.filter((s) => !curSet.has(s.toLowerCase()));
  return { added, removed };
}

/* ── Symptom History Timeline ────────────────── */

interface SymptomDiffEntry {
  date: string;
  recordedBy: string | null;
  added: string[];
  removed: string[];
  symptoms: string[];
}

function buildTimeline(records: SymptomRecord[]): SymptomDiffEntry[] {
  // records are already sorted desc by recordedAt
  const sorted = [...records].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const entries: SymptomDiffEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const rec = sorted[i];
    const prev = i > 0 ? sorted[i - 1].symptoms : [];
    const { added, removed } = computeDiff(rec.symptoms, prev);
    entries.push({
      date: rec.recordedAt,
      recordedBy: rec.recordedBy?.name ?? null,
      added,
      removed,
      symptoms: rec.symptoms,
    });
  }
  return entries.reverse(); // newest first
}

function SymptomTimeline({ records }: { records: SymptomRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const timeline = buildTimeline(records);

  if (timeline.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500 py-2">尚無歷史記錄</p>;
  }

  const visible = expanded ? timeline : timeline.slice(0, 3);

  return (
    <div className="space-y-1.5">
      {visible.map((entry, idx) => {
        const hasChanges = entry.added.length > 0 || entry.removed.length > 0;
        const isFirst = idx === timeline.length - 1 && expanded;
        return (
          <div
            key={idx}
            className="flex gap-3 rounded-md border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2"
          >
            <span className="text-xs text-slate-400 dark:text-slate-500 font-medium tabular-nums shrink-0 pt-0.5 w-12">
              {shortDate(entry.date)}
            </span>
            <div className="flex-1 min-w-0">
              {isFirst && !hasChanges ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">初始記錄：{entry.symptoms.join('、')}</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {entry.added.map((s, i) => (
                    <span
                      key={`a-${i}`}
                      className="inline-flex items-center gap-0.5 rounded-full border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 text-xs text-green-700 dark:text-green-400"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      {s}
                    </span>
                  ))}
                  {entry.removed.map((s, i) => (
                    <span
                      key={`r-${i}`}
                      className="inline-flex items-center gap-0.5 rounded-full border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 text-xs text-red-600 dark:text-red-400 line-through"
                    >
                      {s}
                    </span>
                  ))}
                  {!hasChanges && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">無變化</span>
                  )}
                </div>
              )}
              {entry.recordedBy && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 block">{entry.recordedBy}</span>
              )}
            </div>
          </div>
        );
      })}
      {timeline.length > 3 && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors px-3 py-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" /> 收合
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" /> 顯示更多（共 {timeline.length} 筆）
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────── */

export function PatientSummaryTab({ patient, aiReadiness, onPatientUpdate }: PatientSummaryTabProps) {
  // Symptom editing state
  const initialSymptoms = Array.isArray(patient.symptoms) ? patient.symptoms : [];
  const [editingSymptoms, setEditingSymptoms] = useState<string[]>(initialSymptoms);
  const [newSymptom, setNewSymptom] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Symptom history
  const [symptomRecords, setSymptomRecords] = useState<SymptomRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const hasChanges = JSON.stringify(editingSymptoms) !== JSON.stringify(initialSymptoms);

  const canSummary = aiReadiness ? aiReadiness.feature_gates.clinical_summary : true;
  const summaryReason = getReadinessReason(aiReadiness, 'clinical_summary');

  // Load symptom history
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    getSymptomRecords(patient.id)
      .then((records) => {
        if (!cancelled) setSymptomRecords(records);
      })
      .catch(() => {
        // silently fail — history is supplementary
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patient.id]);

  const removeSymptom = useCallback((idx: number) => {
    setEditingSymptoms((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addSymptom = useCallback((symptom: string) => {
    const trimmed = symptom.trim();
    if (!trimmed) return;
    setEditingSymptoms((prev) => {
      if (prev.some((s) => s.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
    setNewSymptom('');
    setAiSuggestions((prev) => prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase()));
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const record = await createSymptomRecord(patient.id, editingSymptoms);
      setSymptomRecords((prev) => [record, ...prev]);
      onPatientUpdate?.({ symptoms: editingSymptoms });
      toast.success('症狀記錄已儲存');
    } catch {
      toast.error('儲存失敗，請稍後再試');
    } finally {
      setIsSaving(false);
    }
  }, [patient.id, editingSymptoms, onPatientUpdate]);

  const handleAiSuggest = useCallback(async () => {
    if (!canSummary) {
      toast.error(summaryReason);
      return;
    }
    setIsLoadingSuggestions(true);
    setAiSuggestions([]);
    try {
      const result = await getClinicalSummary(patient.id);
      const structured = result.summary_structured;
      let suggestions: string[] = [];
      if (structured?.key_findings && Array.isArray(structured.key_findings)) {
        suggestions = structured.key_findings;
      } else {
        const lines = (typeof result.summary === 'string' ? result.summary : '')
          .split('\n')
          .map((l) => l.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter((l) => l.length > 3 && l.length < 100);
        suggestions = lines.slice(0, 8);
      }
      const existing = new Set(editingSymptoms.map((s) => s.toLowerCase()));
      suggestions = suggestions.filter((s) => !existing.has(s.toLowerCase()));
      if (suggestions.length === 0) {
        toast.info('AI 未發現新的建議症狀');
      }
      setAiSuggestions(suggestions);
    } catch {
      toast.error('AI 建議生成失敗');
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [patient.id, canSummary, summaryReason, editingSymptoms]);

  /* ── Computed display data ── */

  // Symptom duration: find earliest appearance of each current symptom
  const symptomDurations = new Map<string, number>();
  if (symptomRecords.length > 0) {
    const sortedAsc = [...symptomRecords].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
    for (const sym of editingSymptoms) {
      const lower = sym.toLowerCase();
      // Find earliest record that contains this symptom
      for (const rec of sortedAsc) {
        if (rec.symptoms.some((s) => s.toLowerCase() === lower)) {
          const days = daysSince(rec.recordedAt);
          if (days !== null) symptomDurations.set(lower, days);
          break;
        }
      }
    }
  }

  const infoRows: { label: string; value: string }[] = [
    { label: '床號', value: patient.bedNumber || '-' },
    { label: '姓名', value: patient.name || '-' },
    { label: '年齡', value: `${patient.age} 歲` },
    { label: '性別', value: patient.gender || '-' },
    { label: '身高', value: patient.height ? `${patient.height} cm` : '-' },
    { label: '體重', value: patient.weight ? `${patient.weight} kg` : '-' },
    { label: 'BMI', value: patient.bmi ? `${patient.bmi}` : '-' },
    { label: '病歷號', value: patient.id },
    { label: '主治醫師', value: patient.attendingPhysician || '-' },
  ];

  return (
    <div className="space-y-3">
    <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
      {/* ── 左欄：基本資訊 ── */}
      <div className="space-y-2">
        <Card className="overflow-hidden border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 via-white to-slate-100/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80">
          <CardHeader className="border-b border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/70 pb-1.5">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">病患資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-baseline gap-3 border-b border-slate-100 dark:border-slate-700 py-2 last:border-b-0">
                  <span className="w-16 shrink-0 text-sm text-slate-500 dark:text-slate-400">{row.label}</span>
                  <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{row.value}</span>
                </div>
              ))}
            </div>

            {/* ── 臨床旗標 ── */}
            <div className="flex flex-wrap gap-2">
              {patient.intubated && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-400">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  插管中
                </span>
              )}
              {patient.hasDNR && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-400">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  DNR
                </span>
              )}
              {patient.isIsolated && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  隔離中
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 右欄：臨床狀態 + 症狀歷程 ── */}
      <Card className="overflow-hidden border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 via-white to-slate-100/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80">
        <CardHeader className="border-b border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/70 pb-1.5">
          <CardTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">臨床狀態</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">入院診斷</p>
            <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{patient.diagnosis || '-'}</p>
          </div>

          {/* ── 目前症狀（可編輯） ── */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">目前症狀</p>
              {hasChanges && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 bg-brand hover:bg-brand-hover text-xs"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                  儲存更新
                </Button>
              )}
            </div>

            {/* 症狀 tags with duration */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {editingSymptoms.map((symptom, idx) => {
                const days = symptomDurations.get(symptom.toLowerCase());
                const isNew = days !== null && days !== undefined && days < 1;
                return (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${
                      isNew
                        ? 'border-brand/30 bg-brand/5 text-brand font-medium'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {symptom}
                    {days !== null && days !== undefined && (
                      <span className={`text-[10px] ml-0.5 ${isNew ? 'text-brand' : 'text-slate-400 dark:text-slate-500'}`}>
                        {isNew ? 'NEW' : `D${days}`}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSymptom(idx)}
                      className="ml-0.5 rounded-full p-0.5 text-slate-400 dark:text-slate-500 transition-colors hover:bg-red-100 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400"
                      aria-label={`移除 ${symptom}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {editingSymptoms.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">尚無症狀記錄</p>
              )}
            </div>

            {/* 手動新增 */}
            <div className="mt-2.5 flex gap-1.5">
              <input
                type="text"
                value={newSymptom}
                onChange={(e) => setNewSymptom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSymptom(newSymptom);
                  }
                }}
                placeholder="輸入新症狀..."
                className="h-8 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5"
                onClick={() => addSymptom(newSymptom)}
                disabled={!newSymptom.trim()}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* AI 建議 */}
            <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-brand/30 text-brand hover:bg-brand/5"
                onClick={handleAiSuggest}
                disabled={isLoadingSuggestions}
              >
                {isLoadingSuggestions ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {isLoadingSuggestions ? 'AI 分析中...' : 'AI 建議症狀'}
              </Button>
              {aiSuggestions.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">點擊加入：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {aiSuggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => addSymptom(suggestion)}
                        className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand/5 px-2.5 py-1 text-sm text-brand transition-colors hover:bg-brand/10 hover:border-brand/40"
                      >
                        <Plus className="h-3 w-3" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 症狀變化歷程 ── */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">症狀變化歷程</p>
            {historyLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 dark:text-slate-500" />
                <span className="text-xs text-slate-400 dark:text-slate-500">載入中...</span>
              </div>
            ) : (
              <SymptomTimeline records={symptomRecords} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>

    </div>
  );
}
