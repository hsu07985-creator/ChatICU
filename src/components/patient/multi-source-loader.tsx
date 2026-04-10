import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Clock } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────

type SourceStatus = 'waiting' | 'querying' | 'done';

interface SourceState {
  key: string;
  label: string;
  subLabel: string;
  status: SourceStatus;
}

export interface MultiSourceLoaderProps {
  isLoading: boolean;
  startTime?: number; // Date.now() when query started
}

// ─── Phase definitions ────────────────────────────────────────────

/**
 * Phase 0 (0–500 ms):   intent analysis only
 * Phase 1 (500–1500 ms): Source C done; guideline + drug DB querying
 * Phase 2 (1500–3000 ms): same as phase 1 (continuing)
 * Phase 3 (3000 ms+):   one more source done; evidence integration
 */

type PhaseKey = 0 | 1 | 2 | 3;

const PHASE_ELAPSED_MS: Record<PhaseKey, number> = {
  0: 0,
  1: 500,
  2: 1500,
  3: 3000,
};

function computePhase(elapsedMs: number): PhaseKey {
  if (elapsedMs >= PHASE_ELAPSED_MS[3]) return 3;
  if (elapsedMs >= PHASE_ELAPSED_MS[2]) return 2;
  if (elapsedMs >= PHASE_ELAPSED_MS[1]) return 1;
  return 0;
}

function buildSourceStates(phase: PhaseKey, isLoading: boolean): SourceState[] {
  // When loading has completed, show everything as done
  if (!isLoading) {
    return [
      { key: 'graph',       label: '交互作用資料庫', subLabel: 'Graph',     status: 'done' },
      { key: 'guideline',   label: '臨床指引',       subLabel: 'Guideline', status: 'done' },
      { key: 'drug_db',     label: '藥品資料庫',     subLabel: 'Drug DB',   status: 'done' },
      { key: 'integration', label: '證據整合',        subLabel: '',          status: 'done' },
    ];
  }

  switch (phase) {
    case 0:
      return [
        { key: 'graph',       label: '交互作用資料庫', subLabel: 'Graph',     status: 'waiting' },
        { key: 'guideline',   label: '臨床指引',       subLabel: 'Guideline', status: 'waiting' },
        { key: 'drug_db',     label: '藥品資料庫',     subLabel: 'Drug DB',   status: 'waiting' },
        { key: 'integration', label: '證據整合',        subLabel: '',          status: 'waiting' },
      ];

    case 1:
      return [
        { key: 'graph',       label: '交互作用資料庫', subLabel: 'Graph',     status: 'done' },
        { key: 'guideline',   label: '臨床指引',       subLabel: 'Guideline', status: 'querying' },
        { key: 'drug_db',     label: '藥品資料庫',     subLabel: 'Drug DB',   status: 'querying' },
        { key: 'integration', label: '證據整合',        subLabel: '',          status: 'waiting' },
      ];

    case 2:
      return [
        { key: 'graph',       label: '交互作用資料庫', subLabel: 'Graph',     status: 'done' },
        { key: 'guideline',   label: '臨床指引',       subLabel: 'Guideline', status: 'querying' },
        { key: 'drug_db',     label: '藥品資料庫',     subLabel: 'Drug DB',   status: 'querying' },
        { key: 'integration', label: '證據整合',        subLabel: '',          status: 'waiting' },
      ];

    case 3:
    default:
      return [
        { key: 'graph',       label: '交互作用資料庫', subLabel: 'Graph',     status: 'done' },
        { key: 'guideline',   label: '臨床指引',       subLabel: 'Guideline', status: 'done' },
        { key: 'drug_db',     label: '藥品資料庫',     subLabel: 'Drug DB',   status: 'querying' },
        { key: 'integration', label: '證據整合',        subLabel: '',          status: 'querying' },
      ];
  }
}

function phaseHeadline(phase: PhaseKey, isLoading: boolean): string {
  if (!isLoading) return '查詢完成';
  switch (phase) {
    case 0: return '正在分析查詢意圖...';
    case 1:
    case 2: return '正在搜尋多個知識庫...';
    case 3: return '正在整合多源證據...';
  }
}

// ─── Sub-components ────────────────────────────────────────────────

function SourceRow({ source }: { source: SourceState }) {
  return (
    <div className="flex items-center gap-2 transition-opacity duration-300">
      {/* Status icon */}
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        {source.status === 'done' && (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
        {source.status === 'querying' && (
          <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
        )}
        {source.status === 'waiting' && (
          <Clock className="h-4 w-4 text-slate-300" />
        )}
      </span>

      {/* Source label */}
      <span
        className={[
          'text-xs font-medium transition-colors duration-300',
          source.status === 'done'    ? 'text-emerald-700' : '',
          source.status === 'querying' ? 'text-indigo-700 animate-pulse' : '',
          source.status === 'waiting'  ? 'text-slate-400 dark:text-slate-500' : '',
        ].join(' ')}
      >
        {source.label}
      </span>

      {/* Sub-label tag */}
      {source.subLabel && (
        <span
          className={[
            'text-xs font-mono rounded px-1 py-0.5 transition-colors duration-300',
            source.status === 'done'    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : '',
            source.status === 'querying' ? 'bg-indigo-50 text-indigo-500 border border-indigo-200' : '',
            source.status === 'waiting'  ? 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700' : '',
          ].join(' ')}
        >
          {source.subLabel}
        </span>
      )}

      {/* Animated dots for active sources */}
      {source.status === 'querying' && (
        <span className="text-xs text-indigo-400 animate-pulse select-none">···</span>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────

export function MultiSourceLoader({ isLoading, startTime }: MultiSourceLoaderProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  // Advance a counter every 500 ms while loading
  useEffect(() => {
    if (!isLoading || startTime === undefined) {
      setElapsedMs(0);
      return;
    }

    // Immediately sync to how much time has already elapsed (e.g. if the
    // component mounts after the query already started).
    setElapsedMs(Date.now() - startTime);

    const intervalId = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 500);

    return () => {
      clearInterval(intervalId);
    };
  }, [isLoading, startTime]);

  // Do not render anything when there is nothing to show
  if (!isLoading && elapsedMs === 0) return null;

  const phase = isLoading ? computePhase(elapsedMs) : 3;
  const sources = buildSourceStates(phase, isLoading);
  const headline = phaseHeadline(phase, isLoading);

  return (
    <div className="rounded-lg border border-indigo-100 dark:border-indigo-800 bg-slate-50/70 dark:bg-slate-800/70 px-3 py-2.5 space-y-2">
      {/* Headline row */}
      <div className="flex items-center gap-2">
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{headline}</span>
      </div>

      {/* Source list */}
      <div className="pl-1 space-y-1.5">
        {sources.map((src) => (
          <SourceRow key={src.key} source={src} />
        ))}
      </div>
    </div>
  );
}
