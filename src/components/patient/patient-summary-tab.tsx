import { useState } from 'react';
import {
  getClinicalSummary,
  getPatientExplanation,
  getDecisionSupport,
  getReadinessReason,
  type AIReadiness,
  type DataFreshness,
  type RAGStatus,
} from '../../lib/api/ai';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { AiMarkdown, SafetyWarnings } from '../ui/ai-markdown';
import {
  AlertCircle,
  Brain,
  FileText,
  Sparkles,
  BookOpen,
  Shield,
  Copy,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

interface PatientSummaryTabPatient {
  id: string;
  age: number;
  gender?: string | null;
  bmi?: number | null;
  height?: number | null;
  weight?: number | null;
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

export function PatientSummaryTab({ patient, userRole, ragStatus, aiReadiness }: PatientSummaryTabProps) {
  const [aiSummary, setAiSummary] = useState('');
  const [summaryWarnings, setSummaryWarnings] = useState<string[] | null>(null);
  const [summaryFreshness, setSummaryFreshness] = useState<DataFreshness | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [explanationTopic, setExplanationTopic] = useState('');
  const [explanationResult, setExplanationResult] = useState('');
  const [explanationWarnings, setExplanationWarnings] = useState<string[] | null>(null);
  const [explanationFreshness, setExplanationFreshness] = useState<DataFreshness | null>(null);
  const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
  const [readingLevel, setReadingLevel] = useState<'simple' | 'moderate' | 'detailed'>('moderate');
  const [decisionQuestion, setDecisionQuestion] = useState('');
  const [decisionResult, setDecisionResult] = useState('');
  const [decisionWarnings, setDecisionWarnings] = useState<string[] | null>(null);
  const [decisionFreshness, setDecisionFreshness] = useState<DataFreshness | null>(null);
  const [isGeneratingDecision, setIsGeneratingDecision] = useState(false);
  const [showAssessments, setShowAssessments] = useState(false);
  const [nephrologistOpinion, setNephrologistOpinion] = useState('');
  const [pharmacistOpinion, setPharmacistOpinion] = useState('');
  const [nursingOpinion, setNursingOpinion] = useState('');

  const symptoms = Array.isArray(patient.symptoms) ? patient.symptoms : [];
  const canSummary = aiReadiness ? aiReadiness.feature_gates.clinical_summary : true;
  const canExplanation = aiReadiness ? aiReadiness.feature_gates.patient_explanation : true;
  const canDecision = aiReadiness ? aiReadiness.feature_gates.decision_support : true;
  const summaryReason = getReadinessReason(aiReadiness, 'clinical_summary');
  const explanationReason = getReadinessReason(aiReadiness, 'patient_explanation');
  const decisionReason = getReadinessReason(aiReadiness, 'decision_support');

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Card className="overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/80">
          <CardHeader className="border-b border-slate-200/80 bg-white/70 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base tracking-tight text-slate-900">基本資訊 / 症狀 / 入院診斷</CardTitle>
                <p className="mt-1 text-xs text-slate-500">病例概覽</p>
              </div>
              <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                Overview
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Age</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.age} years</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Gender</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.gender || '-'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">BMI</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.bmi ? `${patient.bmi} kg/m²` : '-'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Height</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.height ? `${patient.height} cm` : '-'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Weight</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.weight ? `${patient.weight} kg` : '-'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Patient ID</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{patient.id || '-'}</p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold tracking-wide text-slate-600">症狀 Symptom</p>
                <ul className="mt-2 space-y-1.5">
                  {symptoms.length > 0 ? (
                    symptoms.map((symptom: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
                          {idx + 1}
                        </span>
                        <span className="text-sm leading-relaxed text-slate-800">{symptom}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">尚無症狀記錄</li>
                  )}
                </ul>
              </section>
              <section className="rounded-lg border border-blue-200/80 bg-gradient-to-br from-blue-50/80 to-white p-3">
                <p className="text-xs font-semibold tracking-wide text-blue-700">入院診斷</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{patient.diagnosis || '-'}</p>
              </section>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-[#7f265b]/25 bg-gradient-to-br from-white via-white to-[#7f265b]/[0.04]">
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-[#7f265b]" />
              AI 臨床摘要
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed text-slate-600">
              根據病患完整臨床資料（檢驗、生命徵象、藥物、呼吸器）自動生成摘要
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Button
              size="sm"
              className="w-full bg-[#7f265b] hover:bg-[#631e4d] sm:w-auto"
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

      <h2 className="flex flex-wrap items-center gap-2 text-base font-bold">
        <Brain className="h-4 w-4 text-[#7f265b]" />
        AI 臨床輔助工具
        {ragStatus !== null && (
          ragStatus.is_indexed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              知識庫：已索引 {ragStatus.total_documents} 文件 / {ragStatus.total_chunks} 區塊
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              知識庫：未索引
            </span>
          )
        )}
      </h2>
      {aiReadiness && !aiReadiness.overall_ready && (
        <Alert className="border-amber-300 bg-amber-50 py-2">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-sm text-amber-800">
            {(aiReadiness.display_reasons || []).join(' ') || 'AI 服務尚未就緒，部分功能已暫時停用。'}
          </AlertDescription>
        </Alert>
      )}

      <div className={`grid gap-3 ${userRole === 'doctor' || userRole === 'admin' ? 'xl:grid-cols-2' : ''}`}>
        <Card className="border border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-blue-600" />
              衛教說明產生器
            </CardTitle>
            <CardDescription className="text-xs">將複雜的臨床資訊轉換為簡單易懂的病患/家屬說明</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Textarea
              placeholder="輸入衛教主題，例如：目前使用的藥物有什麼副作用？呼吸器什麼時候可以拔管？"
              value={explanationTopic}
              onChange={(e) => setExplanationTopic(e.target.value)}
              className="min-h-[64px] border-2 border-blue-200"
            />
            <div className="flex items-center gap-2">
              <label className="text-sm text-blue-700 whitespace-nowrap">說明程度：</label>
              <select
                value={readingLevel}
                onChange={(e) => setReadingLevel(e.target.value as 'simple' | 'moderate' | 'detailed')}
                className="border border-blue-200 rounded px-2 py-1 text-sm bg-white"
              >
                <option value="simple">簡單（一般民眾）</option>
                <option value="moderate">中等（預設）</option>
                <option value="detailed">詳細（有醫學背景）</option>
              </select>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                if (!explanationTopic.trim()) return;
                if (!canExplanation) {
                  toast.error(explanationReason);
                  return;
                }
                setIsGeneratingExplanation(true);
                try {
                  const result = await getPatientExplanation(patient.id, explanationTopic, readingLevel);
                  setExplanationResult(result.explanation);
                  setExplanationWarnings(result.safetyWarnings || null);
                  setExplanationFreshness(result.dataFreshness || null);
                } catch {
                  toast.error('衛教說明生成失敗');
                } finally {
                  setIsGeneratingExplanation(false);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700"
              disabled={isGeneratingExplanation || !explanationTopic.trim() || !canExplanation}
            >
              <BookOpen className="mr-2 h-4 w-4" />
              {isGeneratingExplanation ? '生成中...' : '產生衛教說明'}
            </Button>
            {explanationResult && (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3">
                <AiMarkdown content={explanationResult} className="text-sm" />
                <SafetyWarnings warnings={explanationWarnings} />
                <DataFreshnessHint dataFreshness={explanationFreshness} />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    const ok = await copyToClipboard(explanationResult);
                    ok ? toast.success('已複製') : toast.error('複製失敗');
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" /> 複製
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {(userRole === 'doctor' || userRole === 'admin') && (
          <Card className="border border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-amber-600" />
                多角色決策支援
                <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">醫師專用</Badge>
              </CardTitle>
              <CardDescription className="text-xs">整合多科別評估意見，產生統合性臨床建議</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Textarea
                placeholder="輸入臨床問題，例如：是否應該從 Midazolam 轉換為 Propofol？腎功能持續下降是否需要 CRRT？"
                value={decisionQuestion}
                onChange={(e) => setDecisionQuestion(e.target.value)}
                className="min-h-[64px] border-2 border-amber-200"
              />
              <button
                type="button"
                onClick={() => setShowAssessments(!showAssessments)}
                className="flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showAssessments ? 'rotate-180' : ''}`} />
                多科別評估意見（選填）
              </button>
              {showAssessments && (
                <div className="space-y-2 pl-2 border-l-2 border-amber-200">
                  <div>
                    <label className="text-xs text-amber-700 font-medium">腎臟科意見（選填）</label>
                    <Textarea
                      placeholder="例如：eGFR 持續下降至 28，建議評估 CRRT 時機"
                      value={nephrologistOpinion}
                      onChange={(e) => setNephrologistOpinion(e.target.value)}
                      className="min-h-[44px] border border-amber-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700 font-medium">藥師意見（選填）</label>
                    <Textarea
                      placeholder="例如：Meropenem 需根據腎功能調整劑量，建議 0.5g Q8H"
                      value={pharmacistOpinion}
                      onChange={(e) => setPharmacistOpinion(e.target.value)}
                      className="min-h-[44px] border border-amber-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700 font-medium">護理觀點（選填）</label>
                    <Textarea
                      placeholder="例如：病人躁動頻繁，RASS -1 到 +2 波動，翻身時 SpO2 會掉到 88%"
                      value={nursingOpinion}
                      onChange={(e) => setNursingOpinion(e.target.value)}
                      className="min-h-[44px] border border-amber-200 text-sm"
                    />
                  </div>
                </div>
              )}
              <Button
                size="sm"
                onClick={async () => {
                  if (!decisionQuestion.trim()) return;
                  if (!canDecision) {
                    toast.error(decisionReason);
                    return;
                  }
                  setIsGeneratingDecision(true);
                  try {
                    const assessments: Array<Record<string, unknown>> = [];
                    if (nephrologistOpinion.trim()) {
                      assessments.push({ agent: 'nephrologist', opinion: nephrologistOpinion.trim() });
                    }
                    if (pharmacistOpinion.trim()) {
                      assessments.push({ agent: 'pharmacist', opinion: pharmacistOpinion.trim() });
                    }
                    if (nursingOpinion.trim()) {
                      assessments.push({ agent: 'nurse', opinion: nursingOpinion.trim() });
                    }
                    const result = await getDecisionSupport({
                      patientId: patient.id,
                      question: decisionQuestion,
                      assessments: assessments.length > 0 ? assessments : undefined,
                    });
                    setDecisionResult(result.recommendation);
                    setDecisionWarnings(result.safetyWarnings || null);
                    setDecisionFreshness(result.dataFreshness || null);
                  } catch {
                    toast.error('決策支援生成失敗');
                  } finally {
                    setIsGeneratingDecision(false);
                  }
                }}
                className="bg-amber-600 hover:bg-amber-700"
                disabled={isGeneratingDecision || !decisionQuestion.trim() || !canDecision}
              >
                <Shield className="mr-2 h-4 w-4" />
                {isGeneratingDecision ? '分析中...' : '產生決策建議'}
              </Button>
              {decisionResult && (
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-3">
                  <AiMarkdown content={decisionResult} className="text-sm" />
                  <SafetyWarnings warnings={decisionWarnings} />
                  <DataFreshnessHint dataFreshness={decisionFreshness} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={async () => {
                      const ok = await copyToClipboard(decisionResult);
                      ok ? toast.success('已複製') : toast.error('複製失敗');
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" /> 複製
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
