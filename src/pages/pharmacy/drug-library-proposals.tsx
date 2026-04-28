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
  { key: 'pending', label: '待批准' },
  { key: 'approved', label: '已核准' },
  { key: 'rejected', label: '已拒絕' },
  { key: 'withdrawn', label: '已撤回' },
  { key: 'all', label: '全部' },
] as const;

function formatTaipei(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
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
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSelf = proposal && user && proposal.proposer_id === user.id;

  const submit = async () => {
    if (!proposal || isSelf) return;
    setSubmitting(true);
    try {
      const r = await approveProposal(proposal.id, comment.trim() || undefined);
      toast.success(`已核准，套用 risk = ${r.applied_risk}`);
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '失敗');
      setSubmitting(false);
    }
  };

  if (!proposal) return null;
  const newRisk = (proposal.proposed_changes?.override_risk_rating as string) || '?';
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>核准提議</DialogTitle>
          <DialogDescription>
            「{proposal.source_drug1} × {proposal.source_drug2}」
            風險將從 <Badge variant="outline" className={RISK_CLS[proposal.source_risk_rating || '']}>{proposal.source_risk_rating}</Badge>
            {' '}覆寫為 <Badge variant="outline" className={RISK_CLS[newRisk]}>{newRisk}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs space-y-1.5 bg-accent/30 rounded p-2">
          <div><span className="text-muted-foreground">提議者：</span>{proposal.proposer_name}（{proposal.proposer_role}）</div>
          <div><span className="text-muted-foreground">理由：</span>{proposal.reason}</div>
          <div><span className="text-muted-foreground">證據：</span>{proposal.citation}</div>
          <div><span className="text-muted-foreground">提議時間：</span>{formatTaipei(proposal.created_at)}</div>
        </div>

        {isSelf && (
          <div className="text-xs text-rose-400">
            ⚠ 不可核准自己的提議（4-eye 簽核）
          </div>
        )}

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="（選填）核准備註：例如同意此 SOP，每年複審"
          maxLength={500}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button disabled={!!isSelf || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            核准並套用
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
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ok = comment.trim().length >= 10;

  const submit = async () => {
    if (!proposal || !ok) return;
    setSubmitting(true);
    try {
      await rejectProposal(proposal.id, comment.trim());
      toast.success('已拒絕提議');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '失敗');
      setSubmitting(false);
    }
  };

  if (!proposal) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>拒絕提議</DialogTitle>
          <DialogDescription>
            拒絕原因將存進稽核日誌（≥10 字）
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="例：證據強度不足；建議補 PMID 後重新提議"
          className="min-h-[80px]"
          maxLength={500}
        />
        <div className="text-[10px] text-muted-foreground">{comment.length} / 500（最少 10 字）</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="destructive" disabled={!ok || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            拒絕
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DrugLibraryProposalsPage() {
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
      .catch((e) => setError(e?.message || '載入失敗'))
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
            僅 admin 角色可進入此頁
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
          <ArrowLeft className="size-4 mr-1" /> 回藥物資料庫
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">提議審核</h1>
        <p className="text-sm text-muted-foreground">
          藥師提出的院內 override 提議，由 admin 4-eye 簽核後生效
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
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> 載入中
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
            目前沒有「{STATUS_FILTERS.find(f => f.key === filter)?.label}」的提議
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
                        看規則 <ExternalLink className="size-3" />
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-muted-foreground">來源 {p.source_ref || '?'}：</span>
                      <Badge variant="outline" className={RISK_CLS[p.source_risk_rating || '']}>{p.source_risk_rating}</Badge>
                      <span className="text-muted-foreground">→ 提議覆寫為：</span>
                      <Badge variant="outline" className={RISK_CLS[newRisk]}>{newRisk}</Badge>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>by {p.proposer_name}（{p.proposer_role}）</div>
                    <div>{formatTaipei(p.created_at)}</div>
                  </div>
                </div>

                <div className="text-xs space-y-1 bg-accent/20 rounded p-2">
                  <div><span className="text-muted-foreground">理由：</span>{p.reason}</div>
                  <div><span className="text-muted-foreground">證據：</span>{p.citation || '—'}</div>
                </div>

                {p.status === 'pending' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => setApproveTarget(p)}
                      disabled={p.proposer_id === user?.id}
                      className="h-7 text-xs"
                    >
                      核准
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectTarget(p)}
                      className="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                    >
                      拒絕
                    </Button>
                    {p.proposer_id === user?.id && (
                      <span className="text-[10px] text-muted-foreground ml-2">
                        ⚠ 不可核准自己的提議
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
                      {p.status === 'approved' ? '已核准' : p.status === 'rejected' ? '已拒絕' : '已撤回'}
                    </Badge>
                    {p.approver_name && (
                      <span className="text-muted-foreground">
                        by {p.approver_name} · {formatTaipei(p.decided_at)}
                      </span>
                    )}
                    {p.decision_comment && (
                      <span className="text-muted-foreground">— {p.decision_comment}</span>
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
