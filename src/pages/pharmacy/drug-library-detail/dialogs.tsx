import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/textarea';
import {
  type RuleHistoryEntry,
  deprecateRule,
  getRuleHistory,
  proposeOverride,
} from '../../../lib/api/drug-library';
import { formatTaipei } from './shared';

export function ProposeOverrideDialog({
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

export function DeprecateDialog({
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

export function HistoryDialog({
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
