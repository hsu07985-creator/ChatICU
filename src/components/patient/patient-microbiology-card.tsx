import { useEffect, useMemo, useState, useCallback } from 'react';
import { Wind, Droplets, FlaskConical, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { getCultureSusceptibility } from '../../lib/api/microbiology';
import type { CulturePanel, CultureSusceptibilityData, SusceptibilityResult } from '../../lib/api/microbiology';
import { LoadingSpinner } from '../ui/state-display';
import type { LucideIcon } from 'lucide-react';

/* ── helpers ─────────────────────────────────────────────── */

function isNormalFlora(panel: CulturePanel): boolean {
  if (panel.result && /normal\s*(oral\s*)?flora/i.test(panel.result)) return true;
  return panel.isolates.some((i) => /normal\s*(oral\s*)?flora/i.test(i.organism));
}

function isPositiveCulture(panel: CulturePanel): boolean {
  if (isNormalFlora(panel)) return false;
  return panel.isolates.some(
    (i) =>
      i.organism !== 'Negative' &&
      !i.organism.startsWith('No growth') &&
      !i.organism.startsWith('No salmonella') &&
      !/normal\s*(oral\s*)?flora/i.test(i.organism),
  );
}

function shortDate(dateStr: string | null) {
  if (!dateStr) return '—';
  const parts = dateStr.slice(5, 10).split('-');
  return `${parts[0]}/${parts[1]}`;
}

function sortSusceptibility(items: SusceptibilityResult[]): SusceptibilityResult[] {
  const order: Record<string, number> = { S: 0, I: 1, R: 2 };
  return [...items].sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3));
}

/** Q score badge: subtle grayscale — secondary info, shouldn't compete with S/I/R */
function qScoreBg(_q: number): string {
  return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
}

/** Group panels by Q score (descending). Returns [label, panels][] — single group with '' key if no Q scores */
function groupByQScore(panels: CulturePanel[]): [string, CulturePanel[]][] {
  const hasQ = panels.some((p) => p.qScore != null);
  if (!hasQ) return [['', panels]];
  const byQ = new Map<string, CulturePanel[]>();
  for (const p of panels) {
    const key = p.qScore != null ? `Q${p.qScore}` : '';
    if (!byQ.has(key)) byQ.set(key, []);
    byQ.get(key)!.push(p);
  }
  return [...byQ.entries()].sort((a, b) => {
    const aNum = a[0] ? parseInt(a[0].slice(1)) : -1;
    const bNum = b[0] ? parseInt(b[0].slice(1)) : -1;
    return bNum - aNum;
  });
}

/* ── Merged culture type ─────────────────────────────────── */

interface MergedCulture {
  organisms: string[];
  dates: string[];
  panels: CulturePanel[];
  resistantCount: number;
  intermediateCount: number;
  sensitiveCount: number;
  bestSusceptibility: SusceptibilityResult[];
  coloniesMap: Record<string, string>;
  qScore?: number | null;
}

function mergeConsecutiveCultures(panels: CulturePanel[]): MergedCulture[] {
  const result: MergedCulture[] = [];

  for (const panel of panels) {
    const organisms = panel.isolates
      .map((i) => i.organism)
      .filter((o) => o !== 'Negative' && !o.startsWith('No growth') && !o.startsWith('No salmonella') && !/normal\s*(oral\s*)?flora/i.test(o))
      .sort();
    const key = organisms.join('|');
    const rCount = panel.susceptibility.filter((s) => s.result === 'R').length;
    const iCount = panel.susceptibility.filter((s) => s.result === 'I').length;
    const sCount = panel.susceptibility.filter((s) => s.result === 'S').length;

    const coloniesMap: Record<string, string> = {};
    for (const iso of panel.isolates) {
      if (iso.colonies) coloniesMap[iso.organism] = iso.colonies;
    }

    const last = result[result.length - 1];
    const lastKey = last?.organisms.sort().join('|');
    const sameSusceptibilityPattern = last && last.bestSusceptibility.length === panel.susceptibility.length &&
      last.bestSusceptibility.every((s, i) => {
        const sorted = sortSusceptibility(panel.susceptibility);
        return sorted[i] && s.antibiotic === sorted[i].antibiotic && s.result === sorted[i].result;
      });

    if (last && lastKey === key && sameSusceptibilityPattern) {
      last.dates.push(panel.collectedAt ?? panel.reportedAt ?? '');
      last.panels.push(panel);
    } else {
      result.push({
        organisms,
        dates: [panel.collectedAt ?? panel.reportedAt ?? ''],
        panels: [panel],
        resistantCount: rCount,
        intermediateCount: iCount,
        sensitiveCount: sCount,
        bestSusceptibility: sortSusceptibility(panel.susceptibility),
        coloniesMap,
        qScore: panel.qScore,
      });
    }
  }

  return result;
}

/* ── Collapsible Culture Card ────────────────────────────── */

function CultureCard({ merged, defaultOpen, forceOpen }: { merged: MergedCulture; defaultOpen?: boolean; forceOpen?: boolean | null }) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  // Respond to global expand/collapse toggle
  useEffect(() => {
    if (forceOpen !== null && forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);
  const hasR = merged.resistantCount > 0;
  const hasI = merged.intermediateCount > 0;

  const rItems = merged.bestSusceptibility.filter((s) => s.result === 'R');
  const iItems = merged.bestSusceptibility.filter((s) => s.result === 'I');
  const sItems = merged.bestSusceptibility.filter((s) => s.result === 'S');

  const borderAccent = hasR
    ? 'border-l-2 border-l-rose-300 dark:border-l-rose-800'
    : hasI
      ? 'border-l-2 border-l-amber-300 dark:border-l-amber-800'
      : '';
  const cardStyle = `border border-slate-200 dark:border-slate-700 ${borderAccent} bg-white dark:bg-slate-900`;

  const headerStyle = 'hover:bg-slate-50 dark:hover:bg-slate-800/60';

  const bodyBorder = 'border-slate-100 dark:border-slate-800';

  const coloniesStr = merged.organisms
    .map((o) => merged.coloniesMap[o])
    .filter(Boolean)
    .map((c) => { const lc = c.toLowerCase(); return lc === 'heavy' ? 'Heavy' : lc === 'moderate' ? 'Mod' : c; })
    .join(', ');

  return (
    <div className={`rounded-lg ${cardStyle} overflow-hidden`}>
      {/* ── Card Header (always visible, clickable) ── */}
      <button
        type="button"
        className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${headerStyle}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />}

        {/* Organism name */}
        <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100 italic truncate">
          {merged.organisms.join(', ')}
        </span>

        {/* S / I / R count badges */}
        <span className="flex items-center gap-1 shrink-0">
          {merged.sensitiveCount > 0 && (
            <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800">
              S {merged.sensitiveCount}
            </span>
          )}
          {hasI && (
            <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
              I {merged.intermediateCount}
            </span>
          )}
          {hasR && (
            <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800">
              R {merged.resistantCount}
            </span>
          )}
          {merged.qScore != null && (
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${qScoreBg(merged.qScore)}`}>
              Q{merged.qScore}
            </span>
          )}
        </span>

        {/* Date */}
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0 border-l border-slate-200 dark:border-slate-700 pl-2">
          {merged.dates.map((d) => shortDate(d)).join(', ')}
        </span>
      </button>

      {/* ── Card Body (expanded) ── */}
      {open && (
        <div className={`border-t ${bodyBorder} px-3 py-2.5 space-y-2 text-sm`}>
          {/* Meta line: colonies */}
          {coloniesStr && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Colonies: {coloniesStr}
            </div>
          )}

          {/* S chips */}
          {sItems.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sItems.map((s) => (
                <span key={s.antibiotic} className="inline-flex items-center rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                  {s.antibiotic}
                </span>
              ))}
            </div>
          )}
          {/* I chips */}
          {iItems.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {iItems.map((s) => (
                <span key={s.antibiotic} className="inline-flex items-center rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {s.antibiotic}
                </span>
              ))}
            </div>
          )}
          {/* R chips */}
          {rItems.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rItems.map((s) => (
                <span key={s.antibiotic} className="inline-flex items-center rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                  {s.antibiotic}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Chronological timeline item ─────────────────────────── */

type ChronoItem =
  | { kind: 'card'; merged: MergedCulture }
  | { kind: 'flora'; panel: CulturePanel }
  | { kind: 'negative'; panel: CulturePanel };

/** Build a single chronological list from all panels in a category. */
function buildChronologicalList(
  group: CategoryGroup,
  onlyPositive: boolean,
  onlyResistant: boolean,
): ChronoItem[] {
  const showAll = !onlyPositive && !onlyResistant;
  const filteredPositive = onlyResistant
    ? group.positive.filter((p) => p.susceptibility.some((s) => s.result === 'R' || s.result === 'I'))
    : group.positive;

  // Tag every panel with its type
  const tagged: { panel: CulturePanel; ptype: 'positive' | 'flora' | 'negative' }[] = [];
  for (const p of filteredPositive) tagged.push({ panel: p, ptype: 'positive' });
  if (showAll) {
    for (const p of group.normalFlora) tagged.push({ panel: p, ptype: 'flora' });
    for (const p of group.negative) tagged.push({ panel: p, ptype: 'negative' });
  }

  // Sort by collectedAt descending (newest first)
  tagged.sort((a, b) => {
    const dateA = a.panel.collectedAt ?? a.panel.reportedAt ?? '';
    const dateB = b.panel.collectedAt ?? b.panel.reportedAt ?? '';
    return dateB.localeCompare(dateA);
  });

  // Walk in order: merge consecutive positives with same organisms+susceptibility
  const items: ChronoItem[] = [];
  let pendingPositive: CulturePanel[] = [];

  const flushPositive = () => {
    if (pendingPositive.length === 0) return;
    for (const m of mergeConsecutiveCultures(pendingPositive)) {
      items.push({ kind: 'card', merged: m });
    }
    pendingPositive = [];
  };

  for (const { panel, ptype } of tagged) {
    if (ptype === 'positive') {
      pendingPositive.push(panel);
    } else {
      flushPositive();
      items.push({ kind: ptype, panel });
    }
  }
  flushPositive();

  return items;
}

/* ── Collapsible Specimen Category Section ────────────────── */

function CategorySection({
  label, Icon, group, onlyPositive, onlyResistant, forceOpen,
}: {
  label: string;
  Icon: LucideIcon;
  group: CategoryGroup;
  onlyPositive: boolean;
  onlyResistant: boolean;
  forceOpen?: boolean | null;
}) {
  const showAll = !onlyPositive && !onlyResistant;
  const filteredPositive = onlyResistant
    ? group.positive.filter((p) => p.susceptibility.some((s) => s.result === 'R' || s.result === 'I'))
    : group.positive;
  const hasPositive = filteredPositive.length > 0;
  const posCount = filteredPositive.length;
  const negCount = showAll ? group.negative.length : 0;
  const floraCount = showAll ? group.normalFlora.length : 0;
  const total = posCount + negCount + floraCount;

  const chronoItems = useMemo(
    () => buildChronologicalList(group, onlyPositive, onlyResistant),
    [group, onlyPositive, onlyResistant],
  );

  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* ── Section Header (clickable) ── */}
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-center gap-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
          open ? 'border-b border-slate-200 dark:border-slate-700' : ''
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />}
        <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        <h4 className="text-base font-semibold text-slate-800 dark:text-slate-100">{label}</h4>

        {/* Summary count: 陽性 as pill, others as inline muted text */}
        <span className="flex items-center gap-2 ml-auto text-xs">
          {posCount > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
              陽性 {posCount}
            </span>
          )}
          {(negCount > 0 || floraCount > 0) && (
            <span className="text-slate-500 dark:text-slate-400">
              {[
                negCount > 0 ? `陰性 ${negCount}` : null,
                floraCount > 0 ? `正常菌 ${floraCount}` : null,
              ].filter(Boolean).join(' · ')}
            </span>
          )}
          {total === 0 && <span className="text-slate-300 dark:text-slate-600">0</span>}
        </span>
      </button>

      {/* ── Section Body (chronological) ── */}
      {open && (
        <div className="px-3 py-2.5 space-y-2">
          {total === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-2 text-center">
              {(onlyPositive || onlyResistant) ? '篩選條件下無結果' : '無培養資料'}
            </p>
          ) : (
            <>
              {chronoItems.map((item, idx) => {
                if (item.kind === 'card') {
                  return <CultureCard key={idx} merged={item.merged} defaultOpen={item.merged.resistantCount > 0} forceOpen={forceOpen} />;
                }
                if (item.kind === 'flora') {
                  const p = item.panel;
                  return (
                    <div key={idx} className="text-sm text-slate-600 dark:text-slate-300 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                      <span className="font-medium italic">Normal flora</span>
                      {p.qScore != null && (
                        <span className={`inline-flex items-center rounded border px-1 text-xs font-medium leading-tight ${qScoreBg(p.qScore)}`}>
                          Q{p.qScore}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 tabular-nums">{shortDate(p.collectedAt ?? p.reportedAt)}</span>
                    </div>
                  );
                }
                // negative
                const p = item.panel;
                return (
                  <div key={idx} className="text-sm text-slate-600 dark:text-slate-300 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                    <span className="font-medium">Negative</span>
                    {p.qScore != null && (
                      <span className={`inline-flex items-center rounded border px-1 text-xs font-medium leading-tight ${qScoreBg(p.qScore)}`}>
                        Q{p.qScore}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 tabular-nums">{shortDate(p.collectedAt ?? p.reportedAt)}</span>
                  </div>
                );
              })}
              {group.category === 'other' && total > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {[...new Set([
                    ...filteredPositive,
                    ...(showAll ? group.normalFlora : []),
                    ...(showAll ? group.negative : []),
                  ].map((p) => p.specimen))].map((s) => (
                    <span key={s} className="text-xs text-slate-400 dark:text-slate-500">{s}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 4-Category Specimen Grouping ───────────────────────── */

type SpecimenCategory = 'sputum' | 'urine' | 'blood' | 'other';

const CATEGORY_META: Record<SpecimenCategory, { label: string; Icon: LucideIcon }> = {
  sputum: { label: '痰 Sputum', Icon: Wind },
  urine:  { label: '尿 Urine',  Icon: FlaskConical },
  blood:  { label: '血液 Blood', Icon: Droplets },
  other:  { label: '其他 Other', Icon: FileText },
};

const CATEGORY_ORDER: SpecimenCategory[] = ['sputum', 'urine', 'blood', 'other'];

function classifySpecimen(specimen: string): SpecimenCategory {
  const s = specimen.toLowerCase();
  if (s.includes('sputum') || s.includes('痰')) return 'sputum';
  if (s.includes('urine') || s.includes('尿')) return 'urine';
  if (s.includes('blood') || s.includes('血')) return 'blood';
  return 'other';
}

interface CategoryGroup {
  category: SpecimenCategory;
  positive: CulturePanel[];
  normalFlora: CulturePanel[];
  negative: CulturePanel[];
}

function groupByCategory(panels: CulturePanel[]): CategoryGroup[] {
  const map: Record<SpecimenCategory, CategoryGroup> = {
    sputum: { category: 'sputum', positive: [], normalFlora: [], negative: [] },
    urine:  { category: 'urine',  positive: [], normalFlora: [], negative: [] },
    blood:  { category: 'blood',  positive: [], normalFlora: [], negative: [] },
    other:  { category: 'other',  positive: [], normalFlora: [], negative: [] },
  };
  for (const p of panels) {
    const cat = classifySpecimen(p.specimen || 'Unknown');
    if (isNormalFlora(p)) {
      map[cat].normalFlora.push(p);
    } else if (isPositiveCulture(p)) {
      map[cat].positive.push(p);
    } else {
      map[cat].negative.push(p);
    }
  }
  return CATEGORY_ORDER.map((c) => map[c]);
}

/* ── Main Component ──────────────────────────────────────── */

interface PatientMicrobiologyCardProps {
  patientId: string;
}

export function PatientMicrobiologyCard({ patientId }: PatientMicrobiologyCardProps) {
  const [data, setData] = useState<CultureSusceptibilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCultureSusceptibility(patientId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  const cultures = data?.cultures ?? [];
  const categoryGroups = useMemo(() => groupByCategory(cultures), [cultures]);
  const [onlyPositive, setOnlyPositive] = useState(false);
  const [onlyResistant, setOnlyResistant] = useState(false);

  /* global expand / collapse all culture cards */
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const toggleExpandAll = useCallback(() => {
    setExpandAll((prev) => (prev === true ? false : true));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" text="Loading..." />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400 py-4">{error}</p>;
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          className={`rounded-md border px-2.5 py-1 text-sm font-medium transition-colors ${
            onlyPositive
              ? 'border-brand bg-brand text-white'
              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-brand/40 dark:hover:border-brand/50'
          }`}
          aria-pressed={onlyPositive}
          onClick={() => setOnlyPositive((prev) => !prev)}
        >
          只看陽性
        </button>
        <button
          type="button"
          className={`rounded-md border px-2.5 py-1 text-sm font-medium transition-colors ${
            onlyResistant
              ? 'border-brand bg-brand text-white'
              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-brand/40 dark:hover:border-brand/50'
          }`}
          aria-pressed={onlyResistant}
          onClick={() => setOnlyResistant((prev) => !prev)}
        >
          只看抗藥
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-brand/40 dark:hover:border-brand/50 transition-colors ml-auto"
          onClick={toggleExpandAll}
        >
          {expandAll ? '全部收合' : '全部展開'}
        </button>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {categoryGroups.map((group) => {
          const meta = CATEGORY_META[group.category];
          return (
            <CategorySection
              key={group.category}
              label={meta.label}
              Icon={meta.Icon}
              group={group}
              onlyPositive={onlyPositive}
              onlyResistant={onlyResistant}
              forceOpen={expandAll}
            />
          );
        })}
      </div>
    </div>
  );
}
