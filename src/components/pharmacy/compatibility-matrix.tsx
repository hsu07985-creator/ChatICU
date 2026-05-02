export type CompatStatus = 'C' | 'I' | '-' | '?';

export interface CompatibilityCell {
  status: CompatStatus;
  notes?: string;
}

export interface CompatibilityMatrixProps {
  drugs: string[];
  /** Looks up the cell value for an unordered drug pair. Should be commutative. */
  lookupCell: (drugA: string, drugB: string) => CompatibilityCell;
  /** Drug names that are NOT in the Y-Site source. Renders a "(無 Y-Site)" badge on header. */
  extendedSet?: Set<string>;
  /** Override max-width truncation length (defaults to 12 chars). */
  maxNameLength?: number;
}

const STATUS_CONFIG: Record<CompatStatus, { label: string; short: string; color: string; bg: string }> = {
  C: { label: '相容 (Compatible)',     short: 'C', color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700' },
  I: { label: '不相容 (Incompatible)', short: 'I', color: 'text-red-700 dark:text-red-300',     bg: 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700' },
  '-': { label: '無配對資料',          short: '-', color: 'text-gray-500 dark:text-gray-400',  bg: 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700' },
  '?': { label: '查詢中',              short: '?', color: 'text-gray-400 dark:text-gray-500',  bg: 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700' },
};

export function CompatibilityMatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700">C</span>
        相容
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700">I</span>
        不相容
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-5 h-5 rounded text-center text-xs font-bold leading-5 bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-slate-700">-</span>
        無配對資料
      </span>
    </div>
  );
}

export function CompatibilityMatrix({
  drugs,
  lookupCell,
  extendedSet,
  maxNameLength = 12,
}: CompatibilityMatrixProps) {
  if (drugs.length < 2) return null;

  const truncate = (s: string) => (s.length > maxNameLength ? s.slice(0, maxNameLength - 2) + '…' : s);
  const isExtended = (d: string) => !!extendedSet?.has(d);

  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground sticky left-0 bg-background z-10" />
            {drugs.map(d => (
              <th
                key={d}
                className="px-2 py-1.5 text-center font-medium text-xs whitespace-nowrap max-w-[110px]"
                title={isExtended(d) ? `${d}（非 Y-Site 來源，無配對資料）` : d}
              >
                <span className="truncate block">{truncate(d)}</span>
                {isExtended(d) && (
                  <span className="block text-[10px] text-amber-500 dark:text-amber-400 font-normal leading-tight">無 Y-Site</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drugs.map((rowDrug, ri) => (
            <tr key={rowDrug}>
              <td
                className="px-2 py-1.5 font-medium text-xs whitespace-nowrap sticky left-0 bg-background z-10 border-r max-w-[110px]"
                title={isExtended(rowDrug) ? `${rowDrug}（非 Y-Site 來源）` : rowDrug}
              >
                <span className="truncate block">{truncate(rowDrug)}</span>
                {isExtended(rowDrug) && (
                  <span className="block text-[10px] text-amber-500 dark:text-amber-400 font-normal leading-tight">無 Y-Site</span>
                )}
              </td>
              {drugs.map((colDrug, ci) => {
                if (ri === ci) {
                  return <td key={colDrug} className="px-2 py-1.5 text-center bg-gray-50 dark:bg-slate-800">—</td>;
                }
                const cell = lookupCell(rowDrug, colDrug);
                const cfg = STATUS_CONFIG[cell.status];
                return (
                  <td
                    key={colDrug}
                    className={`px-2 py-1.5 text-center border ${cfg.bg} cursor-default`}
                    title={`${rowDrug} + ${colDrug}: ${cfg.label}${cell.notes ? ` (${cell.notes})` : ''}`}
                  >
                    <span className={`font-bold text-xs ${cfg.color}`}>{cfg.short}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
