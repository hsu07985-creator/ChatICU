import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { useAuth } from '../../lib/auth-context';
import { useEditMode } from '../../lib/drug-library-edit-mode';
import { useTranslation } from 'react-i18next';
import {
  type DdiDetailItem,
  type DrugDetail,
  type IvCompatItem,
  type RuleHistoryEntry,
  deprecateRule,
  getDrugDetail,
  getRuleHistory,
  proposeOverride,
  updateRuleNote,
  verifyRule,
} from '../../lib/api/drug-library';

const RISK_META: Record<string, { cls: string; descr: string }> = {
  X: { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30', descr: 'Avoid combination' },
  D: { cls: 'bg-orange-500/10 text-orange-400 border-orange-500/30', descr: 'Consider therapy modification' },
  C: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', descr: 'Monitor therapy' },
  B: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', descr: 'No action needed' },
  A: { cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30', descr: 'No known interaction' },
};

// Style only — tooltips resolved via t('library.detail.evidence.<key>').
const RELIABILITY_CLS: Record<string, string> = {
  Excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Fair: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Poor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  Intermediate: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  'Intermediate-High': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  'Intermediate-Low': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
};

function formatTaipei(iso: string | null | undefined, locale = 'zh-TW'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { timeZone: 'Asia/Taipei', hour12: false });
}

// ── Edit-mode action rail per DDI card ─────────────────────────────────
function DdiEditRail({
  item,
  onChange,
}: {
  item: DdiDetailItem;
  onChange: (updates: Partial<DdiDetailItem>) => void;
}) {
  const { t } = useTranslation('pharmacy');
  const [noteDraft, setNoteDraft] = useState<string>(item.pharmacist_note ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deprecateOpen, setDeprecateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const noteDirty = (noteDraft || '') !== (item.pharmacist_note || '');

  const saveNote = async () => {
    setSavingNote(true);
    try {
      const r = await updateRuleNote(item.id, noteDraft || null);
      onChange({ pharmacist_note: r.pharmacist_note, etag: r.etag });
      toast.success(t('library.detail.noteSavedToast'));
    } catch (e: any) {
      toast.error(e?.message || t('library.detail.noteSaveError'));
    } finally {
      setSavingNote(false);
    }
  };

  const doVerify = async () => {
    setVerifying(true);
    try {
      const r = await verifyRule(item.id);
      onChange({
        last_verified_at: r.last_verified_at,
        verified_by: r.verified_by,
        verified_by_name: r.verified_by_name,
        etag: r.etag,
      });
      toast.success(t('library.detail.editRail.verifySuccessWith', { name: r.verified_by_name }));
    } catch (e: any) {
      toast.error(e?.message || t('library.detail.actionFailed'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="border-t border-border/30 pt-2 mt-2 space-y-2">
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground">{t('library.detail.noteCardLabel')}</div>
        <Textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder={t('library.detail.notePlaceholder')}
          className="text-xs min-h-[60px]"
          maxLength={2000}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{t('library.detail.editRail.saveNoteCounter', { count: noteDraft.length })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!noteDirty || savingNote}
            onClick={saveNote}
            className="h-7 text-xs"
          >
            {savingNote && <Loader2 className="size-3 mr-1 animate-spin" />}
            {t('library.detail.editRail.saveNote')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          disabled={verifying}
          onClick={doVerify}
          className="h-7 text-xs"
        >
          {verifying && <Loader2 className="size-3 mr-1 animate-spin" />}
          {t('library.detail.editRail.verify')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setProposeOpen(true)}
          className="h-7 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
        >
          {t('library.detail.editRail.propose')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeprecateOpen(true)}
          className="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
        >
          {t('library.detail.editRail.deprecate')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setHistoryOpen(true)}
          className="h-7 text-xs ml-auto"
        >
          {t('library.detail.editRail.history')}
        </Button>
      </div>

      <ProposeOverrideDialog
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        ruleId={item.id}
        ruleLabel={item.other_drug}
        sourceRisk={item.source_risk_rating || item.risk_rating}
        onProposed={() => setProposeOpen(false)}
      />
      <DeprecateDialog
        open={deprecateOpen}
        onClose={() => setDeprecateOpen(false)}
        ruleId={item.id}
        ruleLabel={item.other_drug}
        onDeprecated={() => {
          // Caller will refetch; close dialog
          setDeprecateOpen(false);
        }}
      />
      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        ruleId={item.id}
      />
    </div>
  );
}

function ProposeOverrideDialog({
  open,
  onClose,
  ruleId,
  ruleLabel,
  sourceRisk,
  onProposed,
}: {
  open: boolean;
  onClose: () => void;
  ruleId: string;
  ruleLabel: string;
  sourceRisk: string;
  onProposed: () => void;
}) {
  const RISKS = ['X', 'D', 'C', 'B', 'A'] as const;
  const [newRisk, setNewRisk] = useState<typeof RISKS[number]>('C');
  const [reason, setReason] = useState('');
  const [citation, setCitation] = useState('');
  const { t } = useTranslation('pharmacy');
  const [days, setDays] = useState(365);
  const [submitting, setSubmitting] = useState(false);

  // X→ downgrade is permanently forbidden
  const xDowngradeBlocked = sourceRisk === 'X' && newRisk !== 'X';
  const reasonOk = reason.trim().length >= 30;
  const citOk = citation.trim().length >= 10;
  const ok = !xDowngradeBlocked && reasonOk && citOk;

  const submit = async () => {
    if (!ok) return;
    setSubmitting(true);
    try {
      await proposeOverride(ruleId, {
        override_risk_rating: newRisk,
        reason: reason.trim(),
        citation: citation.trim(),
        expires_in_days: days,
      });
      toast.success(t('library.detail.proposeDialog.submitToast'));
      onProposed();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || t('library.detail.actionFailed'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('library.detail.proposeDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('library.detail.proposeRules.sourceRule', { label: ruleLabel, risk: '' })}<Badge variant="outline" className="text-[10px]">{sourceRisk}</Badge>
            {t('library.detail.proposeRules.afterApproval')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('library.detail.proposeDialog.newRiskLabel')}</div>
            <div className="flex gap-1.5">
              {RISKS.map((r) => (
                <button
                  key={r}
                  onClick={() => setNewRisk(r)}
                  className={`px-3 py-1.5 rounded border text-sm font-mono transition-colors ${
                    newRisk === r ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {xDowngradeBlocked && (
              <div className="text-xs text-rose-400 mt-1">
                {t('library.detail.proposeRules.xDowngradeBlocked')}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('library.detail.proposeDialog.reasonLabel')}</div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('library.detail.proposeDialog.reasonPlaceholder')}
              className="min-h-[80px]"
              maxLength={1000}
            />
            <div className="text-[10px] text-muted-foreground">{t('library.detail.proposeRules.reasonCounter', { count: reason.length })}</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('library.detail.proposeDialog.citationLabel')}</div>
            <Textarea
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              placeholder={t('library.detail.proposeDialog.citationPlaceholder')}
              className="min-h-[50px]"
              maxLength={500}
            />
            <div className="text-[10px] text-muted-foreground">{t('library.detail.proposeRules.citationCounter', { count: citation.length })}</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('library.detail.proposeDialog.ttlLabel')}</div>
            <input
              type="number"
              min={30}
              max={730}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value) || 365)}
              className="w-32 px-2 py-1 text-sm rounded border bg-background"
            />
            <span className="ml-2 text-xs text-muted-foreground">{t('library.detail.proposeDialog.ttlSuffix')}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('library.detail.proposeDialog.cancel')}</Button>
          <Button disabled={!ok || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            {t('library.detail.proposeRules.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeprecateDialog({
  open,
  onClose,
  ruleId,
  ruleLabel,
  onDeprecated,
}: {
  open: boolean;
  onClose: () => void;
  ruleId: string;
  ruleLabel: string;
  onDeprecated: () => void;
}) {
  const { t } = useTranslation('pharmacy');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ok = reason.trim().length >= 30;
  const submit = async () => {
    if (!ok) return;
    setSubmitting(true);
    try {
      await deprecateRule(ruleId, reason.trim());
      toast.success(t('library.detail.deprecateDialog.successToast'));
      onDeprecated();
      // Reload page so the row disappears (is_active=FALSE filter)
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      toast.error(e?.message || t('library.detail.actionFailed'));
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.detail.deprecateDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('library.detail.deprecateExtra.description', { label: ruleLabel })}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('library.detail.deprecateDialog.placeholder')}
          className="min-h-[100px]"
          maxLength={500}
        />
        <div className="text-xs text-muted-foreground">
          {t('library.detail.deprecateExtra.counter', { count: reason.length })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('library.detail.deprecateDialog.cancel')}</Button>
          <Button
            variant="destructive"
            disabled={!ok || submitting}
            onClick={submit}
          >
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            {t('library.detail.deprecateExtra.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  open,
  onClose,
  ruleId,
}: {
  open: boolean;
  onClose: () => void;
  ruleId: string;
}) {
  const { t, i18n } = useTranslation('pharmacy');
  const [history, setHistory] = useState<RuleHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setHistory(null);
    getRuleHistory(ruleId)
      .then((d) => setHistory(d.history))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [open, ruleId]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('library.detail.historyDialog.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{ruleId}</span> {t('library.detail.history.subtitle', { ruleId: '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {loading && (
            <div className="text-sm text-muted-foreground py-4 text-center flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> {t('library.detail.history.loading')}
            </div>
          )}
          {history && history.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {t('library.detail.history.empty')}
            </div>
          )}
          {history?.map((h, i) => (
            <Card key={i} className="border-border/40">
              <CardContent className="py-2.5 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{h.action}</Badge>
                    <span className="font-medium">{h.actor_name}</span>
                    {h.actor_role && (
                      <span className="text-muted-foreground">{h.actor_role}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground">{formatTaipei(h.created_at, i18n.language)}</span>
                </div>
                {h.reason && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">{t('library.detail.historyDialog.reason')}</span>{h.reason}
                  </div>
                )}
                {h.before && (
                  <div className="text-[10px] text-muted-foreground">
                    {t('library.detail.historyDialog.before')} <code>{JSON.stringify(h.before)}</code>
                  </div>
                )}
                {h.after && (
                  <div className="text-[10px] text-muted-foreground">
                    {t('library.detail.historyDialog.after')} <code>{JSON.stringify(h.after)}</code>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── DDI card ────────────────────────────────────────────────────────────
function DdiCard({
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

function RiskGroup({
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

function IvCompatList({ items }: { items: IvCompatItem[] }) {
  const { t } = useTranslation('pharmacy');
  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        {t('library.detail.iv.noData')}
      </div>
    );
  }
  const compatible = items.filter((i) => i.compatible);
  const incompatible = items.filter((i) => !i.compatible);
  const sectionRender = (label: string, list: IvCompatItem[], cls: string) => (
    list.length > 0 && (
      <div className="space-y-1.5">
        <div className={`text-xs font-semibold ${cls}`}>{label} ({list.length})</div>
        <div className="space-y-1.5">
          {list.map((it) => (
            <Card key={it.id} className="border-border/40">
              <CardContent className="py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2 flex-wrap text-sm">
                  <span className="font-medium">{it.other_drug}</span>
                  <div className="flex items-center gap-1 text-[10px]">
                    {it.solution && <Badge variant="outline" className="text-[10px]">{t('library.detail.iv.solution', { value: it.solution })}</Badge>}
                    {it.time_stability && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        {t('library.detail.iv.stable', { value: it.time_stability })}
                      </Badge>
                    )}
                    {it.source && <Badge variant="outline" className="text-[10px]">{it.source}</Badge>}
                  </div>
                </div>
                {it.notes && (
                  <div className="text-xs text-muted-foreground">{it.notes}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  );
  return (
    <div className="space-y-3">
      {sectionRender(t('library.detail.compatibility.compatibleHeading'), compatible, 'text-emerald-400')}
      {sectionRender(t('library.detail.compatibility.incompatibleHeading'), incompatible, 'text-rose-400')}
    </div>
  );
}

type TabKey = 'ddi' | 'iv';

export function DrugLibraryDetailPage() {
  const { t } = useTranslation('pharmacy');
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPharmOrAdmin = user?.role === 'pharmacist' || user?.role === 'admin';
  const [editMode, setEditMode] = useEditMode();

  const [data, setData] = useState<DrugDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('ddi');
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setError(null);
    getDrugDetail(name)
      .then((d) => setData(d))
      .catch((e) => setError(e?.message || t('library.detail.header.loadError')))
      .finally(() => setLoading(false));
  }, [name]);

  // Local optimistic update so a saved note/verify doesn't require full reload
  const onItemChange = (id: string, updates: Partial<DdiDetailItem>) => {
    setData((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        ddi: cur.ddi.map((d) => (d.id === id ? { ...d, ...updates } : d)),
      };
    });
  };

  const grouped = useMemo(() => {
    const m: Record<string, DdiDetailItem[]> = { X: [], D: [], C: [], B: [], A: [] };
    data?.ddi.forEach((d) => {
      if (m[d.risk_rating]) m[d.risk_rating].push(d);
    });
    return m;
  }, [data]);

  const toggleRisk = (r: string) => {
    setRiskFilter((s) => {
      const next = new Set(s);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const visibleRisks = riskFilter.size === 0 ? ['X', 'D', 'C', 'B', 'A'] : Array.from(riskFilter);
  const ivCount = data?.iv_compatibility?.length || 0;

  const tabClass = (k: TabKey) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-4 max-w-screen-xl">
      <div className="flex items-center justify-between gap-2 flex-wrap pr-12 lg:pr-14">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/pharmacy/drug-library')}
          className="-ml-2"
        >
          <ArrowLeft className="size-4 mr-1" /> {t('library.detail.header.back')}
        </Button>
        {isPharmOrAdmin && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{t('library.detail.header.modeLabel')}</span>
            <Button
              size="sm"
              variant={editMode ? 'outline' : 'default'}
              onClick={() => setEditMode(false)}
              className="h-7 text-xs"
            >
              {t('library.detail.header.modeView')}
            </Button>
            <Button
              size="sm"
              variant={editMode ? 'default' : 'outline'}
              onClick={() => setEditMode(true)}
              className="h-7 text-xs"
            >
              {t('library.detail.header.modeEdit')}
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {t('library.detail.page.loading')}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="py-4 text-rose-400 text-sm">{error}</CardContent>
        </Card>
      )}

      {data && !data.exists && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {t('library.detail.page.notFound', { name: '' })}<span className="font-mono">{name}</span>
          </CardContent>
        </Card>
      )}

      {data && data.exists && (
        <>
          <Card className="bg-card/60">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold">{data.name}</h1>
                    {data.atc && (
                      <Badge variant="outline" className="font-mono">{data.atc}</Badge>
                    )}
                    {data.in_formulary ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">{t('library.detail.header.inFormularyBadge')}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">{t('library.detail.header.externalBadge')}</Badge>
                    )}
                  </div>
                  {data.atc_path.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1 flex-wrap">
                      {t('library.detail.page.atcPath')}
                      {data.atc_path.map((p, i) => (
                        <span key={p.code} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground">/</span>}
                          <span className="font-mono">{p.code}</span>
                          {p.name && <span>{p.name}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {(data.brand_names.length > 0 || data.hospital_codes.length > 0) && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {data.brand_names.length > 0 && <>{t('library.detail.page.brand')} {data.brand_names.join(' · ')}</>}
                      {data.brand_names.length > 0 && data.hospital_codes.length > 0 && ' · '}
                      {data.hospital_codes.length > 0 && <>{t('library.detail.page.hospitalCode')} {data.hospital_codes.join(' · ')}</>}
                    </div>
                  )}
                </div>
              </div>

              {data.sources.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  {t('library.detail.page.sourcesLabel')}
                  {data.sources.map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-0 px-0">
              <div className="border-b border-border/40 flex items-center gap-2 px-3">
                <button onClick={() => setTab('ddi')} className={tabClass('ddi')}>
                  {t('library.detail.page.ddiTab', { count: data.ddi_total })}
                </button>
                <button onClick={() => setTab('iv')} className={tabClass('iv')}>
                  {t('library.detail.page.ivTab', { count: ivCount })}
                </button>
              </div>

              <div className="py-4 px-4">
                {tab === 'ddi' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      {(['X', 'D', 'C', 'B', 'A'] as const).map((r) => {
                        const count = data.ddi_by_risk[r];
                        if (count === 0) return null;
                        const meta = RISK_META[r];
                        const active = riskFilter.has(r);
                        return (
                          <button
                            key={r}
                            onClick={() => toggleRisk(r)}
                            className={`px-2 py-0.5 rounded border text-[11px] transition-opacity ${meta.cls} ${active || riskFilter.size === 0 ? '' : 'opacity-30'}`}
                          >
                            {r} {count}
                          </button>
                        );
                      })}
                      {riskFilter.size > 0 && (
                        <button
                          onClick={() => setRiskFilter(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground ml-2"
                        >
                          {t('library.detail.page.clearFilter')}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {visibleRisks.map((r) => (
                        <RiskGroup
                          key={r}
                          risk={r}
                          items={grouped[r] || []}
                          defaultOpen={r === 'X' || r === 'D'}
                          editMode={editMode && isPharmOrAdmin}
                          onItemChange={onItemChange}
                        />
                      ))}
                      {data.ddi_total === 0 && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          {t('library.detail.page.noDdi')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'iv' && (
                  <IvCompatList items={data.iv_compatibility || []} />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-xs text-amber-400">
              <span className="font-semibold">{t('library.detail.gap.title')}</span>
              {t('library.detail.gap.body')}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
