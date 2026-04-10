import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';

export interface ConfidenceBadgeProps {
  /** 信心分數，0.0 到 1.0 */
  confidence: number;
  /** sm: 內嵌緊湊樣式；md: 獨立稍大樣式（預設 sm） */
  size?: 'sm' | 'md';
  /** 是否顯示「高信心」/「中等信心」/「低信心」文字（預設 true） */
  showLabel?: boolean;
  className?: string;
}

/**
 * 可重用的 AI 信心分數徽章。
 *
 * - ≥ 0.75 → 綠色 + 「高信心」
 * - 0.50–0.74 → 黃色 + 「中等信心」
 * - < 0.50  → 紅色 + 「低信心 — 建議諮詢專科」
 *
 * 若傳入 `confidence` 為非有限數值（null / undefined / NaN），元件不渲染。
 */
export function ConfidenceBadge({
  confidence,
  size = 'sm',
  showLabel = true,
  className,
}: ConfidenceBadgeProps) {
  // 防衛性判斷：無效值不渲染
  if (!Number.isFinite(confidence)) return null;

  const pct = Math.round(confidence * 100);
  const isMd = size === 'md';

  if (confidence >= 0.75) {
    return (
      <Badge
        className={cn(
          'border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-400 gap-1',
          isMd ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
          className,
        )}
      >
        <CheckCircle2 className={isMd ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        {showLabel && <span>高信心</span>}
        <span>({pct}%)</span>
      </Badge>
    );
  }

  if (confidence >= 0.5) {
    return (
      <Badge
        className={cn(
          'border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-400 gap-1',
          isMd ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
          className,
        )}
      >
        <span
          className={cn(
            'rounded-full bg-yellow-500',
            isMd ? 'h-2 w-2' : 'h-1.5 w-1.5',
          )}
        />
        {showLabel && <span>中等信心</span>}
        <span>({pct}%)</span>
      </Badge>
    );
  }

  return (
    <Badge
      className={cn(
        'border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-400 gap-1',
        isMd ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
        className,
      )}
    >
      <XCircle className={isMd ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      {showLabel && <span>低信心 — 建議諮詢專科</span>}
      <span>({pct}%)</span>
    </Badge>
  );
}
