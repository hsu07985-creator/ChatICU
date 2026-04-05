import { useEffect, useMemo, useState } from 'react';
import { Bug, Calendar } from 'lucide-react';
import { getCultureSusceptibility } from '../../lib/api/microbiology';
import type { CulturePanel, CultureSusceptibilityData, SusceptibilityResult } from '../../lib/api/microbiology';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { LoadingSpinner } from '../ui/state-display';

/* ── helpers ─────────────────────────────────────────────── */

function resultColor(result: string) {
  if (result === 'R') return 'bg-red-100 text-red-800 border-red-300';
  if (result === 'I') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  if (result === 'S') return 'bg-green-100 text-green-800 border-green-300';
  return 'bg-gray-100 text-gray-800 border-gray-200';
}

function isPositiveCulture(panel: CulturePanel): boolean {
  return panel.isolates.some(
    (i) =>
      i.organism !== 'Negative' &&
      !i.organism.startsWith('No growth') &&
      !i.organism.startsWith('No salmonella'),
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return dateStr.slice(0, 10);
}

function shortDate(dateStr: string | null) {
  if (!dateStr) return '—';
  // "2025-10-31" → "10/31"
  const parts = dateStr.slice(5, 10).split('-');
  return `${parts[0]}/${parts[1]}`;
}

function sortSusceptibility(items: SusceptibilityResult[]): SusceptibilityResult[] {
  const order: Record<string, number> = { R: 0, I: 1, S: 2 };
  return [...items].sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3));
}

interface OrganismSummary {
  organism: string;
  specimens: string[];
  latestDate: string;
  resistantCount: number;
}

function buildOrganismSummaries(panels: CulturePanel[]): OrganismSummary[] {
  const map = new Map<string, OrganismSummary>();
  for (const p of panels) {
    if (!isPositiveCulture(p)) continue;
    for (const iso of p.isolates) {
      if (iso.organism === 'Negative' || iso.organism.startsWith('No growth') || iso.organism.startsWith('No salmonella')) continue;
      const existing = map.get(iso.organism);
      const date = p.reportedAt ?? '';
      const rCount = p.susceptibility.filter((s) => s.result === 'R').length;
      if (!existing) {
        map.set(iso.organism, {
          organism: iso.organism,
          specimens: [p.specimen],
          latestDate: date,
          resistantCount: rCount,
        });
      } else {
        if (!existing.specimens.includes(p.specimen)) existing.specimens.push(p.specimen);
        if (date > existing.latestDate) existing.latestDate = date;
        existing.resistantCount = Math.max(existing.resistantCount, rCount);
      }
    }
  }
  return Array.from(map.values());
}

/* ── Organism Summary Banner (#4: only show if multi-specimen positive) */

function OrganismBanner({ summaries, specimenCount }: { summaries: OrganismSummary[]; specimenCount: number }) {
  if (summaries.length === 0 || specimenCount < 2) return null;
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 mb-3">
      <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-1.5">Isolated Organisms</p>
      <div className="flex flex-wrap gap-1.5">
        {summaries.map((s) => (
          <span
            key={s.organism}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-white px-2 py-1 text-xs"
          >
            <span className="font-medium text-slate-800 italic">{s.organism}</span>
            <span className="text-xs text-slate-400">{s.specimens.join(', ')}</span>
            <span className="text-xs text-slate-400">{formatDate(s.latestDate)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Susceptibility Pills with smart collapse ─────────────── */

function SusceptibilityPills({ items }: { items: SusceptibilityResult[] }) {
  const sorted = sortSusceptibility(items);
  const [expanded, setExpanded] = useState(false);

  const riPills = sorted.filter((s) => s.result === 'R' || s.result === 'I');
  const sPills = sorted.filter((s) => s.result === 'S');
  const shouldCollapse = sPills.length > 3;
  const showAll = expanded || !shouldCollapse;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {riPills.map((s, idx) => (
        <span
          key={`ri-${idx}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${resultColor(s.result)}`}
        >
          <span className="font-bold">{s.result}</span>
          <span>{s.antibiotic}</span>
        </span>
      ))}
      {showAll && sPills.map((s, idx) => (
        <span
          key={`s-${idx}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${resultColor(s.result)}`}
        >
          <span className="font-bold">{s.result}</span>
          <span>{s.antibiotic}</span>
        </span>
      ))}
      {shouldCollapse && !expanded && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium leading-none text-green-700 transition-colors hover:bg-green-100"
          onClick={() => setExpanded(true)}
        >
          +{sPills.length} S
        </button>
      )}
      {shouldCollapse && expanded && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium leading-none text-slate-400 transition-colors hover:bg-slate-100"
          onClick={() => setExpanded(false)}
        >
          收合
        </button>
      )}
    </div>
  );
}

/* ── Merged positive row (#1: same organism consecutive → merge dates) */

interface MergedCulture {
  organisms: string[];
  dates: string[];
  panels: CulturePanel[];
  resistantCount: number;
  bestSusceptibility: SusceptibilityResult[];
}

function mergeConsecutiveCultures(panels: CulturePanel[]): MergedCulture[] {
  const result: MergedCulture[] = [];

  for (const panel of panels) {
    const organisms = panel.isolates
      .map((i) => i.organism)
      .filter((o) => o !== 'Negative' && !o.startsWith('No growth') && !o.startsWith('No salmonella'))
      .sort();
    const key = organisms.join('|');
    const rCount = panel.susceptibility.filter((s) => s.result === 'R').length;

    // Try to merge with the last group if same organisms and same susceptibility pattern
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
      });
    }
  }

  return result;
}

function MergedCultureRow({ merged }: { merged: MergedCulture }) {
  const hasResistance = merged.resistantCount > 0;

  return (
    <div
      className={`rounded-lg border bg-white px-3.5 py-3 ${
        hasResistance
          ? 'border-l-[3px] border-l-red-400 border-t-red-100 border-r-red-100 border-b-red-100 bg-red-50/40'
          : 'border-slate-200'
      }`}
      title={merged.panels.map((p) => `${p.sheetNumber} · ${p.department || ''}`).join('\n')}
    >
      {/* Line 1: dates + organisms + R badge */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-slate-400 tabular-nums">
            {merged.dates.map((d) => shortDate(d)).join(', ')}
          </span>
          {merged.dates.length > 1 && (
            <span className="text-xs text-slate-300">×{merged.dates.length}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {merged.organisms.map((org, idx) => (
            <span key={idx} className="text-sm font-semibold leading-snug text-slate-800 italic">
              {org}{idx < merged.organisms.length - 1 ? ',' : ''}
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
    <div className="space-y-1">
      {panels.map((p, idx) => (
        <div key={idx} className="rounded-lg border border-green-100 bg-green-50/40 px-3.5 py-2 flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">{shortDate(p.reportedAt)}</span>
          <span className="text-xs text-green-600 font-medium">No growth</span>
        </div>
      ))}
    </div>
  );
}

/* ── Section Card ────────────────────────────────────────── */

function MicroSectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ label, count, hasPositive }: { label: string; count: number; hasPositive?: boolean }) {
  const borderColor = hasPositive ? 'border-orange-400' : 'border-slate-300';
  const textColor = hasPositive ? 'text-orange-700' : 'text-slate-500';
  return (
    <div className={`flex items-center gap-2 border-l-[3px] ${borderColor} pl-2 mb-1.5`}>
      <h4 className={`text-sm font-semibold tracking-wide ${textColor}`}>{label}</h4>
      <span className="text-xs text-slate-400">{count} result{count !== 1 ? 's' : ''}</span>
    </div>
  );
}

/* ── 4-Category Specimen Grouping ───────────────────────── */

type SpecimenCategory = 'sputum' | 'urine' | 'blood' | 'other';

const CATEGORY_META: Record<SpecimenCategory, { label: string; icon: string }> = {
  sputum: { label: '痰 Sputum', icon: '🫁' },
  urine:  { label: '尿 Urine',  icon: '🧪' },
  blood:  { label: '血液 Blood', icon: '🩸' },
  other:  { label: '其他 Other', icon: '📋' },
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
  negative: CulturePanel[];
}

function groupByCategory(panels: CulturePanel[]): CategoryGroup[] {
  const map: Record<SpecimenCategory, CategoryGroup> = {
    sputum: { category: 'sputum', positive: [], negative: [] },
    urine:  { category: 'urine',  positive: [], negative: [] },
    blood:  { category: 'blood',  positive: [], negative: [] },
    other:  { category: 'other',  positive: [], negative: [] },
  };
  for (const p of panels) {
    const cat = classifySpecimen(p.specimen || 'Unknown');
    if (isPositiveCulture(p)) {
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
  const organismSummaries = useMemo(() => buildOrganismSummaries(cultures), [cultures]);
  const categoryGroups = useMemo(() => groupByCategory(cultures), [cultures]);
  const positiveCount = cultures.filter(isPositiveCulture).length;
  const negativeCount = cultures.length - positiveCount;
  const latestDate = cultures.length > 0 ? cultures[0]?.reportedAt : null;

  const positiveCategoryCount = categoryGroups.filter((g) => g.positive.length > 0).length;

  if (loading) {
    return (
      <Card>
        <CardHeader className="min-h-14 bg-slate-50 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Bug className="h-6 w-6 text-brand" />
            Microbiology
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" text="Loading..." />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="min-h-14 bg-slate-50 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Bug className="h-6 w-6 text-brand" />
            Microbiology
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-2.5">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Bug className="h-6 w-6 text-brand" />
          Microbiology
        </CardTitle>
        <CardDescription className="mt-0.5 text-sm flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {latestDate ? `Latest: ${formatDate(latestDate)}` : 'No data'}
          {cultures.length > 0 && (
            <span className="ml-2 text-slate-400">
              ({positiveCount} positive, {negativeCount} negative)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-1.5 space-y-2">
        {cultures.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No culture data</p>
        ) : (
          <>
            {/* Organism Summary Banner — only if multiple categories have positives */}
            <OrganismBanner summaries={organismSummaries} specimenCount={positiveCategoryCount} />

            {/* 2x2 Grid: 痰 / 尿 / 血液 / 其他 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {categoryGroups.map((group) => {
                const meta = CATEGORY_META[group.category];
                const total = group.positive.length + group.negative.length;
                const hasPositive = group.positive.length > 0;
                const merged = hasPositive ? mergeConsecutiveCultures(group.positive) : [];

                return (
                  <MicroSectionCard key={group.category}>
                    <SectionLabel
                      label={`${meta.icon} ${meta.label}`}
                      count={total}
                      hasPositive={hasPositive}
                    />

                    {total === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">無培養資料</p>
                    ) : (
                      <div className="space-y-2">
                        {/* Positive cultures with merged rows */}
                        {merged.length > 0 && (
                          <div className="space-y-2">
                            {merged.map((m, idx) => (
                              <MergedCultureRow key={idx} merged={m} />
                            ))}
                          </div>
                        )}

                        {/* Negative cultures — always visible */}
                        <NegativeRows panels={group.negative} />

                        {/* "Other" category: show original specimen names */}
                        {group.category === 'other' && total > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {[...new Set([...group.positive, ...group.negative].map((p) => p.specimen))].map((s) => (
                              <span key={s} className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{s}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </MicroSectionCard>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
