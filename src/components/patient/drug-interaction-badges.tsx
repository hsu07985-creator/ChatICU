import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import { cn } from '../ui/utils';

export interface DrugInteraction {
  drug_a: string;
  drug_b: string;
  risk: string; // "A" | "B" | "C" | "D" | "X"
  title: string;
  severity?: string;
}

/**
 * Minimal subset of a patient medication used to label which side of a DDI
 * pair is the patient's actual drug vs the other rule partner. Accepts the
 * Medication shape from `src/lib/api/medications.ts` but only depends on the
 * fields we need for matching and display.
 */
export interface MedLookupEntry {
  name: string;
  genericName?: string | null;
  atcCode?: string | null;
}

export interface DrugInteractionBadgesProps {
  interactions: DrugInteraction[];
  hasRiskX?: boolean;
  /** Patient's active meds — used to surface brand names on matched sides. */
  activeMedications?: MedLookupEntry[];
}

interface MatchedSide {
  /** Text to display (patient's brand if matched, else rule's generic). */
  display: string;
  /** Rule's generic name — shown as secondary label when different. */
  aliasOfRuleName?: string;
  /** True when this side can be traced back to a patient med. */
  matched: boolean;
}

function firstWord(s: string): string {
  const m = s.trim().match(/^[A-Za-z一-鿿]+/);
  return (m?.[0] ?? '').toLowerCase();
}

function matchSide(
  ruleDrug: string,
  meds: MedLookupEntry[] | undefined,
): MatchedSide {
  if (!meds || meds.length === 0) {
    return { display: ruleDrug, matched: false };
  }
  const ruleLower = ruleDrug.trim().toLowerCase();
  const ruleFirst = firstWord(ruleDrug);

  // Tier 1: exact case-insensitive name or generic match → patient's brand wins
  for (const med of meds) {
    const n = (med.name || '').toLowerCase();
    const g = (med.genericName || '').toLowerCase();
    if (n === ruleLower || g === ruleLower) {
      return {
        display: med.name,
        aliasOfRuleName: ruleDrug,
        matched: true,
      };
    }
  }

  // Tier 2: substring — handles formulation suffixes ("Lansoprazole 30mg")
  for (const med of meds) {
    const n = (med.name || '').toLowerCase();
    const g = (med.genericName || '').toLowerCase();
    if ((n && n.includes(ruleLower)) || (g && g.includes(ruleLower))
        || (ruleLower && (ruleLower.includes(n) || ruleLower.includes(g)))) {
      return {
        display: med.name,
        aliasOfRuleName: ruleDrug,
        matched: true,
      };
    }
  }

  // Tier 3: first-word — catches "Clopidogrel" rule ↔ "Clopidogrel 75mg" med
  // (deliberately last; weaker evidence)
  for (const med of meds) {
    const nFirst = firstWord(med.name || '');
    const gFirst = firstWord(med.genericName || '');
    if (ruleFirst && (ruleFirst === nFirst || ruleFirst === gFirst)) {
      return {
        display: med.name,
        aliasOfRuleName: ruleDrug,
        matched: true,
      };
    }
  }

  return { display: ruleDrug, matched: false };
}

interface RiskConfig {
  label: string;
  badgeClass: string;
  borderClass: string;
}

const RISK_CONFIG: Record<string, RiskConfig> = {
  X: {
    label: '禁忌',
    badgeClass: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 border-red-300 dark:border-red-900',
    borderClass: 'border-red-300 dark:border-red-900',
  },
  D: {
    label: '重大',
    badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-400 border-orange-300 dark:border-orange-700',
    borderClass: 'border-orange-300 dark:border-orange-700',
  },
  C: {
    label: '監測',
    badgeClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700',
    borderClass: 'border-yellow-300 dark:border-yellow-700',
  },
  B: {
    label: '輕微',
    badgeClass: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400 border-blue-300 dark:border-blue-700',
    borderClass: 'border-blue-300 dark:border-blue-700',
  },
  A: {
    label: '無交互',
    badgeClass: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 border-green-300 dark:border-green-700',
    borderClass: 'border-green-300 dark:border-green-700',
  },
};

const RISK_ORDER: Record<string, number> = { X: 0, D: 1, C: 2, B: 3, A: 4 };

function getRiskConfig(risk: string): RiskConfig {
  return RISK_CONFIG[risk.toUpperCase()] ?? {
    label: risk,
    badgeClass: 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600',
    borderClass: 'border-gray-300 dark:border-gray-600',
  };
}

interface InteractionBadgeProps {
  interaction: DrugInteraction;
  activeMedications?: MedLookupEntry[];
}

/** Render one side of a pair — matched side bolded; unmatched dim + warning. */
function SideLabel({ side }: { side: MatchedSide }) {
  if (side.matched) {
    return (
      <span
        className="font-medium"
        title={
          side.aliasOfRuleName && side.aliasOfRuleName.toLowerCase() !== side.display.toLowerCase()
            ? `病人實際用藥：${side.display}（規則名：${side.aliasOfRuleName}）`
            : `病人實際用藥：${side.display}`
        }
      >
        {side.display}
      </span>
    );
  }
  return (
    <span
      className="italic opacity-70 inline-flex items-center gap-0.5"
      title={`此藥未在病人目前用藥清單中：${side.display}`}
    >
      <CircleAlert className="h-3 w-3 shrink-0" aria-hidden />
      {side.display}
    </span>
  );
}

function InteractionBadge({ interaction, activeMedications }: InteractionBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const riskUpper = interaction.risk.toUpperCase();
  const config = getRiskConfig(riskUpper);
  const isRiskX = riskUpper === 'X';

  const sideA = matchSide(interaction.drug_a, activeMedications);
  const sideB = matchSide(interaction.drug_b, activeMedications);

  if (isRiskX) {
    return (
      <div
        className={cn(
          'rounded-lg border-2 px-3 py-2 text-xs',
          'bg-red-50 dark:bg-red-950/30 border-red-400 dark:border-red-900 text-red-900 dark:text-red-400',
          'flex flex-col gap-1',
        )}
      >
        <div className="flex items-center gap-1.5 font-bold text-[13px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" />
          <span>X 禁忌</span>
          <span className="font-normal text-red-700 dark:text-red-400">
            <SideLabel side={sideA} />
            <span className="mx-1">↔</span>
            <SideLabel side={sideB} />
          </span>
        </div>
        <p className="text-red-800 dark:text-red-400 font-medium text-[11px]">
          禁忌組合 — 應避免合併使用
        </p>
        {interaction.title && (
          <p className="text-red-700 dark:text-red-400 text-[11px] leading-relaxed">{interaction.title}</p>
        )}
        {interaction.severity && (
          <p className="text-red-600 dark:text-red-400 text-xs">{interaction.severity}</p>
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
        <span className="opacity-80 font-normal inline-flex items-center gap-1">
          <SideLabel side={sideA} />
          <span>↔</span>
          <SideLabel side={sideB} />
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 ml-auto" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-auto" />
        )}
      </div>
      {expanded && (sideA.aliasOfRuleName || sideB.aliasOfRuleName) && (
        <p className="mt-1 text-[11px] opacity-80">
          規則名：{interaction.drug_a} + {interaction.drug_b}
        </p>
      )}
      {expanded && interaction.title && (
        <p className="mt-1 text-[11px] leading-relaxed opacity-90">{interaction.title}</p>
      )}
      {expanded && interaction.severity && (
        <p className="mt-0.5 text-xs opacity-75">{interaction.severity}</p>
      )}
    </button>
  );
}

export function DrugInteractionBadges({
  interactions,
  hasRiskX,
  activeMedications,
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
        <div className="flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>偵測到禁忌藥物組合</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((interaction, idx) => (
          <InteractionBadge
            key={`${interaction.drug_a}-${interaction.drug_b}-${idx}`}
            interaction={interaction}
            activeMedications={activeMedications}
          />
        ))}
      </div>
    </div>
  );
}
