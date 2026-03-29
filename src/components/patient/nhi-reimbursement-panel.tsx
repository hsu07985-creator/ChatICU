import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Loader2, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AiMarkdown } from '@/components/ui/ai-markdown';
import { ExpertReviewWarning } from '@/components/patient/expert-review-warning';
import { useNhiQuery } from '@/hooks/use-nhi-query';
import { type NhiQueryData, type NhiReimbursementRule, type NhiSourceChunk } from '@/lib/api/ai';
import { ConfidenceBadge } from './confidence-badge';

// ─── Sub-components ──────────────────────────────────────────────

function PriorAuthBadge({ requires }: { requires: boolean }) {
  if (requires) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
        <ShieldAlert className="h-3.5 w-3.5" />
        需事前審查
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
      <ShieldCheck className="h-3.5 w-3.5" />
      無需事前審查
    </span>
  );
}

function ReimbursementRuleCard({ rule }: { rule: NhiReimbursementRule }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      {/* Header row: section badge + section name + prior auth */}
      <div className="flex flex-wrap items-center gap-2">
        {rule.section && (
          <Badge className="border-purple-300 bg-purple-50 text-purple-800 border font-mono text-xs">
            §{rule.section}
          </Badge>
        )}
        {rule.section_name && (
          <span className="text-sm font-semibold text-slate-800">{rule.section_name}</span>
        )}
        {/* Prior auth — most critical, placed prominently */}
        <span className="ml-auto">
          <PriorAuthBadge requires={rule.requires_prior_auth} />
        </span>
      </div>

      {/* Conditions */}
      {rule.conditions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">給付條件</p>
          <ul className="space-y-1">
            {rule.conditions.map((cond, idx) => (
              <li key={idx} className="flex items-start gap-1.5 text-sm text-slate-700">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                {cond}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Applicable indications */}
      {rule.applicable_indications.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">適用適應症</p>
          <div className="flex flex-wrap gap-1">
            {rule.applicable_indications.map((ind, idx) => (
              <span
                key={idx}
                className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
              >
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceChunkCard({ chunk }: { chunk: NhiSourceChunk }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-slate-400">{chunk.chunk_id}</span>
        <span className="text-xs text-slate-400">
          相關度 {Math.round(chunk.relevance_score * 100)}%
        </span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">{chunk.text_snippet}</p>
    </div>
  );
}

function NhiQueryResult({ data, warning }: { data: NhiQueryData; warning?: string }) {
  const [chunksOpen, setChunksOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/30 p-3">
      {/* Degraded service warning */}
      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{warning}</p>
        </div>
      )}

      {/* Drug name header */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-semibold text-slate-900">{data.drug_name}</h3>
        {data.drug_name_zh && (
          <span className="text-sm text-slate-500">（{data.drug_name_zh}）</span>
        )}
        <ConfidenceBadge confidence={data.confidence} />
      </div>

      {/* AI answer */}
      {data.answer && (
        <div className="rounded-md border border-purple-100 bg-white p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-purple-400">
            AI 摘要
          </p>
          <AiMarkdown content={data.answer} className="text-sm" />
        </div>
      )}

      {/* Expert review warning when confidence is low */}
      <ExpertReviewWarning
        show={data.confidence < 0.50}
        reason="信心度低於建議門檻 — 建議人工確認健保給付規定"
      />

      {/* Reimbursement rules */}
      {data.reimbursement_rules.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">
            健保給付規定（共 {data.reimbursement_rules.length} 條）
          </p>
          {data.reimbursement_rules.map((rule, idx) => (
            <ReimbursementRuleCard key={idx} rule={rule} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-sm text-slate-500">未找到具體給付規定，請以 AI 摘要為參考。</p>
        </div>
      )}

      {/* Collapsible source chunks */}
      {data.source_chunks.length > 0 && (
        <Collapsible open={chunksOpen} onOpenChange={setChunksOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 transition-colors"
            >
              {chunksOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              原始來源片段（{data.source_chunks.length} 筆）
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              {data.source_chunks.map((chunk) => (
                <SourceChunkCard key={chunk.chunk_id} chunk={chunk} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ─── NHI simple loading indicator ────────────────────────────────

interface NhiLoaderProps {
  isLoading: boolean;
}

function NhiLoader({ isLoading }: NhiLoaderProps) {
  if (!isLoading) return null;

  return (
    <div className="rounded-lg border border-purple-100 bg-slate-50/70 px-3 py-2.5 space-y-2">
      {/* Headline */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-purple-500 animate-spin flex-shrink-0" />
        <span className="text-xs font-medium text-slate-600">正在連線健保資料庫...</span>
      </div>

      {/* Two-step source list */}
      <div className="pl-1 space-y-1.5">
        {/* Step 1 — always active while loading */}
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-purple-500 animate-spin flex-shrink-0" />
          <span className="text-xs font-medium text-purple-700 animate-pulse">
            正在連線健保資料庫
          </span>
          <span className="text-[10px] font-mono rounded px-1 py-0.5 bg-purple-50 text-purple-500 border border-purple-200">
            NHI
          </span>
          <span className="text-xs text-purple-400 animate-pulse select-none">···</span>
        </div>

        {/* Step 2 — waiting */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-300 flex-shrink-0" />
          <span className="text-xs font-medium text-slate-400">正在搜尋給付規定</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

export function NhiReimbursementPanel() {
  const [drugName, setDrugName] = useState('');
  const [indication, setIndication] = useState('');
  const { mutate, isPending, data, error, reset } = useNhiQuery();

  function handleSubmit() {
    const trimmedDrug = drugName.trim();
    if (!trimmedDrug) return;
    reset();
    mutate(
      { drug_name: trimmedDrug, indication: indication.trim() || undefined },
      {
        onError: (err) => {
          toast.error(err.message || '健保給付查詢失敗，請稍後再試');
        },
      }
    );
  }

  return (
    <Card className="border border-purple-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-purple-600" />
          健保給付查詢
        </CardTitle>
        <CardDescription className="text-xs">
          查詢 NHI 藥品給付規定、事前審查條件及適用適應症
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Input area */}
        <div className="space-y-2">
          <Input
            placeholder="輸入藥品名稱（中文或英文）"
            value={drugName}
            onChange={(e) => setDrugName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            disabled={isPending}
          />
          <Input
            placeholder="適應症（選填）"
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            disabled={isPending}
          />
        </div>

        <Button
          size="sm"
          onClick={handleSubmit}
          className="bg-purple-600 hover:bg-purple-700 w-full"
          disabled={isPending || !drugName.trim()}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              查詢中...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              查詢健保給付
            </>
          )}
        </Button>

        {/* NHI loading indicator */}
        <NhiLoader isLoading={isPending} />

        {/* Error state */}
        {error && !isPending && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {error.message || '查詢失敗，請稍後再試'}
            </AlertDescription>
          </Alert>
        )}

        {/* Result */}
        {data && !isPending && (
          <NhiQueryResult data={data.data} warning={data.warning} />
        )}
      </CardContent>
    </Card>
  );
}
