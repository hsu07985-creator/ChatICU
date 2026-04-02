import { useState } from 'react';
import {
  getClinicalSummary,
  getReadinessReason,
  type AIReadiness,
  type DataFreshness,
  type RAGStatus,
} from '../../lib/api/ai';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { AiMarkdown, SafetyWarnings } from '../ui/ai-markdown';
import {
  FileText,
  Sparkles,
  Copy,
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
  ragStatus: RAGStatus | null;
  aiReadiness: AIReadiness | null;
}

function DataFreshnessHint({ dataFreshness }: { dataFreshness?: DataFreshness | null }) {
  if (!dataFreshness || !Array.isArray(dataFreshness.hints) || dataFreshness.hints.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
      <p className="font-medium">資料新鮮度/缺值提示</p>
      <p className="mt-1 leading-relaxed">{dataFreshness.hints.join(' ')}</p>
    </div>
  );
}

export function PatientSummaryTab({ patient, aiReadiness }: PatientSummaryTabProps) {
  const [aiSummary, setAiSummary] = useState('');
  const [summaryWarnings, setSummaryWarnings] = useState<string[] | null>(null);
  const [summaryFreshness, setSummaryFreshness] = useState<DataFreshness | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  const symptoms = Array.isArray(patient.symptoms) ? patient.symptoms : [];
  const canSummary = aiReadiness ? aiReadiness.feature_gates.clinical_summary : true;
  const summaryReason = getReadinessReason(aiReadiness, 'clinical_summary');

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
    <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
      {/* ── 左欄：基本資訊 / 症狀 / 入院診斷 ── */}
      <div className="space-y-3">
        <Card className="overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/80">
          <CardHeader className="border-b border-slate-200/80 bg-white/70 pb-2.5">
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
          <CardHeader className="border-b border-slate-200/80 bg-white/70 pb-2.5">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">臨床狀態</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-500">入院診斷</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{patient.diagnosis || '-'}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-500">症狀</p>
              {symptoms.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {symptoms.map((symptom: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-base leading-snug text-slate-800">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      {symptom}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-base text-muted-foreground">尚無症狀記錄</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 右欄：AI 臨床摘要 ── */}
      <Card className="border border-[#7f265b]/25 bg-gradient-to-br from-white via-white to-[#7f265b]/[0.04]">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-[#7f265b]" />
            AI 臨床摘要
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed text-slate-600">
            根據病患完整臨床資料（檢驗、生命徵象、藥物、呼吸器）自動生成摘要
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Button
            size="sm"
            className="bg-[#7f265b] hover:bg-[#631e4d] w-auto"
            onClick={async () => {
              if (!canSummary) {
                toast.error(summaryReason);
                return;
              }
              setIsGeneratingSummary(true);
              try {
                const result = await getClinicalSummary(patient.id);
                setAiSummary(typeof result.summary === 'string' ? result.summary : JSON.stringify(result.summary));
                setSummaryWarnings(result.safetyWarnings || null);
                setSummaryFreshness(result.dataFreshness || null);
              } catch {
                toast.error('AI 摘要生成失敗，請稍後再試');
              } finally {
                setIsGeneratingSummary(false);
              }
            }}
            disabled={isGeneratingSummary || !canSummary}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {isGeneratingSummary ? '生成中...' : '生成臨床摘要'}
          </Button>
          {aiSummary && (
            <div className="rounded-lg border border-[#7f265b]/30 bg-white/90 p-3">
              <AiMarkdown content={aiSummary} className="text-sm" />
              <SafetyWarnings warnings={summaryWarnings} />
              <DataFreshnessHint dataFreshness={summaryFreshness} />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={async () => {
                  const ok = await copyToClipboard(aiSummary);
                  ok ? toast.success('已複製') : toast.error('複製失敗');
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> 複製
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
