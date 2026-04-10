import { useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AiMarkdown } from '@/components/ui/ai-markdown';
import { ConfidenceBadge } from '@/components/patient/confidence-badge';
import { ExpertReviewWarning } from '@/components/patient/expert-review-warning';
import { useClinicalQuery } from '@/hooks/use-clinical-query';
import { type UnifiedQueryData, type UnifiedCitationItem } from '@/lib/api/ai';

// ─── Display mapping tables ─────────────────────────────────────

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
  clinical_rag_guideline: { label: '指引', colorClasses: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400' },
  clinical_rag_pad: { label: 'PAD', colorClasses: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400' },
  clinical_rag_nhi: { label: '健保', colorClasses: 'border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-400' },
  drug_rag_qdrant: { label: '藥品DB', colorClasses: 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-400' },
  drug_graph: { label: '交互作用圖', colorClasses: 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400' },
};

// ─── Sub-components ─────────────────────────────────────────────

function IntentTag({ intent }: { intent: string }) {
  const label = INTENT_LABELS[intent] ?? intent;
  return (
    <Badge className="border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-400 border text-xs">
      {label}
    </Badge>
  );
}

function SourceBadges({ sourcesUsed }: { sourcesUsed: string[] }) {
  if (!sourcesUsed || sourcesUsed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-xs text-slate-500 dark:text-slate-400">來源：</span>
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
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 space-y-1">
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
          <Badge variant="outline" className="text-xs border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400">
            {citation.evidence_grade}
          </Badge>
        )}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          相關度 {Math.round(citation.relevance_score * 100)}%
        </span>
      </div>
      {citation.source_file && (
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate" title={citation.source_file}>
          {citation.source_file}
        </p>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
        {citation.text_snippet}
      </p>
      {citation.drug_names && citation.drug_names.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {citation.drug_names.map((drug) => (
            <span
              key={drug}
              className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-400"
            >
              {drug}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonResult({ data }: { data: UnifiedQueryData }) {
  const [citationsOpen, setCitationsOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/20 p-3">
      {/* Intent + Confidence row */}
      <div className="flex flex-wrap items-center gap-2">
        <IntentTag intent={data.intent} />
        <ConfidenceBadge confidence={data.confidence} />
      </div>

      {/* Expert review warning */}
      <ExpertReviewWarning show={data.requires_expert_review} />

      {/* Main answer */}
      <div className="rounded-md border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-900 p-3">
        <AiMarkdown content={data.answer} className="text-sm" />
      </div>

      {/* Sources used */}
      {data.sources_used && data.sources_used.length > 0 && (
        <SourceBadges sourcesUsed={data.sources_used} />
      )}

      {/* Detected drugs as pill badges */}
      {data.detected_drugs && data.detected_drugs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">偵測到的藥物：</span>
          {data.detected_drugs.map((drug) => (
            <span
              key={drug}
              className="rounded-full bg-teal-100 dark:bg-teal-900/40 px-2 py-0.5 text-[11px] text-teal-700 dark:text-teal-400"
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
              className="flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 transition-colors"
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

// ─── Main component ─────────────────────────────────────────────

export function DrugComparisonPanel() {
  const [drugA, setDrugA] = useState('');
  const [drugB, setDrugB] = useState('');
  const { mutate, isPending, data, error, reset } = useClinicalQuery();

  function handleSubmit() {
    const trimmedA = drugA.trim();
    const trimmedB = drugB.trim();
    if (!trimmedA || !trimmedB) {
      toast.error('請輸入兩個藥品名稱');
      return;
    }
    reset();
    const question = `比較 ${trimmedA} 和 ${trimmedB} 的適應症、劑量、副作用、交互作用和費用`;
    mutate(
      { question },
      {
        onError: (err) => {
          toast.error(err.message || '藥物比較查詢失敗，請稍後再試');
        },
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }

  return (
    <Card className="border border-teal-200 dark:border-teal-800">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-teal-600" />
          藥物比較
        </CardTitle>
        <CardDescription className="text-xs">
          比較兩種藥物的適應症、劑量、副作用、交互作用與費用，整合多源臨床證據
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Side-by-side drug inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">藥品 A</label>
            <Input
              placeholder="藥品 A（例：Lipitor）"
              value={drugA}
              onChange={(e) => setDrugA(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">藥品 B</label>
            <Input
              placeholder="藥品 B（例：Crestor）"
              value={drugB}
              onChange={(e) => setDrugB(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isPending}
            />
          </div>
        </div>

        <Button
          size="sm"
          onClick={handleSubmit}
          className="bg-teal-600 hover:bg-teal-700 w-full"
          disabled={isPending || !drugA.trim() || !drugB.trim()}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在比較藥物資訊...
            </>
          ) : (
            <>
              <GitCompareArrows className="mr-2 h-4 w-4" />
              比較藥物
            </>
          )}
        </Button>

        {/* Error state */}
        {error && !isPending && (
          <Alert variant="destructive">
            <AlertDescription>
              {error.message || '查詢失敗，請稍後再試'}
            </AlertDescription>
          </Alert>
        )}

        {/* Result */}
        {data && !isPending && <ComparisonResult data={data} />}
      </CardContent>
    </Card>
  );
}
