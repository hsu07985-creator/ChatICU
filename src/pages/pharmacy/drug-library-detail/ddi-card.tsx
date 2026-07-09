import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { type DdiDetailItem } from '../../../lib/api/drug-library';
import { DdiEditRail } from './ddi-edit-rail';
import { RELIABILITY_CLS, RISK_META, formatTaipei } from './shared';

// ── DDI card ────────────────────────────────────────────────────────────
export function DdiCard({
  item,
  editMode,
  onChange,
}: {
  item: DdiDetailItem;
  editMode: boolean;
  onChange: (updates: Partial<DdiDetailItem>) => void;
}) {
  const { t, i18n } = useTranslation('pharmacy');
  const reliabilityCls = item.reliability ? RELIABILITY_CLS[item.reliability] : null;
  const hasOverride = !!item.override_risk_rating;
  const sourceRisk = item.source_risk_rating || item.risk_rating;
  return (
    <Card className={`border-border/40 ${hasOverride ? 'ring-1 ring-blue-500/30' : ''}`}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="font-medium">
            {item.other_drug}
            {item.other_drug_atc && (
              <span className="text-xs text-muted-foreground font-mono ml-2">{item.other_drug_atc}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {item.severity_label && (
              <Badge variant="outline" className="text-[10px]">{item.severity_label}</Badge>
            )}
            {reliabilityCls && item.reliability && (
              <Badge variant="outline" className={`text-[10px] ${reliabilityCls}`} title={t(`library.detail.evidence.${item.reliability}`, { defaultValue: item.reliability })}>
                {item.reliability}
              </Badge>
            )}
            {item.source && (
              <Badge variant="outline" className="text-[10px]">{item.source}</Badge>
            )}
          </div>
        </div>

        {hasOverride && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded p-2 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">{t('library.detail.rule.originalSourceLabel')}</span>
              <span className={`px-1.5 py-0.5 rounded border ${RISK_META[sourceRisk]?.cls || ''} font-mono text-[11px]`}>{sourceRisk}</span>
              <span className="text-muted-foreground">{t('library.detail.rule.overrideArrow')}</span>
              <span className={`px-1.5 py-0.5 rounded border ${RISK_META[item.risk_rating]?.cls || ''} font-mono text-[11px] font-semibold`}>{item.risk_rating}</span>
              <span className="text-blue-400 ml-auto">
                {t('library.detail.ddiCard.overriddenBy', { name: item.overridden_by_name || item.overridden_by })}
              </span>
            </div>
            {item.override_reason && (
              <div><span className="text-muted-foreground">{t('library.detail.rule.reasonInline')}</span>{item.override_reason}</div>
            )}
            {item.override_citation && (
              <div><span className="text-muted-foreground">{t('library.detail.rule.evidenceInline')}</span>{item.override_citation}</div>
            )}
            {item.override_expires_at && (
              <div className="text-muted-foreground">
                {t('library.detail.ddiCard.expireAt', { timestamp: formatTaipei(item.override_expires_at, i18n.language) })}
              </div>
            )}
          </div>
        )}

        {item.mechanism && (
          <div className="text-xs">
            <span className="text-muted-foreground">{t('library.detail.rule.mechanismInline')}</span>
            <span>{item.mechanism}</span>
          </div>
        )}
        {item.management && (
          <div className="text-xs">
            <span className="text-muted-foreground">{t('library.detail.rule.managementInline')}</span>
            <span>{item.management}</span>
          </div>
        )}
        {item.discussion && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">{t('library.detail.rule.discussionToggle')}</summary>
            <div className="mt-1 pl-2 border-l-2 border-border/40 whitespace-pre-wrap">
              {item.discussion}
            </div>
          </details>
        )}
        {item.pubmed_count > 0 && (
          <div className="text-xs text-muted-foreground">
            {t('library.detail.ddiCard.pubmedCount', { count: item.pubmed_count })}
          </div>
        )}

        {/* Read-mode pinned note + verify status */}
        {!editMode && item.pharmacist_note && (
          <div className="text-xs bg-blue-500/5 border border-blue-500/20 rounded p-2 mt-1">
            <span className="text-blue-400 font-medium">{t('library.detail.rule.pharmacistNote')}</span>
            <span className="whitespace-pre-wrap">{item.pharmacist_note}</span>
          </div>
        )}
        {!editMode && item.last_verified_at && (
          <div className="text-[10px] text-emerald-400">
            {t('library.detail.ddiCard.verifiedAt', { timestamp: formatTaipei(item.last_verified_at, i18n.language) })}
            {(item.verified_by_name || item.verified_by) && (
              <>{t('library.detail.ddiCard.verifiedBy', { name: item.verified_by_name || item.verified_by })}</>
            )}
          </div>
        )}

        {/* Edit-mode rail */}
        {editMode && <DdiEditRail item={item} onChange={onChange} />}
      </CardContent>
    </Card>
  );
}

export function RiskGroup({
  risk,
  items,
  defaultOpen,
  editMode,
  onItemChange,
}: {
  risk: string;
  items: DdiDetailItem[];
  defaultOpen: boolean;
  editMode: boolean;
  onItemChange: (id: string, updates: Partial<DdiDetailItem>) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = RISK_META[risk];
  if (!meta || items.length === 0) return null;
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-sm font-semibold hover:bg-accent rounded p-2 transition-colors"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className={`px-2 py-0.5 rounded border ${meta.cls}`}>{risk}</span>
        <span className="text-muted-foreground font-normal">— {meta.descr} ({items.length})</span>
      </button>
      {open && (
        <div className="space-y-2 pl-6">
          {items.map((it) => (
            <DdiCard
              key={it.id}
              item={it}
              editMode={editMode}
              onChange={(u) => onItemChange(it.id, u)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
