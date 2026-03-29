import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AiMarkdown } from '@/components/ui/ai-markdown';
import { ExpertReviewWarning } from '@/components/patient/expert-review-warning';
import { MultiSourceLoader } from '@/components/patient/multi-source-loader';
import { useClinicalQuery } from '@/hooks/use-clinical-query';
import { type UnifiedQueryData, type UnifiedCitationItem } from '@/lib/api/ai';
import { ConfidenceBadge } from './confidence-badge';

// ─── Display mapping tables ──────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  dose_calculation: '劑量計算',
  pair_interaction: '藥物交互',
  multi_drug_rx: '多藥處方檢查',
  iv_compatibility: 'IV 相容性',
  drug_monograph: '藥品資訊',
  single_drug_interactions: '單藥交互作用',
  nhi_reimbursement: '健保給付',
  clinical_guideline: '臨床指引',
  clinical_decision: '臨床決策',
  patient_education: '病人衛教',
  clinical_summary: '臨床摘要',
  drug_comparison: '藥物比較',
  general_pharmacology: '藥理學',
};

const SOURCE_LABELS: Record<string, { label: string; colorClasses: string }> = {
  clinical_rag_guideline: { label: '指引', colorClasses: 'border-blue-300 bg-blue-50 text-blue-800' },
  clinical_rag_pad: { label: 'PAD', colorClasses: 'border-blue-300 bg-blue-50 text-blue-800' },
  clinical_rag_nhi: { label: '健保', colorClasses: 'border-purple-300 bg-purple-50 text-purple-800' },
  drug_rag_qdrant: { label: '藥品DB', colorClasses: 'border-green-300 bg-green-50 text-green-800' },
  drug_graph: { label: '交互作用圖', colorClasses: 'border-orange-300 bg-orange-50 text-orange-800' },
};

// ─── Sub-components ──────────────────────────────────────────────

function IntentTag({ intent }: { intent: string }) {
  const label = INTENT_LABELS[intent] ?? intent;
  return (
    <Badge className="border-indigo-300 bg-indigo-50 text-indigo-800 border text-xs">
      {label}
    </Badge>
  );
}

function SourceBadges({ sourcesUsed }: { sourcesUsed: string[] }) {
  if (!sourcesUsed || sourcesUsed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-xs text-slate-500">來源：</span>
      {sourcesUsed.map((src) => {
        const info = SOURCE_LABELS[src];
        if (!info) {
          return (
            <Badge key={src} variant="outline" className="text-xs">
              {src}
            </Badge>
          );
        }
        return (
          <Badge key={src} className={`text-xs border ${info.colorClasses}`}>
            {info.label}
          </Badge>
        );
      })}
    </div>
  );
}



function CitationCard({ citation }: { citation: UnifiedCitationItem }) {
  const sourceInfo = SOURCE_LABELS[citation.source_system];
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {sourceInfo ? (
          <Badge className={`text-xs border ${sourceInfo.colorClasses}`}>
            {sourceInfo.label}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">
            {citation.source_system}
          </Badge>
        )}
        {citation.evidence_grade && (
          <Badge variant="outline" className="text-xs border-slate-300 text-slate-600">
            {citation.evidence_grade}
          </Badge>
        )}
        <span className="text-xs text-slate-400 ml-auto">
          相關度 {Math.round(citation.relevance_score * 100)}%
        </span>
      </div>
      {citation.source_file && (
        <p className="text-xs font-medium text-slate-700 truncate" title={citation.source_file}>
          {citation.source_file}
        </p>
      )}
      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
        {citation.text_snippet}
      </p>
      {citation.drug_names && citation.drug_names.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {citation.drug_names.map((drug) => (
            <span
              key={drug}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
            >
              {drug}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QueryResult({ data }: { data: UnifiedQueryData }) {
  const [citationsOpen, setCitationsOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      {/* Intent + Confidence row */}
      <div className="flex flex-wrap items-center gap-2">
        <IntentTag intent={data.intent} />
        <ConfidenceBadge confidence={data.confidence} />
      </div>

      {/* Expert review warning */}
      <ExpertReviewWarning show={data.requires_expert_review} />

      {/* Main answer */}
      <div className="rounded-md border border-indigo-100 bg-white p-3">
        <AiMarkdown content={data.answer} className="text-sm" />
      </div>

      {/* Sources used */}
      {data.sources_used && data.sources_used.length > 0 && (
        <SourceBadges sourcesUsed={data.sources_used} />
      )}

      {/* Detected drugs */}
      {data.detected_drugs && data.detected_drugs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-slate-500">偵測到的藥物：</span>
          {data.detected_drugs.map((drug) => (
            <span
              key={drug}
              className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700"
            >
              {drug}
            </span>
          ))}
        </div>
      )}

      {/* Collapsible citations */}
      {data.citations && data.citations.length > 0 && (
        <Collapsible open={citationsOpen} onOpenChange={setCitationsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 transition-colors"
            >
              {citationsOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              引用來源（{data.citations.length} 筆）
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              {data.citations.map((citation) => (
                <CitationCard key={citation.citation_id} citation={citation} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

interface ClinicalQueryPanelProps {
  patientId?: number;
  canQuery?: boolean;
  disabledReason?: string;
}

export function ClinicalQueryPanel({
  patientId,
  canQuery = true,
  disabledReason,
}: ClinicalQueryPanelProps) {
  const [question, setQuestion] = useState('');
  const [queryStartTime, setQueryStartTime] = useState<number | undefined>();
  const { mutate, isPending, data, error, reset } = useClinicalQuery();

  function handleSubmit() {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (!canQuery) {
      toast.error(disabledReason ?? 'AI 服務尚未就緒，請稍後重試。');
      return;
    }
    reset();
    setQueryStartTime(Date.now());
    mutate(
      { question: trimmed, patient_id: patientId },
      {
        onError: (err) => {
          toast.error(err.message || '統整查詢失敗，請稍後再試');
        },
      }
    );
  }

  return (
    <Card className="border border-indigo-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-indigo-600" />
          統整知識庫查詢
        </CardTitle>
        <CardDescription className="text-xs">
          跨臨床指引、藥品資料庫與交互作用圖的統整查詢，自動判斷意圖並整合多源證據
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Textarea
          placeholder="輸入臨床問題，例如：Propofol 在肥胖病人的劑量調整？Warfarin 與 Aspirin 併用的交互作用？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              handleSubmit();
            }
          }}
          className="min-h-[64px] border border-indigo-200"
          disabled={isPending}
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          className="bg-indigo-600 hover:bg-indigo-700"
          disabled={isPending || !question.trim() || !canQuery}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              查詢中...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              統整查詢
            </>
          )}
        </Button>

        {/* Multi-source progressive loading indicator */}
        <MultiSourceLoader isLoading={isPending} startTime={queryStartTime} />

        {/* Error state */}
        {error && !isPending && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-800">
              {error.message || '查詢失敗，請稍後再試'}
            </p>
          </div>
        )}

        {/* Result */}
        {data && !isPending && <QueryResult data={data} />}
      </CardContent>
    </Card>
  );
}
