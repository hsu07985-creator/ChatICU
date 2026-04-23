import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Pill } from 'lucide-react';
import type { DuplicateAlert, DuplicateAlertMember } from '../../lib/api/medications';
import { cn } from '../ui/utils';

/**
 * Duplicate-medication warning badges.
 *
 * Parallel component to `drug-interaction-badges.tsx` — same visual
 * language, but backed by the `/patients/{id}/medication-duplicates`
 * endpoint (Wave 2 of docs/duplicate-medication-integration-plan.md).
 */

export interface MedicationDuplicateBadgesProps {
  alerts: DuplicateAlert[];
  /** Phase 2 — manual override hook. Not wired yet. */
  onOverride?: (fingerprint: string, reason: string) => void;
}

type Level = DuplicateAlert['level'];

interface LevelConfig {
  label: string;
  icon: string;            // emoji marker for summary chip
  cardClass: string;       // full-card background + border
  badgeClass: string;      // header pill
  textClass: string;       // recommendation copy tone
  accentClass: string;     // member row left accent
  isCritical: boolean;
}

const LEVEL_CONFIG: Record<Level, LevelConfig> = {
  critical: {
    label: 'Critical',
    icon: '🔴',
    cardClass: 'bg-red-50 dark:bg-red-950/30 border-red-400 dark:border-red-900',
    badgeClass:
      'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 border-red-300 dark:border-red-900',
    textClass: 'text-red-800 dark:text-red-400',
    accentClass: 'border-red-300 dark:border-red-800',
    isCritical: true,
  },
  high: {
    label: 'High',
    icon: '🟠',
    cardClass: 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-800',
    badgeClass:
      'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-400 border-orange-300 dark:border-orange-700',
    textClass: 'text-orange-800 dark:text-orange-400',
    accentClass: 'border-orange-300 dark:border-orange-800',
    isCritical: false,
  },
  moderate: {
    label: 'Moderate',
    icon: '🟡',
    cardClass: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800',
    badgeClass:
      'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700',
    textClass: 'text-yellow-800 dark:text-yellow-400',
    accentClass: 'border-yellow-300 dark:border-yellow-800',
    isCritical: false,
  },
  low: {
    label: 'Low',
    icon: '🔵',
    cardClass: 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800',
    badgeClass:
      'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400 border-blue-300 dark:border-blue-700',
    textClass: 'text-blue-800 dark:text-blue-400',
    accentClass: 'border-blue-300 dark:border-blue-800',
    isCritical: false,
  },
  info: {
    label: 'Info',
    icon: '⚪',
    cardClass:
      'bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700',
    badgeClass:
      'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600',
    textClass: 'text-gray-700 dark:text-gray-400',
    accentClass: 'border-gray-200 dark:border-slate-700',
    isCritical: false,
  },
};

const LEVEL_ORDER: Record<Level, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
};

function formatMember(member: DuplicateAlertMember): string {
  const parts = [
    member.genericName || '—',
    member.atcCode ? `(${member.atcCode})` : null,
    member.route ? `· ${member.route}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

interface DuplicateCardProps {
  alert: DuplicateAlert;
  expanded: boolean;
  onToggle: () => void;
}

function DuplicateCard({ alert, expanded, onToggle }: DuplicateCardProps) {
  const config = LEVEL_CONFIG[alert.level] ?? LEVEL_CONFIG.info;

  return (
    <div
      className={cn(
        'rounded-lg border text-xs',
        config.isCritical ? 'border-2' : 'border',
        config.cardClass,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:brightness-95 transition-[filter]"
      >
        <span
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold tabular-nums',
            config.badgeClass,
          )}
        >
          {config.isCritical && (
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          )}
          <span>{config.icon} {config.label}</span>
        </span>
        <span className={cn('font-semibold', config.textClass)}>
          {alert.mechanism}
        </span>
        <span className={cn('text-[11px] opacity-80', config.textClass)}>
          — {alert.members.length} 藥
        </span>
        {alert.autoDowngraded && (
          <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            自動降級
            {alert.downgradeReason ? `：${alert.downgradeReason}` : ''}
          </span>
        )}
        {expanded ? (
          <ChevronUp
            className={cn('h-3.5 w-3.5 shrink-0 ml-auto', config.textClass)}
          />
        ) : (
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 ml-auto', config.textClass)}
          />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 pt-0 space-y-1.5">
          <ul className="space-y-1">
            {alert.members.map((member, idx) => (
              <li
                key={`${alert.fingerprint}-${member.medicationId ?? idx}`}
                className={cn(
                  'flex items-center gap-1.5 rounded border px-2 py-1 bg-white/60 dark:bg-slate-900/40',
                  config.accentClass,
                )}
              >
                <Pill
                  className={cn('h-3 w-3 shrink-0', config.textClass)}
                  aria-hidden
                />
                <span className="text-[11px] text-slate-800 dark:text-slate-200">
                  {formatMember(member)}
                </span>
                {member.isPrn && (
                  <span className="ml-auto text-[10px] px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300">
                    PRN
                  </span>
                )}
              </li>
            ))}
          </ul>

          {alert.recommendation && (
            <p
              className={cn(
                'text-[11px] leading-relaxed font-medium',
                config.textClass,
              )}
            >
              建議：{alert.recommendation}
            </p>
          )}

          {alert.evidenceUrl && (
            <a
              href={alert.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className={cn('text-[11px] underline', config.textClass)}
            >
              參考資料
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function MedicationDuplicateBadges({
  alerts,
  // onOverride — reserved for Phase 2; not wired in Wave 2.
}: MedicationDuplicateBadgesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!alerts || alerts.length === 0) {
    return null;
  }

  const sorted = [...alerts].sort((a, b) => {
    const orderA = LEVEL_ORDER[a.level] ?? 99;
    const orderB = LEVEL_ORDER[b.level] ?? 99;
    return orderA - orderB;
  });

  const counts = sorted.reduce<Record<Level, number>>(
    (acc, alert) => {
      acc[alert.level] = (acc[alert.level] ?? 0) + 1;
      return acc;
    },
    { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
  );

  const toggle = (fingerprint: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) {
        next.delete(fingerprint);
      } else {
        next.add(fingerprint);
      }
      return next;
    });
  };

  const hasCritical = counts.critical > 0;

  return (
    <div className="mb-2 space-y-1.5">
      {hasCritical && (
        <div className="flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>偵測到重大重複用藥</span>
        </div>
      )}

      {/* Count summary row */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-medium text-slate-600 dark:text-slate-400">
          重複用藥
        </span>
        {(['critical', 'high', 'moderate', 'low', 'info'] as Level[]).map((lvl) => {
          if (counts[lvl] === 0) return null;
          const cfg = LEVEL_CONFIG[lvl];
          return (
            <span
              key={lvl}
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border tabular-nums',
                cfg.badgeClass,
              )}
            >
              <span>{cfg.icon}</span>
              <span className="font-semibold">{counts[lvl]}</span>
            </span>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map((alert) => (
          <DuplicateCard
            key={alert.fingerprint}
            alert={alert}
            expanded={expanded.has(alert.fingerprint)}
            onToggle={() => toggle(alert.fingerprint)}
          />
        ))}
      </div>
    </div>
  );
}
