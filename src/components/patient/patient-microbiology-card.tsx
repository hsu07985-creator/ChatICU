import { useEffect, useMemo, useState } from 'react';
import { Check, Wind, Droplets, FlaskConical, FileText } from 'lucide-react';
import { getCultureSusceptibility } from '../../lib/api/microbiology';
import type { CulturePanel, CultureSusceptibilityData, SusceptibilityResult } from '../../lib/api/microbiology';
import { LoadingSpinner } from '../ui/state-display';
import type { LucideIcon } from 'lucide-react';

/* ── helpers ─────────────────────────────────────────────── */

function resultColor(result: string) {
  if (result === 'R') return 'bg-red-100 text-red-800 border-red-300 font-bold';
  if (result === 'I') return 'bg-amber-100 text-amber-800 border-amber-300 font-semibold';
  if (result === 'S') return 'bg-green-50 text-green-700 border-green-200';
  return 'bg-slate-50 text-slate-400 border-slate-200';
}

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


/* ── Susceptibility Pills ──────────────────────────────── */

function SusceptibilityPills({ items }: { items: SusceptibilityResult[] }) {
  const sorted = sortSusceptibility(items);
  const [expanded, setExpanded] = useState(false);

  const riPills = sorted.filter((s) => s.result === 'R' || s.result === 'I');
  const sPills = sorted.filter((s) => s.result === 'S');
  const shouldCollapse = sPills.length > 4;
  const showAll = expanded || !shouldCollapse;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {riPills.map((s, idx) => (
        <span
          key={`ri-${idx}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs leading-none ${resultColor(s.result)}`}
        >
          <span>{s.result}</span>
          <span>{s.antibiotic}</span>
        </span>
      ))}
      {showAll && sPills.map((s, idx) => (
        <span
          key={`s-${idx}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs leading-none ${resultColor(s.result)}`}
        >
          <span>{s.result}</span>
          <span>{s.antibiotic}</span>
        </span>
      ))}
      {shouldCollapse && !expanded && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-500 transition-colors hover:bg-slate-100"
          onClick={() => setExpanded(true)}
        >
          +{sPills.length} S
        </button>
      )}
      {shouldCollapse && expanded && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium leading-none text-slate-500 transition-colors hover:bg-slate-100"
          onClick={() => setExpanded(false)}
        >
          收合
        </button>
      )}
    </div>
  );
}

/* ── Q Score Badge ─────────────────────────────────────── */

function QScoreBadge({ score }: { score: number }) {
  const color = score <= 1
    ? 'bg-green-50 text-green-700 border-green-200'
    : score === 2
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      Q {score}
    </span>
  );
}

function ColoniesBadge({ colonies }: { colonies: string }) {
  const color = colonies.toLowerCase() === 'heavy'
    ? 'bg-red-50 text-red-600 border-red-200'
    : colonies.toLowerCase() === 'moderate'
      ? 'bg-amber-50 text-amber-600 border-amber-200'
      : 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {colonies}
    </span>
  );
}

/* ── Merged positive row ───────────────────────────────── */

interface MergedCulture {
  organisms: string[];
  dates: string[];
  panels: CulturePanel[];
  resistantCount: number;
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

    // Build colonies map from isolates
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
        bestSusceptibility: sortSusceptibility(panel.susceptibility),
        coloniesMap,
        qScore: panel.qScore,
      });
    }
  }

  return result;
}

function MergedCultureRow({ merged }: { merged: MergedCulture }) {
  const hasResistance = merged.resistantCount > 0;
  const borderAccent = hasResistance
    ? 'border-l-red-400 bg-red-50/30'
    : 'border-l-emerald-400 bg-white';

  return (
    <div
      className={`rounded-lg border border-slate-200 border-l-[3px] ${borderAccent} px-4 py-3`}
      title={merged.panels.map((p) => `${p.sheetNumber} · ${p.department || ''}`).join('\n')}
    >
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-xs text-slate-400 font-medium tabular-nums shrink-0">
          {merged.dates.map((d) => shortDate(d)).join(', ')}
        </span>
        {merged.qScore != null && <QScoreBadge score={merged.qScore} />}
        <div className="flex flex-wrap gap-x-2 items-baseline">
          {merged.organisms.map((org, idx) => (
            <span key={idx} className="inline-flex items-baseline gap-1">
              <span className="text-sm font-semibold leading-snug text-slate-800 italic">
                {org}{idx < merged.organisms.length - 1 ? ',' : ''}
              </span>
              {merged.coloniesMap[org] && <ColoniesBadge colonies={merged.coloniesMap[org]} />}
            </span>
          ))}
        </div>
      </div>
      {merged.bestSusceptibility.length > 0 && <SusceptibilityPills items={merged.bestSusceptibility} />}
    </div>
  );
}

/* ── Negative Results (always visible) ──────────────────── */

function NegativeRows({ panels }: { panels: CulturePanel[] }) {
  if (panels.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {panels.map((p, idx) => (
        <div key={idx} className="rounded-lg border border-green-100 bg-green-50/50 px-4 py-2 flex items-center gap-2.5 flex-wrap">
          <span className="text-xs text-slate-500 font-medium tabular-nums">{shortDate(p.reportedAt)}</span>
          {p.qScore != null && <QScoreBadge score={p.qScore} />}
          <Check className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs text-green-600 font-medium">
            {p.result || 'No growth'}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Normal Flora Rows ─────────────────────────────────── */

function NormalFloraRows({ panels }: { panels: CulturePanel[] }) {
  if (panels.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {panels.map((p, idx) => (
        <div key={idx} className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2 flex items-center gap-2.5 flex-wrap">
          <span className="text-xs text-slate-500 font-medium tabular-nums">{shortDate(p.reportedAt)}</span>
          {p.qScore != null && <QScoreBadge score={p.qScore} />}
          <span className="text-xs text-blue-600 font-medium italic">Normal flora</span>
        </div>
      ))}
    </div>
  );
}

/* ── Section Card & Label ──────────────────────────────── */

function MicroSectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ label, count, hasPositive, Icon }: { label: string; count: number; hasPositive?: boolean; Icon: LucideIcon }) {
  const borderColor = hasPositive ? 'border-red-400' : 'border-slate-300';
  return (
    <div className={`flex items-center gap-2 border-l-[3px] ${borderColor} pl-2.5 mb-3`}>
      <Icon className="h-4 w-4 text-slate-500 shrink-0" />
      <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-700">{label}</h4>
      <span className="text-xs text-slate-400 font-medium">{count}</span>
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
  if (s.includes('bile') || s.includes('膽')) return 'other';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" text="Loading..." />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 py-4">{error}</p>;
  }

  return (
    <div className="space-y-3">
      {/* 篩選按鈕 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              onlyPositive
                ? 'border-brand bg-brand text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-brand/40'
            }`}
            aria-pressed={onlyPositive}
            onClick={() => setOnlyPositive((prev) => !prev)}
          >
            只看陽性
          </button>
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              onlyResistant
                ? 'border-brand bg-brand text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-brand/40'
            }`}
            aria-pressed={onlyResistant}
            onClick={() => setOnlyResistant((prev) => !prev)}
          >
            只看抗藥
          </button>
        </div>
        <span className="text-xs text-slate-500">高效率篩選</span>
      </div>

      {/* 2x2 Grid: all 4 categories always shown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {categoryGroups.map((group) => {
          const meta = CATEGORY_META[group.category];
          const showNegative = !onlyPositive && !onlyResistant;
          const showFlora = !onlyPositive && !onlyResistant;
          const filteredPositive = onlyResistant
            ? group.positive.filter((p) => p.susceptibility.some((s) => s.result === 'R' || s.result === 'I'))
            : group.positive;
          const hasPositive = filteredPositive.length > 0;
          const merged = hasPositive ? mergeConsecutiveCultures(filteredPositive) : [];
          const total = filteredPositive.length
            + (showFlora ? group.normalFlora.length : 0)
            + (showNegative ? group.negative.length : 0);

          return (
            <MicroSectionCard key={group.category}>
              <SectionLabel
                label={meta.label}
                count={total}
                hasPositive={hasPositive}
                Icon={meta.Icon}
              />

              {total === 0 ? (
                <p className="text-sm text-slate-300 py-4 text-center">
                  {(onlyPositive || onlyResistant) ? '篩選條件下無結果' : '無培養資料'}
                </p>
              ) : (
                <div className="space-y-2">
                  {merged.map((m, mIdx) => (
                    <MergedCultureRow key={mIdx} merged={m} />
                  ))}
                  {showFlora && <NormalFloraRows panels={group.normalFlora} />}
                  {showNegative && <NegativeRows panels={group.negative} />}

                  {group.category === 'other' && total > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {[...new Set([
                        ...filteredPositive,
                        ...(showFlora ? group.normalFlora : []),
                        ...(showNegative ? group.negative : []),
                      ].map((p) => p.specimen))].map((s) => (
                        <span key={s} className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </MicroSectionCard>
          );
        })}
      </div>
    </div>
  );
}
