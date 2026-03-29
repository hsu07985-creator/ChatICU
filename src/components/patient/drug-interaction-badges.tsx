import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../ui/utils';

export interface DrugInteraction {
  drug_a: string;
  drug_b: string;
  risk: string; // "A" | "B" | "C" | "D" | "X"
  title: string;
  severity?: string;
}

export interface DrugInteractionBadgesProps {
  interactions: DrugInteraction[];
  hasRiskX?: boolean;
}

interface RiskConfig {
  label: string;
  badgeClass: string;
  borderClass: string;
}

const RISK_CONFIG: Record<string, RiskConfig> = {
  X: {
    label: '禁忌',
    badgeClass: 'bg-red-100 text-red-800 border-red-300',
    borderClass: 'border-red-300',
  },
  D: {
    label: '重大',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
    borderClass: 'border-orange-300',
  },
  C: {
    label: '監測',
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    borderClass: 'border-yellow-300',
  },
  B: {
    label: '輕微',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
    borderClass: 'border-blue-300',
  },
  A: {
    label: '無交互',
    badgeClass: 'bg-green-100 text-green-800 border-green-300',
    borderClass: 'border-green-300',
  },
};

const RISK_ORDER: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };

function getRiskConfig(risk: string): RiskConfig {
  return RISK_CONFIG[risk.toUpperCase()] ?? {
    label: risk,
    badgeClass: 'bg-gray-100 text-gray-800 border-gray-300',
    borderClass: 'border-gray-300',
  };
}

interface InteractionBadgeProps {
  interaction: DrugInteraction;
}

function InteractionBadge({ interaction }: InteractionBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const riskUpper = interaction.risk.toUpperCase();
  const config = getRiskConfig(riskUpper);
  const isRiskX = riskUpper === 'X';

  if (isRiskX) {
    return (
      <div
        className={cn(
          'rounded-lg border-2 px-3 py-2 text-xs',
          'bg-red-50 border-red-400 text-red-900',
          'flex flex-col gap-1',
        )}
      >
        <div className="flex items-center gap-1.5 font-bold text-[13px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-700" />
          <span>X 禁忌</span>
          <span className="font-normal text-red-700">
            {interaction.drug_a} + {interaction.drug_b}
          </span>
        </div>
        <p className="text-red-800 font-medium text-[11px]">
          禁忌組合 — 應避免合併使用
        </p>
        {interaction.title && (
          <p className="text-red-700 text-[11px] leading-relaxed">{interaction.title}</p>
        )}
        {interaction.severity && (
          <p className="text-red-600 text-[10px]">{interaction.severity}</p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-xs text-left transition-colors',
        config.badgeClass,
        'hover:brightness-95',
      )}
    >
      <div className="flex items-center gap-1.5 font-medium">
        <span>{riskUpper} {config.label}</span>
        <span className="opacity-70 font-normal">
          {interaction.drug_a} + {interaction.drug_b}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0 ml-auto" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 ml-auto" />
        )}
      </div>
      {expanded && interaction.title && (
        <p className="mt-1 text-[11px] leading-relaxed opacity-90">{interaction.title}</p>
      )}
      {expanded && interaction.severity && (
        <p className="mt-0.5 text-[10px] opacity-75">{interaction.severity}</p>
      )}
    </button>
  );
}

export function DrugInteractionBadges({
  interactions,
  hasRiskX,
}: DrugInteractionBadgesProps) {
  if (!interactions || interactions.length === 0) {
    return null;
  }

  const sorted = [...interactions].sort((a, b) => {
    const orderA = RISK_ORDER[a.risk.toUpperCase()] ?? 99;
    const orderB = RISK_ORDER[b.risk.toUpperCase()] ?? 99;
    return orderA - orderB;
  });

  return (
    <div className="mb-2 space-y-1.5">
      {hasRiskX && (
        <div className="flex items-center gap-1 text-[11px] font-semibold text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>偵測到禁忌藥物組合</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((interaction, idx) => (
          <InteractionBadge
            key={`${interaction.drug_a}-${interaction.drug_b}-${idx}`}
            interaction={interaction}
          />
        ))}
      </div>
    </div>
  );
}
