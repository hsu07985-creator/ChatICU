import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ExpertReviewWarning } from './expert-review-warning';
import { ConfidenceBadge } from './confidence-badge';

// ─── Types ───────────────────────────────────────────────────────

export interface Citation {
  citation_id: string;
  source_system: string;
  source_file?: string;
  text_snippet: string;
  evidence_grade: string;
  relevance_score: number;
  drug_names?: string[];
}

export interface CitationDisplayProps {
  citations: Citation[];
  confidence?: number;
  requiresExpertReview?: boolean;
  className?: string;
}

// ─── Source system label/color mapping ───────────────────────────

const SOURCE_LABELS: Record<string, { label: string; colorClasses: string }> = {
  clinical_rag_guideline: { label: '指引', colorClasses: 'border-blue-300 bg-blue-50 text-blue-800' },
  clinical_rag_pad: { label: 'PAD', colorClasses: 'border-blue-300 bg-blue-50 text-blue-800' },
  clinical_rag_nhi: { label: '健保', colorClasses: 'border-purple-300 bg-purple-50 text-purple-800' },
  drug_rag_qdrant: { label: '藥品DB', colorClasses: 'border-green-300 bg-green-50 text-green-800' },
  drug_graph: { label: '交互作用圖', colorClasses: 'border-orange-300 bg-orange-50 text-orange-800' },
};

// ─── Sub-components ──────────────────────────────────────────────

function CitationCard({ citation }: { citation: Citation }) {
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

// ─── Main component ──────────────────────────────────────────────

export function CitationDisplay({
  citations,
  confidence,
  requiresExpertReview,
  className,
}: CitationDisplayProps) {
  const [open, setOpen] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className={className}>
      {/* Confidence badge — only when provided */}
      {typeof confidence === 'number' && (
        <div className="mt-2">
          <ConfidenceBadge confidence={confidence} />
        </div>
      )}

      {/* Expert review warning — only when required */}
      <ExpertReviewWarning show={!!requiresExpertReview} />

      {/* Collapsible citations */}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 transition-colors"
          >
            {open ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {open ? '隱藏來源' : `顯示來源 (${citations.length})`}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {citations.map((citation) => (
              <CitationCard key={citation.citation_id} citation={citation} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
