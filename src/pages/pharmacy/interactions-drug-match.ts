// 藥物交互作用查詢的純輔助:型別、風險級設定、與病人用藥→DRUG_LIST 名稱比對。
// 從 interactions.tsx 抽出(D1 page-split,2026-07-20);純函式、可單元測試。
import { DRUG_LIST } from '../../lib/drug-list';

export interface InteractingMemberGroup {
  group_name: string;
  members: string[];
  exceptions: string[];
  exceptions_note: string;
}

export interface DisplayInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
  riskRating: string;
  riskRatingDescription: string;
  severityLabel: string;
  reliabilityRating: string;
  routeDependency: string;
  discussion: string;
  footnotes: string;
  dependencies: string[];
  dependencyTypes: string[];
  interactingMembers: InteractingMemberGroup[];
  pubmedIds: string[];
}

export const RISK_RATING_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  X: { label: 'Risk X 避免併用', color: 'text-red-900 dark:text-red-200', bgColor: 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700' },
  D: { label: 'Risk D 考慮調整', color: 'text-orange-900 dark:text-orange-200', bgColor: 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700' },
  C: { label: 'Risk C 監測治療', color: 'text-yellow-900 dark:text-yellow-200', bgColor: 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700' },
  B: { label: 'Risk B 不需處置', color: 'text-green-900 dark:text-green-200', bgColor: 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700' },
  A: { label: 'Risk A 無交互作用', color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-600' },
};

export const MIN_DRUGS = 2;

// Pre-compute alpha-only lowercase for Tall Man Lettering matching
const DRUG_LIST_ALPHA = DRUG_LIST.map(d => ({ original: d, alpha: d.replace(/[^a-zA-Z]/g, '').toLowerCase() }));

// Common brand→generic aliases not derivable from parentheses
const DRUG_ALIASES: Record<string, string> = {
  'l-thyroxine': 'Levothyroxine',
  'valproate': 'Valproic Acid and Derivatives',
  'valproic': 'Valproic Acid and Derivatives',
  'piperaci': 'Piperacillin',
  // ICU brand-name aliases
  'brilinta': 'Ticagrelor',
  'clexane': 'Enoxaparin',
  'combivent': 'Ipratropium (Oral Inhalation)',
};

function tryMatch(name: string): string | null {
  const lower = name.toLowerCase();
  // Exact
  const exact = DRUG_LIST.find(d => d.toLowerCase() === lower);
  if (exact) return exact;
  // Alpha-only (Tall Man Lettering)
  const alpha = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const found = DRUG_LIST_ALPHA.find(d => d.alpha === alpha);
  if (found) return found.original;
  // Alias lookup
  const alias = DRUG_ALIASES[lower];
  if (alias) {
    const aliasMatch = DRUG_LIST.find(d => d.toLowerCase() === alias.toLowerCase());
    if (aliasMatch) return aliasMatch;
  }
  // First word prefix (split on space, parens, comma, slash, hyphen-before-digit, plus)
  const firstWord = lower.split(/[\s(,/+]|(?<=[a-z])-(?=\d)/)[0].replace(/[^a-z]/g, '');
  if (firstWord.length >= 3) {
    const prefixMatch = DRUG_LIST_ALPHA.find(d => d.alpha.startsWith(firstWord));
    if (prefixMatch) return prefixMatch.original;
  }
  return null;
}

export function matchDrugName(medName: string): string | null {
  // Strip leading bracket tags like [抗血栓], [包], [公費/3價]
  const cleaned = medName.replace(/^\[.*?\]\s*/g, '').replace(/^(發泡錠|包)\s*/g, '');
  // 1-3. Try full name
  const direct = tryMatch(cleaned);
  if (direct) return direct;
  // 4. Extract ALL parenthesized groups, try last (most specific) first
  //    e.g. "SintRIX inj 1gm (抗3)(Ceftriaxone)" → ["抗3", "Ceftriaxone"]
  const allParens = [...cleaned.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim());
  for (let i = allParens.length - 1; i >= 0; i--) {
    const generic = allParens[i];
    // Skip non-drug markers like 抗3, 抗4, 軟袋
    if (/^[抗軟]/.test(generic) || /^\d/.test(generic) || /ml\)$/i.test(generic)) continue;
    // Handle semicolons: "Acetylsalicylic acid; Aspirin; ASA" → try each
    const candidates = generic.includes(';') ? generic.split(';').map(s => s.trim()) : [generic];
    for (const candidate of candidates) {
      const result = tryMatch(candidate);
      if (result) return result;
    }
  }
  return null;
}
