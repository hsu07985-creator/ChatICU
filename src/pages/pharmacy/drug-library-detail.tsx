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

const RELIABILITY_META: Record<string, { cls: string; tip: string }> = {
  Excellent: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：優' },
  Good: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：良' },
  Fair: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中等' },
  Poor: { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30', tip: '證據強度：弱' },
  Intermediate: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中等' },
  'Intermediate-High': { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：中-高' },
  'Intermediate-Low': { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中-低' },
};

function formatTaipei(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

// ── Edit-mode action rail per DDI card ─────────────────────────────────
function DdiEditRail({
  item,
  onChange,
}: {
  item: DdiDetailItem;
  onChange: (updates: Partial<DdiDetailItem>) => void;
}) {
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
      toast.success('備註已儲存');
    } catch (e: any) {
      toast.error(e?.message || '儲存失敗');
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
      toast.success(`已標記核對 by ${r.verified_by_name}`);
    } catch (e: any) {
      toast.error(e?.message || '失敗');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="border-t border-border/30 pt-2 mt-2 space-y-2">
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground">藥師備註</div>
        <Textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="例：本院共識為 SAH 病人 Aspirin + Warfarin 不警告，依神內 2024 SOP"
          className="text-xs min-h-[60px]"
          maxLength={2000}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{noteDraft.length} / 2000</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!noteDirty || savingNote}
            onClick={saveNote}
            className="h-7 text-xs"
          >
            {savingNote && <Loader2 className="size-3 mr-1 animate-spin" />}
            儲存備註
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
          標記已核對
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setProposeOpen(true)}
          className="h-7 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
        >
          提議 override
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeprecateOpen(true)}
          className="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
        >
          標 deprecated
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setHistoryOpen(true)}
          className="h-7 text-xs ml-auto"
        >
          歷史
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
      toast.success('已送出提議，等待 admin 核准');
      onProposed();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '失敗');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>提議院內 override</DialogTitle>
          <DialogDescription>
            來源規則：「× {ruleLabel}」目前為 <Badge variant="outline" className="text-[10px]">{sourceRisk}</Badge>
            。提議後須經 admin 核准（4-eye）才會生效。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">院內覆寫為：</div>
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
                X (Avoid combination) 永遠禁止降級（僅可維持 X）
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">院內共識理由（≥30 字）</div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：本院神內 2024 共識，SAH 病人在嚴密 BP 監測下可允許此組合..."
              className="min-h-[80px]"
              maxLength={1000}
            />
            <div className="text-[10px] text-muted-foreground">{reason.length} / 1000（最少 30 字）</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">證據引用（≥10 字 — PMID / UpToDate / 院內 SOP 文號）</div>
            <Textarea
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              placeholder="例：PMID:32887891；院內 SOP-NEU-2024-03；UpToDate Vasopressors topic"
              className="min-h-[50px]"
              maxLength={500}
            />
            <div className="text-[10px] text-muted-foreground">{citation.length} / 500（最少 10 字）</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">需重新核驗的天數（30-730）</div>
            <input
              type="number"
              min={30}
              max={730}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value) || 365)}
              className="w-32 px-2 py-1 text-sm rounded border bg-background"
            />
            <span className="ml-2 text-xs text-muted-foreground">天後到期</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button disabled={!ok || submitting} onClick={submit}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            送出提議
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
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ok = reason.trim().length >= 30;
  const submit = async () => {
    if (!ok) return;
    setSubmitting(true);
    try {
      await deprecateRule(ruleId, reason.trim());
      toast.success('已標記 deprecated（reload 後從清單消失）');
      onDeprecated();
      // Reload page so the row disappears (is_active=FALSE filter)
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      toast.error(e?.message || '失敗');
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>標記 deprecated</DialogTitle>
          <DialogDescription>
            此規則「× {ruleLabel}」將被軟刪除（is_active = FALSE），
            後續所有藥師查詢、API 都不會再回傳這條。可隨時 restore。
            必填理由（≥30 字，存進稽核 log）。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例：與 Lexicomp 2026.07 撤銷規則，本院神內 SOP 也不再採用"
          className="min-h-[100px]"
          maxLength={500}
        />
        <div className="text-xs text-muted-foreground">
          {reason.length} / 500（最少 30 字）
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button
            variant="destructive"
            disabled={!ok || submitting}
            onClick={submit}
          >
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            確認標記
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
          <DialogTitle>規則異動歷史</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{ruleId}</span> 的所有編輯紀錄（最多 200 筆，新→舊）
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {loading && (
            <div className="text-sm text-muted-foreground py-4 text-center flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> 載入歷史
            </div>
          )}
          {history && history.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              尚無編輯紀錄
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
                  <span className="text-muted-foreground">{formatTaipei(h.created_at)}</span>
                </div>
                {h.reason && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">理由：</span>{h.reason}
                  </div>
                )}
                {h.before && (
                  <div className="text-[10px] text-muted-foreground">
                    Before: <code>{JSON.stringify(h.before)}</code>
                  </div>
                )}
                {h.after && (
                  <div className="text-[10px] text-muted-foreground">
                    After: <code>{JSON.stringify(h.after)}</code>
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
  const reliability = item.reliability ? RELIABILITY_META[item.reliability] : null;
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
            {reliability && (
              <Badge variant="outline" className={`text-[10px] ${reliability.cls}`} title={reliability.tip}>
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
              <span className="text-muted-foreground">原始來源：</span>
              <span className={`px-1.5 py-0.5 rounded border ${RISK_META[sourceRisk]?.cls || ''} font-mono text-[11px]`}>{sourceRisk}</span>
              <span className="text-muted-foreground">→ 院內覆寫：</span>
              <span className={`px-1.5 py-0.5 rounded border ${RISK_META[item.risk_rating]?.cls || ''} font-mono text-[11px] font-semibold`}>{item.risk_rating}</span>
              <span className="text-blue-400 ml-auto">
                by {item.overridden_by_name || item.overridden_by}
              </span>
            </div>
            {item.override_reason && (
              <div><span className="text-muted-foreground">理由：</span>{item.override_reason}</div>
            )}
            {item.override_citation && (
              <div><span className="text-muted-foreground">證據：</span>{item.override_citation}</div>
            )}
            {item.override_expires_at && (
              <div className="text-muted-foreground">
                到期：{formatTaipei(item.override_expires_at)}
              </div>
            )}
          </div>
        )}

        {item.mechanism && (
          <div className="text-xs">
            <span className="text-muted-foreground">機制：</span>
            <span>{item.mechanism}</span>
          </div>
        )}
        {item.management && (
          <div className="text-xs">
            <span className="text-muted-foreground">處置：</span>
            <span>{item.management}</span>
          </div>
        )}
        {item.discussion && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">詳細討論</summary>
            <div className="mt-1 pl-2 border-l-2 border-border/40 whitespace-pre-wrap">
              {item.discussion}
            </div>
          </details>
        )}
        {item.pubmed_count > 0 && (
          <div className="text-xs text-muted-foreground">
            {item.pubmed_count} 篇文獻引用
          </div>
        )}

        {/* Read-mode pinned note + verify status */}
        {!editMode && item.pharmacist_note && (
          <div className="text-xs bg-blue-500/5 border border-blue-500/20 rounded p-2 mt-1">
            <span className="text-blue-400 font-medium">藥師備註：</span>
            <span className="whitespace-pre-wrap">{item.pharmacist_note}</span>
          </div>
        )}
        {!editMode && item.last_verified_at && (
          <div className="text-[10px] text-emerald-400">
            ✓ 已核對 {formatTaipei(item.last_verified_at)}
            {(item.verified_by_name || item.verified_by) && (
              <> by {item.verified_by_name || item.verified_by}</>
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
  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        系統未收錄此藥的 IV 相容性資料
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
                    {it.solution && <Badge variant="outline" className="text-[10px]">溶液 {it.solution}</Badge>}
                    {it.time_stability && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        穩定 {it.time_stability}
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
      {sectionRender('相容', compatible, 'text-emerald-400')}
      {sectionRender('不相容', incompatible, 'text-rose-400')}
    </div>
  );
}

type TabKey = 'ddi' | 'iv';

export function DrugLibraryDetailPage() {
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
      .catch((e) => setError(e?.message || '載入失敗'))
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
          <ArrowLeft className="size-4 mr-1" /> 回藥物管理
        </Button>
        {isPharmOrAdmin && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">模式：</span>
            <Button
              size="sm"
              variant={editMode ? 'outline' : 'default'}
              onClick={() => setEditMode(false)}
              className="h-7 text-xs"
            >
              檢視
            </Button>
            <Button
              size="sm"
              variant={editMode ? 'default' : 'outline'}
              onClick={() => setEditMode(true)}
              className="h-7 text-xs"
            >
              編輯
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> 載入中
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
            找不到藥物 <span className="font-mono">{name}</span> 的資料
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
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">院內 formulary</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">院外</Badge>
                    )}
                  </div>
                  {data.atc_path.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1 flex-wrap">
                      ATC 階層：
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
                      {data.brand_names.length > 0 && <>商品 {data.brand_names.join(' · ')}</>}
                      {data.brand_names.length > 0 && data.hospital_codes.length > 0 && ' · '}
                      {data.hospital_codes.length > 0 && <>院內代碼 {data.hospital_codes.join(' · ')}</>}
                    </div>
                  )}
                </div>
              </div>

              {data.sources.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  資料源：
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
                  交互作用 ({data.ddi_total})
                </button>
                <button onClick={() => setTab('iv')} className={tabClass('iv')}>
                  IV 相容性 ({ivCount})
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
                          清除篩選
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
                          系統未收錄此藥的交互作用規則
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
              <span className="font-semibold">資料缺口提示：</span>
              未列規則 ≠ 安全。本系統來源主要為 Lexicomp + MICROMEDEX，罕見組合 / 中草藥 / 食物交互可能未涵蓋。IV 相容性以 Trissel's Handbook 為主，未列組合請諮詢藥劑科。
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
