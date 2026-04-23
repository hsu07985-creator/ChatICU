import { AlertTriangle, ArrowRight, Loader2, Pill, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useApiQuery } from '../../hooks/use-api-query';
import {
  getMedicationDuplicates,
  getMedications,
  type DrugInteraction,
  type DuplicateAlert,
  type MedicationsResponse,
} from '../../lib/api/medications';
import { cn } from '../ui/utils';

/**
 * Wave 6b — 病人摘要 Tab 的「用藥風險」卡片。
 *
 * 資料來源：
 *   - DDI          : reuse 既有 `/patients/{id}/medications` 回應的 `interactions`
 *                    陣列 (share cache key 與 patient-medications-tab 一致)
 *   - 重複用藥      : `/patients/{id}/medication-duplicates?context=inpatient`
 *                    (queryKey 與 patient-medications-tab 完全相同 → 兩 tab 共享
 *                    一份 cache，進 summary 後再切到用藥 tab 不會重 fetch)
 *   - 過敏衝突      : 目前前端沒有獨立判斷服務，若 `allergies` 為空或無匹配 meds
 *                    則顯示 `—`，避免誤報
 *
 * 視覺：shadcn Card + 對齊 `medication-duplicate-badges` 的紅/橙/黃配色。
 */

export interface MedicationRiskCardProps {
  patientId: string;
  /** 病患過敏清單（選擇性）— 若提供會顯示計數而非 `—`。 */
  allergies?: string[] | null;
  /** 父層（patient-detail.tsx）提供的切 tab callback；未提供則 fallback hash */
  onNavigateToMeds?: () => void;
  className?: string;
}

type Severity = 'critical' | 'high' | 'moderate';

interface DuplicateCountsShape {
  critical?: number;
  high?: number;
  moderate?: number;
  low?: number;
  info?: number;
  [key: string]: number | undefined;
}

// Lexicomp risk rating → 我們卡片的 severity bucket.
// X / D / C 是臨床上「需要注意」的 DDI，對齊 drug-interaction-badges 的
// critical (X) / high (D) / moderate (C) 階層。
function tallyDdiBySeverity(
  interactions: DrugInteraction[] | undefined,
): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, moderate: 0 };
  if (!interactions) return out;
  for (const i of interactions) {
    const rating = (i.riskRating || '').toUpperCase();
    if (rating === 'X') out.critical += 1;
    else if (rating === 'D') out.high += 1;
    else if (rating === 'C') out.moderate += 1;
  }
  return out;
}

function tallyDuplicatesBySeverity(
  counts: DuplicateCountsShape | undefined,
  alerts: DuplicateAlert[] | undefined,
): Record<Severity, number> {
  // Backend response includes `counts`, but fall back to tallying `alerts` if
  // the field is missing (defensive — matches patient-medications-tab pattern).
  if (counts && (counts.critical != null || counts.high != null || counts.moderate != null)) {
    return {
      critical: counts.critical ?? 0,
      high: counts.high ?? 0,
      moderate: counts.moderate ?? 0,
    };
  }
  const out: Record<Severity, number> = { critical: 0, high: 0, moderate: 0 };
  if (!alerts) return out;
  for (const a of alerts) {
    if (a.level === 'critical') out.critical += 1;
    else if (a.level === 'high') out.high += 1;
    else if (a.level === 'moderate') out.moderate += 1;
  }
  return out;
}

const SEV_STYLES: Record<Severity, { badge: string; dot: string; label: string }> = {
  critical: {
    badge:
      'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-900',
    dot: 'bg-red-500',
    label: 'Critical',
  },
  high: {
    badge:
      'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800',
    dot: 'bg-orange-500',
    label: 'High',
  },
  moderate: {
    badge:
      'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 border-yellow-300 dark:border-yellow-800',
    dot: 'bg-yellow-500',
    label: 'Moderate',
  },
};

function SeverityBadges({ counts }: { counts: Record<Severity, number> }) {
  const hasAny = counts.critical + counts.high + counts.moderate > 0;
  if (!hasAny) {
    return (
      <span className="text-sm text-slate-500 dark:text-slate-400">無</span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(['critical', 'high', 'moderate'] as Severity[]).map((lvl) => {
        if (counts[lvl] === 0) return null;
        const s = SEV_STYLES[lvl];
        return (
          <span
            key={lvl}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs tabular-nums',
              s.badge,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
            {s.label} {counts[lvl]}
          </span>
        );
      })}
    </div>
  );
}

export function MedicationRiskCard({
  patientId,
  allergies,
  onNavigateToMeds,
  className,
}: MedicationRiskCardProps) {
  // DDI — 同 key 與 patient-medications-tab 之 getMedications 不共享（該頁
  // 是以 useState 管），但仍給予穩定 queryKey 讓 invalidate 可精準觸發。
  const { data: medsData, isLoading: ddiLoading } = useApiQuery<MedicationsResponse>({
    queryKey: ['patient-medications', patientId, 'all'],
    queryFn: async () => {
      try {
        return await getMedications(patientId, { status: 'all' });
      } catch (err) {
        console.warn('[medication-risk-card] meds fetch failed', err);
        return {
          medications: [],
          grouped: { sedation: [], analgesia: [], nmb: [], other: [], outpatient: [] },
          interactions: [],
        };
      }
    },
    enabled: Boolean(patientId),
    staleTime: 30_000,
    retry: 0,
  });

  // Duplicates — 與 patient-medications-tab.tsx 使用完全相同的 queryKey
  // （'medication-duplicates', patientId, 'inpatient'），兩邊共享一份 cache。
  const duplicateContext: 'inpatient' = 'inpatient';
  const { data: duplicateData, isLoading: dupLoading } = useApiQuery<
    { alerts: DuplicateAlert[]; counts: DuplicateCountsShape }
  >({
    queryKey: ['medication-duplicates', patientId, duplicateContext],
    queryFn: async () => {
      try {
        return await getMedicationDuplicates(patientId, duplicateContext);
      } catch (err) {
        console.warn('[medication-risk-card] duplicates fetch failed', err);
        return { alerts: [], counts: {} };
      }
    },
    enabled: Boolean(patientId),
    staleTime: 30_000,
    retry: 0,
  });

  const ddiCounts = tallyDdiBySeverity(medsData?.interactions);
  const dupCounts = tallyDuplicatesBySeverity(
    duplicateData?.counts,
    duplicateData?.alerts,
  );
  const allergyCount = Array.isArray(allergies) ? allergies.length : 0;

  const ddiTotal = ddiCounts.critical + ddiCounts.high + ddiCounts.moderate;
  const dupTotal = dupCounts.critical + dupCounts.high + dupCounts.moderate;
  const hasAnyCritical = ddiCounts.critical > 0 || dupCounts.critical > 0;
  const hasAnyHigh = ddiCounts.high > 0 || dupCounts.high > 0;

  // Accent：有 critical→紅；只有 high→橙；其它→中性
  const accent = hasAnyCritical
    ? 'border-red-300 dark:border-red-900 bg-gradient-to-br from-red-50/60 via-white to-white dark:from-red-950/30 dark:via-slate-900 dark:to-slate-900'
    : hasAnyHigh
    ? 'border-orange-300 dark:border-orange-800 bg-gradient-to-br from-orange-50/60 via-white to-white dark:from-orange-950/30 dark:via-slate-900 dark:to-slate-900'
    : 'border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 via-white to-slate-100/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80';

  const handleNavigate = () => {
    if (onNavigateToMeds) {
      onNavigateToMeds();
      return;
    }
    // Fallback — patient-detail 裡 tab state 是 `activeTab`，對應
    // `<TabsTrigger value="meds" />`。沒 callback 時用 hash 讓父層可偵測。
    if (typeof window !== 'undefined') {
      window.location.hash = '#meds';
    }
  };

  const isLoading = ddiLoading || dupLoading;

  return (
    <Card className={cn('overflow-hidden border', accent, className)}>
      <CardHeader className="border-b border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/70 pb-1.5">
        <CardTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ShieldAlert
            className={cn(
              'h-5 w-5',
              hasAnyCritical
                ? 'text-red-600 dark:text-red-400'
                : hasAnyHigh
                ? 'text-orange-600 dark:text-orange-400'
                : 'text-slate-500 dark:text-slate-400',
            )}
            aria-hidden
          />
          用藥風險
          {hasAnyCritical && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-red-300 dark:border-red-900 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:text-red-300">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              重大警示
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-3">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 space-y-2.5">
          {/* DDI row */}
          <div className="flex items-start gap-3">
            <span className="w-20 shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
              DDI
            </span>
            <div className="flex-1 min-w-0">
              {isLoading && ddiTotal === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> 計算中…
                </span>
              ) : (
                <SeverityBadges counts={ddiCounts} />
              )}
            </div>
          </div>

          {/* Duplicate row */}
          <div className="flex items-start gap-3 border-t border-slate-100 dark:border-slate-700 pt-2.5">
            <span className="w-20 shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
              重複用藥
            </span>
            <div className="flex-1 min-w-0">
              {isLoading && dupTotal === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> 計算中…
                </span>
              ) : (
                <SeverityBadges counts={dupCounts} />
              )}
            </div>
          </div>

          {/* Allergy row — 尚未有自動偵測，用現有 patient.allergies 作提示 */}
          <div className="flex items-start gap-3 border-t border-slate-100 dark:border-slate-700 pt-2.5">
            <span className="w-20 shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
              過敏衝突
            </span>
            <div className="flex-1 min-w-0">
              {allergyCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-300">
                  <Pill className="h-3 w-3" aria-hidden />
                  已登錄 {allergyCount} 項過敏
                </span>
              ) : (
                <span className="text-sm text-slate-400 dark:text-slate-500">—</span>
              )}
            </div>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleNavigate}
          className="w-full h-8 text-xs justify-center hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          查看詳情
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          <span className="ml-0.5">前往用藥頁</span>
        </Button>
      </CardContent>
    </Card>
  );
}
