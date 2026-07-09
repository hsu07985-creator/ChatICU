import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import {
  type DdiDetailItem,
  updateRuleNote,
  verifyRule,
} from '../../../lib/api/drug-library';
import { DeprecateDialog, HistoryDialog, ProposeOverrideDialog } from './dialogs';

// ── Edit-mode action rail per DDI card ─────────────────────────────────
export function DdiEditRail({
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
