import { useCallback, useState } from 'react';
import {
  getClinicalSummary,
  getReadinessReason,
  type AIReadiness,
} from '../../lib/api/ai';
import { updatePatient } from '../../lib/api/patients';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import {
  X,
  Plus,
  Wand2,
  Save,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

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
}

interface PatientSummaryTabProps {
  patient: PatientSummaryTabPatient;
  userRole?: string;
  aiReadiness: AIReadiness | null;
  onPatientUpdate?: (updated: Partial<PatientSummaryTabPatient>) => void;
}

export function PatientSummaryTab({ patient, aiReadiness, onPatientUpdate }: PatientSummaryTabProps) {
  // Symptom editing state
  const initialSymptoms = Array.isArray(patient.symptoms) ? patient.symptoms : [];
  const [editingSymptoms, setEditingSymptoms] = useState<string[]>(initialSymptoms);
  const [newSymptom, setNewSymptom] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges = JSON.stringify(editingSymptoms) !== JSON.stringify(initialSymptoms);

  const canSummary = aiReadiness ? aiReadiness.feature_gates.clinical_summary : true;
  const summaryReason = getReadinessReason(aiReadiness, 'clinical_summary');

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
    // Remove from suggestions if it was there
    setAiSuggestions((prev) => prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase()));
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updatePatient(patient.id, { symptoms: editingSymptoms } as never);
      onPatientUpdate?.({ symptoms: editingSymptoms });
      toast.success('症狀已更新');
    } catch {
      toast.error('更新失敗，請稍後再試');
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
      // Extract key findings from structured summary or parse from text
      const structured = result.summary_structured;
      let suggestions: string[] = [];
      if (structured?.key_findings && Array.isArray(structured.key_findings)) {
        suggestions = structured.key_findings;
      } else {
        // Parse bullet points from summary text
        const lines = (typeof result.summary === 'string' ? result.summary : '')
          .split('\n')
          .map((l) => l.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter((l) => l.length > 3 && l.length < 100);
        suggestions = lines.slice(0, 8);
      }
      // Filter out symptoms already in the list
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
    <div className="space-y-2">
        <Card className="overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/80">
          <CardHeader className="border-b border-slate-200/80 bg-white/70 pb-1.5">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">病患資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {/* ── key-value 表格 ── */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-0 rounded-md border border-slate-200 bg-white px-4 py-2">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-baseline gap-3 border-b border-slate-100 py-2 last:border-b-0">
                  <span className="w-16 shrink-0 text-sm text-slate-500">{row.label}</span>
                  <span className="text-base font-semibold text-slate-900">{row.value}</span>
                </div>
              ))}
            </div>

            {/* ── 臨床旗標 ── */}
            <div className="flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                patient.intubated
                  ? 'border border-red-200 bg-red-50 text-red-700'
                  : 'border border-green-200 bg-green-50 text-green-700'
              }`}>
                <span className={`h-2 w-2 rounded-full ${patient.intubated ? 'bg-red-500' : 'bg-green-500'}`} />
                {patient.intubated ? '插管中' : '未插管'}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                patient.hasDNR
                  ? 'border border-red-200 bg-red-50 text-red-700'
                  : 'border border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                <span className={`h-2 w-2 rounded-full ${patient.hasDNR ? 'bg-red-500' : 'bg-slate-400'}`} />
                {patient.hasDNR ? 'DNR' : '無 DNR'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/80">
          <CardHeader className="border-b border-slate-200/80 bg-white/70 pb-1.5">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">臨床狀態</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-500">入院診斷</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{patient.diagnosis || '-'}</p>
            </div>

            {/* ── 症狀（可編輯） ── */}
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-500">症狀</p>
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

              {/* 現有症狀 tags */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {editingSymptoms.map((symptom, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-700"
                  >
                    {symptom}
                    <button
                      type="button"
                      onClick={() => removeSymptom(idx)}
                      className="ml-0.5 rounded-full p-0.5 text-slate-400 transition-colors hover:bg-red-100 hover:text-red-600"
                      aria-label={`移除 ${symptom}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {editingSymptoms.length === 0 && (
                  <p className="text-sm text-slate-400">尚無症狀記錄</p>
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
                  className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
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

              {/* AI 建議按鈕 */}
              <div className="mt-3 border-t border-slate-100 pt-3">
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

                {/* AI 建議結果 */}
                {aiSuggestions.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-400 mb-1.5">點擊加入：</p>
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
          </CardContent>
        </Card>
    </div>
  );
}
