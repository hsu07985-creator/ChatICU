export const RISK_META: Record<string, { cls: string; descr: string }> = {
  X: { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30', descr: 'Avoid combination' },
  D: { cls: 'bg-orange-500/10 text-orange-400 border-orange-500/30', descr: 'Consider therapy modification' },
  C: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', descr: 'Monitor therapy' },
  B: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', descr: 'No action needed' },
  A: { cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30', descr: 'No known interaction' },
};

// Style only — tooltips resolved via t('library.detail.evidence.<key>').
export const RELIABILITY_CLS: Record<string, string> = {
  Excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Fair: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Poor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  Intermediate: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  'Intermediate-High': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  'Intermediate-Low': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
};

export function formatTaipei(iso: string | null | undefined, locale = 'zh-TW'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { timeZone: 'Asia/Taipei', hour12: false });
}
