import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { useTranslation } from 'react-i18next';
import {
  type ProposalItem,
  approveProposal,
  listProposals,
  rejectProposal,
} from '../../lib/api/drug-library';

const RISK_CLS: Record<string, string> = {
  X: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  D: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  C: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  B: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  A: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

const STATUS_FILTERS = [
  { key: 'pending', labelKey: 'library.proposals.statusFilters.pending' },
  { key: 'approved', labelKey: 'library.proposals.statusFilters.approved' },
  { key: 'rejected', labelKey: 'library.proposals.statusFilters.rejected' },
  { key: 'withdrawn', labelKey: 'library.proposals.statusFilters.withdrawn' },
  { key: 'all', labelKey: 'library.proposals.statusFilters.all' },
] as const;

function formatTaipei(iso: string | null, locale = 'zh-TW'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { timeZone: 'Asia/Taipei', hour12: false });
}

function ApproveDialog({
  open,
  proposal,
  onClose,
  onDone,
}: {
  open: boolean;
  proposal: ProposalItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation('pharmacy');
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSelf = proposal && user && proposal.proposer_id === user.id;

  const submit = async () => {
    if (!proposal || isSelf) return;
    setSubmitting(true);
    try {
      const r = await approveProposal(proposal.id, comment.trim() || undefined);
      toast.success(t('library.proposals.approveDialog.successWith', { risk: r.applied_risk }));
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || t('library.proposals.approveDialog.errorFallback'));
      setSubmitting(false);
    }
  };

  if (!proposal) return null;
  const newRisk = (proposal.proposed_changes?.override_risk_rating as string) || '?';
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.proposals.approveDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('library.proposals.approveDialog.drugPair', { a: proposal.source_drug1, b: proposal.source_drug2 })}
            <Badge variant="outline" className={RISK_CLS[proposal.source_risk_rating || '']}>{proposal.source_risk_rating}</Badge>
            {' → '}<Badge variant="outline" className={RISK_CLS[newRisk]}>{newRisk}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs space-y-1.5 bg-accent/30 rounded p-2">
          <div><span className="text-muted-foreground">{t('library.proposals.approveDialog.proposer')}</span>{proposal.proposer_name}{t('library.proposals.approveDialog.proposerSuffix', { role: proposal.proposer_role })}</div>
          <div><span className="text-muted-foreground">{t('library.proposals.approveDialog.reason')}</span>{proposal.reason}</div>
          <div><span className="text-muted-foreground">{t('library.proposals.approveDialog.evidence')}</span>{proposal.citation}</div>
          <div><span className="text-muted-foreground">{t('library.proposals.approveDialog.proposedAt')}</span>{formatTaipei(proposal.created_at, i18n.language)}</div>
        </div>

        {isSelf && (
          <div className="text-xs text-rose-400">
            {t('library.proposals.approveDialog.selfBlock')}
          </div>
        )}

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('library.proposals.approveDialog.commentPlaceholder')}
          maxLength={500}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('library.proposals.approveDialog.cancel')}</Button>
          <Button disabled={!!isSelf || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            {t('library.proposals.approveDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  open,
  proposal,
  onClose,
  onDone,
}: {
  open: boolean;
  proposal: ProposalItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('pharmacy');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ok = comment.trim().length >= 10;

  const submit = async () => {
    if (!proposal || !ok) return;
    setSubmitting(true);
    try {
      await rejectProposal(proposal.id, comment.trim());
      toast.success(t('library.proposals.rejectDialog.success'));
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || t('library.proposals.rejectDialog.errorFallback'));
      setSubmitting(false);
    }
  };

  if (!proposal) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.proposals.rejectDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('library.proposals.rejectDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('library.proposals.rejectDialog.placeholder')}
          className="min-h-[80px]"
          maxLength={500}
        />
        <div className="text-[10px] text-muted-foreground">{t('library.proposals.rejectDialog.charCount', { count: comment.length })}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('library.proposals.rejectDialog.cancel')}</Button>
          <Button variant="destructive" disabled={!ok || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            {t('library.proposals.rejectDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DrugLibraryProposalsPage() {
  const { t, i18n } = useTranslation('pharmacy');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]['key']>('pending');
  const [items, setItems] = useState<ProposalItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<ProposalItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProposalItem | null>(null);

  const fetch = () => {
    setLoading(true);
    setError(null);
    listProposals(filter)
      .then((d) => setItems(d.items))
      .catch((e) => setError(e?.message || t('library.proposals.loadError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isAdmin) fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6 max-w-screen-md">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {t('library.proposals.noAccess')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-4 max-w-screen-xl">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/pharmacy/drug-library')}
          className="-ml-2"
        >
          <ArrowLeft className="size-4 mr-1" /> {t('library.proposals.header.back')}
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('library.proposals.header.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('library.proposals.header.subtitle')}
        </p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded text-xs border transition-colors ${
              filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {t('library.proposals.loading')}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="py-3 text-sm text-rose-400">{error}</CardContent>
        </Card>
      )}

      {items && items.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {t('library.proposals.noProposalsFor', { label: t(STATUS_FILTERS.find(f => f.key === filter)?.labelKey || '') })}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items?.map((p) => {
          const newRisk = (p.proposed_changes?.override_risk_rating as string) || '?';
          return (
            <Card key={p.id} className="border-border/40">
              <CardContent className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <span>{p.source_drug1}</span>
                      <span className="text-muted-foreground">×</span>
                      <span>{p.source_drug2}</span>
                      <Link
                        to={`/pharmacy/drug-library/${encodeURIComponent(p.source_drug1 || '')}`}
                        className="text-xs text-blue-400 hover:underline inline-flex items-center gap-0.5"
                      >
                        {t('library.proposals.card.viewRules')} <ExternalLink className="size-3" />
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-muted-foreground">{t('library.proposals.card.sourcePrefix', { ref: p.source_ref || '?' })}</span>
                      <Badge variant="outline" className={RISK_CLS[p.source_risk_rating || '']}>{p.source_risk_rating}</Badge>
                      <span className="text-muted-foreground">{t('library.proposals.card.proposedTo')}</span>
                      <Badge variant="outline" className={RISK_CLS[newRisk]}>{newRisk}</Badge>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{t('library.proposals.card.byAuthor', { name: p.proposer_name, role: p.proposer_role })}</div>
                    <div>{formatTaipei(p.created_at, i18n.language)}</div>
                  </div>
                </div>

                <div className="text-xs space-y-1 bg-accent/20 rounded p-2">
                  <div><span className="text-muted-foreground">{t('library.proposals.card.reason')}</span>{p.reason}</div>
                  <div><span className="text-muted-foreground">{t('library.proposals.card.evidence')}</span>{p.citation || '—'}</div>
                </div>

                {p.status === 'pending' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => setApproveTarget(p)}
                      disabled={p.proposer_id === user?.id}
                      className="h-7 text-xs"
                    >
                      {t('library.proposals.card.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectTarget(p)}
                      className="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                    >
                      {t('library.proposals.card.reject')}
                    </Button>
                    {p.proposer_id === user?.id && (
                      <span className="text-[10px] text-muted-foreground ml-2">
                        {t('library.proposals.card.selfWarn')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs pt-1">
                    <Badge
                      variant="outline"
                      className={
                        p.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                        p.status === 'rejected' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                        'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                      }
                    >
                      {p.status === 'approved' ? t('library.proposals.card.approved') : p.status === 'rejected' ? t('library.proposals.card.rejected') : t('library.proposals.card.withdrawn')}
                    </Badge>
                    {p.approver_name && (
                      <span className="text-muted-foreground">
                        {t('library.proposals.card.approvedBy', { name: p.approver_name, timestamp: formatTaipei(p.decided_at, i18n.language) })}
                      </span>
                    )}
                    {p.decision_comment && (
                      <span className="text-muted-foreground">{t('library.proposals.card.decisionComment', { comment: p.decision_comment })}</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ApproveDialog
        open={!!approveTarget}
        proposal={approveTarget}
        onClose={() => setApproveTarget(null)}
        onDone={() => { setApproveTarget(null); fetch(); }}
      />
      <RejectDialog
        open={!!rejectTarget}
        proposal={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onDone={() => { setRejectTarget(null); fetch(); }}
      />
    </div>
  );
}
