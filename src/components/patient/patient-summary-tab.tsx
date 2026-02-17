import { useState } from 'react';
import {
  getClinicalSummary,
  getPatientExplanation,
  getGuidelineInterpretation,
  getDecisionSupport,
  getReadinessReason,
  type AIReadiness,
  type DataFreshness,
  type GuidelineSource,
  type RAGStatus,
} from '../../lib/api/ai';
import { copyToClipboard } from '../../lib/clipboard-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { AiMarkdown, SafetyWarnings } from '../ui/ai-markdown';
import {
  AlertCircle,
  Brain,
  FileText,
  Sparkles,
  BookOpen,
  Stethoscope,
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
  const [guidelineScenario, setGuidelineScenario] = useState('');
  const [guidelineResult, setGuidelineResult] = useState('');
  const [guidelineWarnings, setGuidelineWarnings] = useState<string[] | null>(null);
  const [guidelineFreshness, setGuidelineFreshness] = useState<DataFreshness | null>(null);
  const [guidelineSources, setGuidelineSources] = useState<GuidelineSource[]>([]);
  const [isQueryingGuideline, setIsQueryingGuideline] = useState(false);
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
  const alerts = Array.isArray(patient.alerts) ? patient.alerts : [];
  const canSummary = aiReadiness ? aiReadiness.feature_gates.clinical_summary : true;
  const canExplanation = aiReadiness ? aiReadiness.feature_gates.patient_explanation : true;
  const canGuideline = aiReadiness ? aiReadiness.feature_gates.guideline_interpretation : true;
  const canDecision = aiReadiness ? aiReadiness.feature_gates.decision_support : true;
  const summaryReason = getReadinessReason(aiReadiness, 'clinical_summary');
  const explanationReason = getReadinessReason(aiReadiness, 'patient_explanation');
  const guidelineReason = getReadinessReason(aiReadiness, 'guideline_interpretation');
  const decisionReason = getReadinessReason(aiReadiness, 'decision_support');

  return (
    <div className="space-y-4">
      <Card className="border-2 border-[#e5e7eb] bg-[#f8f9fa]">
        <CardHeader>
          <CardTitle>基本資訊 Basic Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Age</p>
              <p className="text-xl font-medium">{patient.age} years</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Gender</p>
              <p className="text-xl font-medium">{patient.gender || 'N/A'}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">BMI</p>
              <p className="text-xl font-medium">{patient.bmi ? `${patient.bmi} kg/m²` : 'N/A'}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Height</p>
              <p className="text-xl font-medium">{patient.height ? `${patient.height} cm` : 'N/A'}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Weight</p>
              <p className="text-xl font-medium">{patient.weight ? `${patient.weight} kg` : 'N/A'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>症狀 Symptom</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 list-decimal list-inside">
            {symptoms.length > 0 ? (
              symptoms.map((symptom: string, idx: number) => (
                <li key={idx} className="text-base">{symptom}</li>
              ))
            ) : (
              <li className="text-base text-muted-foreground">尚無症狀記錄</li>
            )}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-[#3c7acb]">
        <CardHeader>
          <CardTitle>入院診斷</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base">{patient.diagnosis || 'N/A'}</p>
        </CardContent>
      </Card>

      <Card className="border-2 border-[#ff3975]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#ff3975]">
            <AlertCircle className="h-5 w-5" />
            風險與警示
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {alerts.map((alert, idx) => (
            <Alert key={idx} className="bg-[#ffe6f0] border-[#ff3975]">
              <AlertCircle className="h-4 w-4 text-[#ff3975]" />
              <AlertDescription className="text-[#ff3975]">{alert}</AlertDescription>
            </Alert>
          ))}
          {alerts.length === 0 && (
            <p className="text-muted-foreground text-sm">目前無警示</p>
          )}
        </CardContent>
      </Card>

      <Separator className="my-4" />
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Brain className="h-5 w-5 text-[#7f265b]" />
        AI 臨床輔助工具
        {ragStatus !== null && (
          ragStatus.is_indexed ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              知識庫：已索引 {ragStatus.total_documents} 文件 / {ragStatus.total_chunks} 區塊
            </span>
          ) : (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              知識庫：未索引
            </span>
          )
        )}
      </h2>
      {aiReadiness && !aiReadiness.overall_ready && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-800">
            {(aiReadiness.display_reasons || []).join(' ') || 'AI 服務尚未就緒，部分功能已暫時停用。'}
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-2 border-[#7f265b]/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#7f265b]" />
            AI 臨床摘要
          </CardTitle>
          <CardDescription>根據病患完整臨床資料（檢驗、生命徵象、藥物、呼吸器）自動生成摘要</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
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
            className="bg-[#7f265b] hover:bg-[#631e4d]"
            disabled={isGeneratingSummary || !canSummary}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {isGeneratingSummary ? '生成中...' : '生成臨床摘要'}
          </Button>
          {aiSummary && (
            <div className="bg-[#f8f9fa] border-2 border-[#7f265b]/30 rounded-lg p-4">
              <AiMarkdown content={aiSummary} className="text-sm" />
              <SafetyWarnings warnings={summaryWarnings} />
              <DataFreshnessHint dataFreshness={summaryFreshness} />
              <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                const ok = await copyToClipboard(aiSummary);
                ok ? toast.success('已複製') : toast.error('複製失敗');
              }}>
                <Copy className="mr-1 h-3 w-3" /> 複製
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            衛教說明產生器
          </CardTitle>
          <CardDescription>將複雜的臨床資訊轉換為簡單易懂的病患/家屬說明</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="輸入衛教主題，例如：目前使用的藥物有什麼副作用？呼吸器什麼時候可以拔管？"
            value={explanationTopic}
            onChange={(e) => setExplanationTopic(e.target.value)}
            className="min-h-[80px] border-2 border-blue-200"
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
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <AiMarkdown content={explanationResult} className="text-sm" />
              <SafetyWarnings warnings={explanationWarnings} />
              <DataFreshnessHint dataFreshness={explanationFreshness} />
              <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                const ok = await copyToClipboard(explanationResult);
                ok ? toast.success('已複製') : toast.error('複製失敗');
              }}>
                <Copy className="mr-1 h-3 w-3" /> 複製
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-2 border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-green-600" />
            臨床指引查詢
          </CardTitle>
          <CardDescription>根據病患情境查詢 RAG 知識庫中的臨床指引建議</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="描述臨床情境，例如：病人持續使用 Midazolam 鎮靜超過 3 天，是否應該更換藥物？"
            value={guidelineScenario}
            onChange={(e) => setGuidelineScenario(e.target.value)}
            className="min-h-[80px] border-2 border-green-200"
          />
          <Button
            onClick={async () => {
              if (!guidelineScenario.trim()) return;
              if (!canGuideline) {
                toast.error(guidelineReason);
                return;
              }
              setIsQueryingGuideline(true);
              try {
                const result = await getGuidelineInterpretation({
                  patientId: patient.id,
                  scenario: guidelineScenario,
                });
                setGuidelineResult(result.interpretation);
                setGuidelineWarnings(result.safetyWarnings || null);
                setGuidelineFreshness(result.dataFreshness || null);
                setGuidelineSources(result.sources || []);
              } catch {
                toast.error('指引查詢失敗');
              } finally {
                setIsQueryingGuideline(false);
              }
            }}
            className="bg-green-600 hover:bg-green-700"
            disabled={isQueryingGuideline || !guidelineScenario.trim() || !canGuideline}
          >
            <Stethoscope className="mr-2 h-4 w-4" />
            {isQueryingGuideline ? '查詢中...' : '查詢指引建議'}
          </Button>
          {guidelineResult && (
            <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
              <AiMarkdown content={guidelineResult} className="text-sm" />
              <SafetyWarnings warnings={guidelineWarnings} />
              <DataFreshnessHint dataFreshness={guidelineFreshness} />
              {guidelineSources.length > 0 ? (
                <div className="mt-3 border-t border-green-200 pt-3">
                  <p className="text-xs font-semibold text-green-700 mb-1">引用來源：</p>
                  <ul className="space-y-1">
                    {guidelineSources.map((source, i) => (
                      <li key={i} className="text-xs text-green-800 flex items-center gap-2">
                        <span className="bg-green-200 text-green-800 px-1.5 py-0.5 rounded text-[10px] font-mono">
                          {(source.score * 100).toFixed(0)}%
                        </span>
                        <span>{source.doc_id}</span>
                        <span className="text-green-500">({source.category})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  注意：此建議來自 AI 預訓練知識，未引用院內文件庫。請以臨床指引原文為準。
                </div>
              )}
              <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                const ok = await copyToClipboard(guidelineResult);
                ok ? toast.success('已複製') : toast.error('複製失敗');
              }}>
                <Copy className="mr-1 h-3 w-3" /> 複製
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(userRole === 'doctor' || userRole === 'admin') && (
        <Card className="border-2 border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-600" />
              多角色決策支援
              <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">醫師專用</Badge>
            </CardTitle>
            <CardDescription>整合多科別評估意見，產生統合性臨床建議</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="輸入臨床問題，例如：是否應該從 Midazolam 轉換為 Propofol？腎功能持續下降是否需要 CRRT？"
              value={decisionQuestion}
              onChange={(e) => setDecisionQuestion(e.target.value)}
              className="min-h-[80px] border-2 border-amber-200"
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
                    className="min-h-[50px] border border-amber-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-amber-700 font-medium">藥師意見（選填）</label>
                  <Textarea
                    placeholder="例如：Meropenem 需根據腎功能調整劑量，建議 0.5g Q8H"
                    value={pharmacistOpinion}
                    onChange={(e) => setPharmacistOpinion(e.target.value)}
                    className="min-h-[50px] border border-amber-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-amber-700 font-medium">護理觀點（選填）</label>
                  <Textarea
                    placeholder="例如：病人躁動頻繁，RASS -1 到 +2 波動，翻身時 SpO2 會掉到 88%"
                    value={nursingOpinion}
                    onChange={(e) => setNursingOpinion(e.target.value)}
                    className="min-h-[50px] border border-amber-200 text-sm"
                  />
                </div>
              </div>
            )}
            <Button
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
              <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
                <AiMarkdown content={decisionResult} className="text-sm" />
                <SafetyWarnings warnings={decisionWarnings} />
                <DataFreshnessHint dataFreshness={decisionFreshness} />
                <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                  const ok = await copyToClipboard(decisionResult);
                  ok ? toast.success('已複製') : toast.error('複製失敗');
                }}>
                  <Copy className="mr-1 h-3 w-3" /> 複製
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
