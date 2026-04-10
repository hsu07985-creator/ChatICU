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
  const order: Record<string, number> = { R: 0, I: 1, S: 2 };
  return [...items].sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3));
}

/** Q score badge color: Q3=good(teal), Q2=acceptable(amber), Q0-1=poor(rose) */
function qScoreBg(q: number): string {
  if (q >= 3) return 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-400 dark:border-teal-600';
  if (q === 2) return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-600';
  return 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-600';
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
      last.dates.push(panel.reportedAt ?? '');
      last.panels.push(panel);
    } else {
      result.push({
        organisms,
        dates: [panel.reportedAt ?? ''],
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

  const cardStyle = hasR
    ? 'border border-slate-200 dark:border-slate-700 border-l-[3px] border-l-rose-400 dark:border-l-rose-500 bg-white dark:bg-slate-900 shadow-sm'
    : 'border border-slate-200 dark:border-slate-700 border-l-[3px] border-l-teal-400 dark:border-l-teal-500 bg-white dark:bg-slate-900 shadow-sm';

  const headerStyle = 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60';

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
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 italic truncate">
          {merged.organisms.join(', ')}
        </span>

        {/* R / I / S count badges */}
        <span className="flex items-center gap-1.5 ml-auto shrink-0">
          {hasR && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold bg-rose-600 text-white">
              R {merged.resistantCount}
            </span>
          )}
          {hasI && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold bg-amber-500 text-white">
              I {merged.intermediateCount}
            </span>
          )}
          {merged.sensitiveCount > 0 && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-teal-600 text-white">
              S {merged.sensitiveCount}
            </span>
          )}
          {merged.qScore != null && (
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${qScoreBg(merged.qScore)}`}>
              Q{merged.qScore}
            </span>
          )}
        </span>

        {/* Date */}
        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium tabular-nums shrink-0">
          {merged.dates.map((d) => shortDate(d)).join(', ')}
        </span>
      </button>

      {/* ── Card Body (expanded) ── */}
      {open && (
        <div className={`border-t ${bodyBorder} px-3 py-2 space-y-1 text-[13px]`}>
          {/* Meta line: colonies */}
          {coloniesStr && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 pb-0.5">
              Colonies: {coloniesStr}
            </div>
          )}

          {/* R line */}
          {rItems.length > 0 && (
            <div className="flex gap-2 items-start">
              <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0 w-4">R</span>
              <span className="text-rose-800 dark:text-rose-300">{rItems.map((s) => s.antibiotic).join(', ')}</span>
            </div>
          )}
          {/* I line */}
          {iItems.length > 0 && (
            <div className="flex gap-2 items-start">
              <span className="font-semibold text-amber-600 dark:text-amber-400 shrink-0 w-4">I</span>
              <span className="text-amber-700 dark:text-amber-300">{iItems.map((s) => s.antibiotic).join(', ')}</span>
            </div>
          )}
          {/* S line */}
          {sItems.length > 0 && (
            <div className="flex gap-2 items-start">
              <span className="font-medium text-teal-600 dark:text-teal-400 shrink-0 w-4">S</span>
              <span className="text-teal-700 dark:text-teal-300">{sItems.map((s) => s.antibiotic).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const showNegative = !onlyPositive && !onlyResistant;
  const showFlora = !onlyPositive && !onlyResistant;
  const filteredPositive = onlyResistant
    ? group.positive.filter((p) => p.susceptibility.some((s) => s.result === 'R' || s.result === 'I'))
    : group.positive;
  const hasPositive = filteredPositive.length > 0;
  const merged = hasPositive ? mergeConsecutiveCultures(filteredPositive) : [];
  const posCount = filteredPositive.length;
  const negCount = showNegative ? group.negative.length : 0;
  const floraCount = showFlora ? group.normalFlora.length : 0;
  const total = posCount + negCount + floraCount;

  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      {/* ── Section Header (clickable) ── */}
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-center gap-2.5 transition-colors ${open ? 'border-b' : ''} ${
          hasPositive
            ? 'bg-gradient-to-r from-rose-50/30 to-white dark:from-rose-950/20 dark:to-slate-900 border-slate-200 dark:border-slate-700 hover:from-rose-50/50 dark:hover:from-rose-950/30'
            : 'bg-gradient-to-r from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900 border-slate-100 dark:border-slate-700 hover:from-slate-100/80 dark:hover:from-slate-800/70'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />}
        <Icon className={`h-4.5 w-4.5 shrink-0 ${hasPositive ? 'text-rose-400 dark:text-rose-500' : 'text-slate-400 dark:text-slate-500'}`} />
        <h4 className="text-base font-bold text-slate-700 dark:text-slate-200">{label}</h4>

        {/* Summary count badges */}
        <span className="flex items-center gap-2 ml-auto text-xs">
          {posCount > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 font-bold bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-600">
              陽性 {posCount}
            </span>
          )}
          {negCount > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
              陰性 {negCount}
            </span>
          )}
          {floraCount > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-400 border border-blue-200 dark:border-blue-700">
              正常菌 {floraCount}
            </span>
          )}
          {total === 0 && <span className="text-slate-300 dark:text-slate-600">0</span>}
        </span>
      </button>

      {/* ── Section Body ── */}
      {open && (
        <div className="px-3 py-2.5 space-y-2">
          {total === 0 ? (
            <p className="text-[13px] text-slate-300 dark:text-slate-600 py-2 text-center">
              {(onlyPositive || onlyResistant) ? '篩選條件下無結果' : '無培養資料'}
            </p>
          ) : (
            <>
              {merged.map((m, mIdx) => (
                <CultureCard key={mIdx} merged={m} defaultOpen={m.resistantCount > 0} forceOpen={forceOpen} />
              ))}
              {showFlora && group.normalFlora.length > 0 && groupByQScore(group.normalFlora).map(([qLabel, panels]) => (
                <div key={`flora-${qLabel}`} className="text-[13px] text-blue-700 dark:text-blue-300 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                  <span className="font-semibold italic">Normal flora</span>
                  {qLabel && (
                    <span className={`inline-flex items-center rounded border px-1 text-[10px] font-bold leading-tight ${qScoreBg(parseInt(qLabel.slice(1)))}`}>
                      {qLabel}
                    </span>
                  )}
                  <span className="text-blue-400 dark:text-blue-500">
                    {panels.map((p) => shortDate(p.reportedAt)).join(', ')}
                  </span>
                </div>
              ))}
              {showNegative && group.negative.length > 0 && groupByQScore(group.negative).map(([qLabel, panels]) => (
                <div key={`neg-${qLabel}`} className="text-[13px] text-teal-700 dark:text-teal-300 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                  <span className="font-semibold">Negative</span>
                  {qLabel && (
                    <span className={`inline-flex items-center rounded border px-1 text-[10px] font-bold leading-tight ${qScoreBg(parseInt(qLabel.slice(1)))}`}>
                      {qLabel}
                    </span>
                  )}
                  <span className="text-teal-400 dark:text-teal-500">
                    {panels.map((p) => shortDate(p.reportedAt)).join(', ')}
                  </span>
                </div>
              ))}
              {group.category === 'other' && total > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {[...new Set([
                    ...filteredPositive,
                    ...(showFlora ? group.normalFlora : []),
                    ...(showNegative ? group.negative : []),
                  ].map((p) => p.specimen))].map((s) => (
                    <span key={s} className="text-[11px] text-slate-400 dark:text-slate-500">{s}</span>
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
