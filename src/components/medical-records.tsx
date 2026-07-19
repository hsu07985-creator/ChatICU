import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { listRecordTemplates, createRecordTemplate, updateRecordTemplate, deleteRecordTemplate, type RecordTemplate, type RecordTemplateType } from '../lib/api/record-templates';
import type { LabData } from '../lib/api/lab-data';
import type { Medication } from '../lib/api/medications';
import { copyToClipboard } from '../lib/clipboard-utils';
import { useAuth } from '../lib/auth-context';
import { PharmacistSoapEditor, EMPTY_SOAP, type SoapDraft } from './pharmacist-soap-editor';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';
import { RECORD_TYPES, useRecordTypeConfig, BUILTIN_TEMPLATES, PHARMACIST_SOAP_TEMPLATE_NAME, isSoapTemplate, flattenSoapTemplate, type RecordType, type TemplateContent } from '../lib/medical-records/templates';
import { useDrafts } from './medical-records/use-drafts';
import { useClinicalPolish } from './medical-records/use-clinical-polish';
import { TemplatePopover } from './medical-records/template-popover';
import { DraftPolishPanes } from './medical-records/draft-polish-panes';

interface MedicalRecordsProps {
  patientId: string;
  patientName?: string;
  labData?: LabData | null;
  medications?: Medication[] | null;
}

// Re-export the shared types/data so existing consumers can keep importing
// them from this module path unchanged.
export type { RecordType, TemplateContent };
export {
  RECORD_TYPES,
  BUILTIN_TEMPLATES,
  PHARMACIST_SOAP_TEMPLATE_NAME,
  isSoapTemplate,
  flattenSoapTemplate,
};

/* ---------------- component ---------------- */

export function MedicalRecords({
  patientId,
  labData = null,
  medications = null,
}: MedicalRecordsProps) {
  const { user } = useAuth();
  const { t } = useTranslation('medical-records');
  const RECORD_TYPE_CONFIG = useRecordTypeConfig();
  // RAG layer removed — clinical polish is always available.
  const canPolish = true;
  const polishReason = '';

  const [recordType, setRecordType] = useState<RecordType>('progress-note');
  // Re-derive default once after auth hydrates. `userRoleInitialized` prevents
  // overriding user's manual record-type choice on subsequent role re-renders.
  const userRoleInitializedRef = useRef(false);
  useEffect(() => {
    if (userRoleInitializedRef.current) return;
    if (!user?.role) return;
    userRoleInitializedRef.current = true;
    if (user.role === 'pharmacist') setRecordType('medication-advice');
    else if (user.role === 'nurse') setRecordType('nursing-record');
  }, [user?.role]);

  const isPharmacistSoapMode =
    user?.role === 'pharmacist' && recordType === 'medication-advice';

  // Refinement panel (per-type UI state — not persisted). Declared early so the
  // patient/user-switch hook can clear it on reload.
  const [refinementInstruction, setRefinementInstruction] = useState('');

  // Drafts (per-type, per-patient, per-user, persisted). The switch callback
  // aborts in-flight polish/refine so a streaming chunk can't write into the
  // new patient's localStorage (P0-7) and resets the refine box.
  const clinicalPolishRef = useRef<{
    polishAbortRef: React.MutableRefObject<AbortController | null>;
    refineAbortRef: React.MutableRefObject<AbortController | null>;
  } | null>(null);
  const { drafts, updateDraft } = useDrafts(user?.id, patientId, () => {
    clinicalPolishRef.current?.polishAbortRef.current?.abort();
    clinicalPolishRef.current?.refineAbortRef.current?.abort();
  });

  const currentDraft = drafts[recordType];
  const inputContent = currentDraft.input;
  const polishedContent = currentDraft.polished;
  const polishedFrom = currentDraft.polishedFrom;
  const isPolishedStale = polishedContent.length > 0 && polishedFrom !== inputContent;
  // selectedTemplate is now persisted per-recordType in the draft so switching
  // tabs and back keeps the user oriented (which template was applied).
  const selectedTemplate = currentDraft.selectedTemplate;
  const setSelectedTemplate = (value: string) =>
    updateDraft(recordType, {
      selectedTemplate: value,
      // Clearing selection drops the snapshot too — there's no "applied"
      // template to compare against.
      ...(value ? {} : { selectedTemplateSnapshot: null }),
    });

  const setInputContent = (value: string) => updateDraft(recordType, { input: value });
  const setPolishedContent = (value: string) => updateDraft(recordType, { polished: value });

  const clearDraft = () => {
    updateDraft(recordType, {
      input: '',
      polished: '',
      polishedFrom: '',
      soap: { ...EMPTY_SOAP },
      polishedSoap: { ...EMPTY_SOAP },
      selectedTemplate: '',
      selectedTemplateSnapshot: null,
    });
    setRefinementInstruction('');
  };

  // Clinical polish + refine streaming lifecycle (abort controllers, loading
  // flags, chunk → draft wiring).
  const {
    polishAbortRef,
    refineAbortRef,
    isPolishing,
    isRefining,
    polishContent,
    refine,
  } = useClinicalPolish({ patientId, recordType, updateDraft, canPolish, polishReason });
  clinicalPolishRef.current = { polishAbortRef, refineAbortRef };

  // Templates (server-backed)
  const [serverTemplates, setServerTemplates] = useState<RecordTemplate[]>([]);
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');

  // Loading flags
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const [deletingTemplateName, setDeletingTemplateName] = useState<string | null>(null);
  const [updatingTemplateName, setUpdatingTemplateName] = useState<string | null>(null);

  const fetchTemplates = useCallback(async (type: RecordTemplateType) => {
    try {
      const templates = await listRecordTemplates(type);
      setServerTemplates(templates);
    } catch (err) {
      setServerTemplates([]);
      toast.error(t('templates.fetchError'), { id: 'record-templates-fetch' });
      console.error('listRecordTemplates failed', err);
    }
  }, []);

  useEffect(() => {
    fetchTemplates(recordType as RecordTemplateType);
  }, [recordType, fetchTemplates]);

  // Visible built-in templates after role-based gating. Used both by the
  // popover render AND by allTemplates lookup so handleApplyTemplate can't
  // resolve a hidden template via direct map access.
  const visibleBuiltins = useMemo(() => {
    const map: Record<string, TemplateContent> = { ...BUILTIN_TEMPLATES[recordType] };
    // PHARMACIST_SOAP_TEMPLATE_NAME is a SOAP-shaped template that only makes
    // sense in pharmacist mode (non-pharmacist users would see an empty S/O/A
    // and only the P plan-stub flatten, which is confusing). Hide for others.
    if (recordType === 'medication-advice' && user?.role !== 'pharmacist') {
      delete map[PHARMACIST_SOAP_TEMPLATE_NAME];
    }
    return map;
  }, [recordType, user?.role]);

  const allTemplates = useMemo(() => {
    const merged: Record<string, TemplateContent> = { ...visibleBuiltins };
    for (const t of serverTemplates) merged[t.name] = t.content;
    return merged;
  }, [visibleBuiltins, serverTemplates]);

  /* -------- actions -------- */

  // Stash for "還原上一版" — captured at apply time, cleared once user types
  // past the template snapshot (we infer from input !== snapshot in render).
  const stashedDraftRef = useRef<{
    input: string;
    soap: SoapDraft;
    selectedTemplate: string;
    selectedTemplateSnapshot: string | null;
  } | null>(null);

  // Pending confirmation modal for long-draft template apply.
  const [pendingTemplate, setPendingTemplate] = useState<{ name: string } | null>(null);

  const APPLY_CONFIRM_THRESHOLD = 80;

  const performApplyTemplate = (name: string, mode: 'replace' | 'append') => {
    const tpl = allTemplates[name];
    if (tpl === undefined) return;

    // Capture the snapshot string for templateDirty comparisons. SOAP templates
    // get flattened — that's also what we want to compare against if the user
    // is in non-pharmacist mode (the textarea sees flattened content). In
    // pharmacist SOAP mode the snapshot is less meaningful for textareas
    // because each section has its own editor, so we store the flattened
    // form as a coarse signal for "applied but unchanged".
    const snapshot = isSoapTemplate(tpl) ? flattenSoapTemplate(tpl) : tpl;

    // Stash current draft before mutating so the "還原上一版" chip can offer
    // a one-click revert until the user keeps typing.
    stashedDraftRef.current = {
      input: currentDraft.input,
      soap: { ...currentDraft.soap },
      selectedTemplate: currentDraft.selectedTemplate,
      selectedTemplateSnapshot: currentDraft.selectedTemplateSnapshot,
    };

    if (isSoapTemplate(tpl)) {
      if (isPharmacistSoapMode) {
        updateDraft(recordType, {
          soap: { ...EMPTY_SOAP, ...tpl.soap },
          polishedSoap: { ...EMPTY_SOAP },
          selectedTemplate: name,
          selectedTemplateSnapshot: snapshot,
        });
      } else {
        const flattened = flattenSoapTemplate(tpl);
        updateDraft(recordType, {
          input: mode === 'append' && currentDraft.input
            ? `${currentDraft.input}\n\n${flattened}`
            : flattened,
          selectedTemplate: name,
          selectedTemplateSnapshot: snapshot,
        });
      }
      return;
    }

    if (isPharmacistSoapMode) {
      // String template applied inside pharmacist 4-section mode — drop it into
      // P (plan) section so the template content isn't lost.
      const currentP = currentDraft.soap.p || '';
      const nextP = mode === 'append' && currentP
        ? `${currentP}\n\n${tpl}`
        : tpl;
      updateDraft(recordType, {
        soap: { ...currentDraft.soap, p: nextP },
        selectedTemplate: name,
        selectedTemplateSnapshot: snapshot,
      });
      return;
    }

    updateDraft(recordType, {
      input: mode === 'append' && currentDraft.input
        ? `${currentDraft.input}\n\n${tpl}`
        : tpl,
      selectedTemplate: name,
      selectedTemplateSnapshot: snapshot,
    });
  };

  const handleApplyTemplate = (name: string) => {
    setTemplatePopoverOpen(false);

    // Length signal — pharmacist SOAP also counted by joining all sections.
    const existingLen = isPharmacistSoapMode
      ? (currentDraft.soap.s + currentDraft.soap.o + currentDraft.soap.a + currentDraft.soap.p).trim().length
      : currentDraft.input.trim().length;

    // Empty draft, OR re-applying the same already-applied template → just go.
    if (
      existingLen === 0
      || currentDraft.selectedTemplate === name
    ) {
      performApplyTemplate(name, 'replace');
      return;
    }

    // Short draft (< 80 chars) → treat as scratch; replace with the chip
    // showing for one-click undo. Avoids interrupting the common flow.
    if (existingLen < APPLY_CONFIRM_THRESHOLD) {
      performApplyTemplate(name, 'replace');
      return;
    }

    // Long draft → confirm modal with replace / append / cancel.
    setPendingTemplate({ name });
  };

  const handleUndoApply = () => {
    const stashed = stashedDraftRef.current;
    if (!stashed) return;
    updateDraft(recordType, {
      input: stashed.input,
      soap: stashed.soap,
      selectedTemplate: stashed.selectedTemplate,
      selectedTemplateSnapshot: stashed.selectedTemplateSnapshot,
    });
    stashedDraftRef.current = null;
  };

  const handlePolishContent = () => {
    const rawTemplate = selectedTemplate ? allTemplates[selectedTemplate] : undefined;
    const templateContent = isSoapTemplate(rawTemplate)
      ? flattenSoapTemplate(rawTemplate)
      : rawTemplate;
    return polishContent({ inputContent, templateContent });
  };

  const handleRefine = () =>
    refine({
      inputContent,
      refinementInstruction,
      polishedContent,
      onSuccess: () => setRefinementInstruction(''),
    });

  const handleCopy = async () => {
    const usingPolished = polishedContent.trim().length > 0;
    // P2-12: strip markdown that won't render in HIS textareas. Conservative
    // — only **bold** and __bold__ pairs (italic `*` / `_` may appear
    // legitimately in clinical text like "monitor q4h*").
    const stripMarkdown = (s: string) =>
      s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
    const raw = usingPolished ? polishedContent : inputContent;
    const text = stripMarkdown(raw).trim();
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      updateDraft(recordType, { lastCopiedAt: Date.now() });
      toast.success(
        usingPolished ? t('polishedSection.copySuccessPolished') : t('polishedSection.copySuccessDraft'),
      );
    } else {
      toast.error(t('polishedSection.copyError'));
    }
  };

  // Asia/Taipei (UTC+8) display for "上次複製 N 分鐘前" hint.
  const lastCopiedHint = useMemo(() => {
    const ts = currentDraft.lastCopiedAt;
    if (!ts) return null;
    const elapsedMs = Date.now() - ts;
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return t('lastCopied.justNow');
    if (minutes < 60) return t('lastCopied.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('lastCopied.hoursAgo', { count: hours });
    return new Date(ts).toLocaleString(i18n.language, { timeZone: 'Asia/Taipei', hour12: false });
  }, [currentDraft.lastCopiedAt]);

  const handleSaveAsTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) {
      toast.error(t('templates.saveNoName'));
      return;
    }
    if (!newTemplateContent.trim()) {
      toast.error(t('templates.saveNoContent'));
      return;
    }
    if (name in BUILTIN_TEMPLATES[recordType]) {
      toast.error(t('templates.saveDuplicateName', { name }));
      return;
    }
    setIsSavingTemplate(true);
    try {
      const roleMap: Record<string, RecordTemplate['roleScope']> = {
        doctor: 'doctor',
        np: 'np',
        nurse: 'nurse',
        pharmacist: 'pharmacist',
        admin: 'admin',
      };
      await createRecordTemplate({
        name,
        recordType: recordType as RecordTemplateType,
        roleScope: roleMap[user?.role || ''] || 'all',
        content: newTemplateContent,
      });
      setNewTemplateName('');
      setNewTemplateContent('');
      setShowNewTemplate(false);
      toast.success(t('templates.saveSuccess', { name }));
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error(t('templates.saveError'));
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (name: string) => {
    const tpl = serverTemplates.find((t) => t.name === name);
    if (!tpl) {
      toast.error(t('templates.deleteCannotBuiltin'));
      return;
    }
    if (!tpl.canDelete) {
      toast.error(t('templates.deleteNoPermission'));
      return;
    }
    setDeletingTemplateName(name);
    try {
      await deleteRecordTemplate(tpl.id);
      if (selectedTemplate === name) setSelectedTemplate('');
      toast.success(t('templates.deleteSuccess', { name }));
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error(t('templates.deleteError'));
    } finally {
      setDeletingTemplateName(null);
    }
  };

  const handleUpdateTemplate = async (name: string) => {
    const tpl = serverTemplates.find((template) => template.name === name);
    if (!tpl) return;
    setUpdatingTemplateName(name);
    try {
      await updateRecordTemplate(tpl.id, { content: inputContent });
      toast.success(t('templates.updateSuccess', { name }));
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error(t('templates.updateError'));
    } finally {
      setUpdatingTemplateName(null);
    }
  };

  /* -------- derived -------- */

  const config = RECORD_TYPE_CONFIG[recordType];
  const Icon = config.icon;
  const canCopy = (polishedContent || inputContent).trim().length > 0;
  const editableSelectedTemplate = serverTemplates.find(
    (t) => t.name === selectedTemplate && t.canEdit,
  );
  const selectedTemplateIsBuiltin =
    !!selectedTemplate
    && !editableSelectedTemplate
    && Object.prototype.hasOwnProperty.call(BUILTIN_TEMPLATES[recordType], selectedTemplate);
  // Compare against the *snapshot at apply-time* so the dirty signal doesn't
  // lie if a teammate edits the server template after the user applied it.
  const templateDirty =
    !!selectedTemplate
    && currentDraft.selectedTemplateSnapshot !== null
    && inputContent.trim() !== ''
    && inputContent !== currentDraft.selectedTemplateSnapshot;
  // Server-template overwrite available only when the user owns it.
  const canOverwriteServerTemplate = templateDirty && !!editableSelectedTemplate;
  // Built-in template + user has edited the content → offer "save as custom".
  const canSaveBuiltinAsCustom = templateDirty && selectedTemplateIsBuiltin;
  // CLAUDE.md memory `feedback_no_icons_emoji`: 藥事工具頁面避免 emoji 與
  // 裝飾 icon。`medication-advice` is the pharma-tool surface for *any* role
  // (doctor / nurse / pharmacist), so strip Brain / Sparkles / Wand2 / Pill /
  // ArrowRight when this record-type is active. X / Copy / Plus / Trash2 /
  // Save / ChevronUp/Down / FileText etc. remain — those are functional.
  const showDecorativeIcons = recordType !== 'medication-advice';

  /* -------- render -------- */

  return (
    <div className="space-y-4">
      {/* Top bar: type chips + template popover + history trigger */}
      <div className="flex flex-wrap items-center gap-2">
        {RECORD_TYPES.map((type) => {
          const TypeIcon = RECORD_TYPE_CONFIG[type].icon;
          const active = recordType === type;
          // Dot fires when there's unfinished work in this tab. "Unfinished":
          //   - input/soap has text, OR
          //   - polished has text AND it doesn't match what we last polished
          //     from (i.e. draft has moved past the polished result, so even
          //     a previously-copied polish is now stale and needs attention).
          // In pharmacist medication-advice mode the draft lives in soap.*,
          // so flatten before measuring.
          const d = drafts[type];
          const isPharmacistType =
            type === 'medication-advice' && user?.role === 'pharmacist';
          const inputLike = isPharmacistType
            ? `${d.soap.s}${d.soap.o}${d.soap.a}${d.soap.p}`
            : d.input;
          const polishedHasUnfinishedWork =
            d.polished.length > 0 && d.polishedFrom !== d.input;
          const draftDirty = inputLike.length > 0 || polishedHasUnfinishedWork;
          return (
            <Button
              key={type}
              variant="outline"
              size="sm"
              className="transition-colors"
              style={
                active
                  ? { backgroundColor: '#1e293b', color: '#fff', borderColor: '#1e293b' }
                  : undefined
              }
              onClick={() => {
                setRecordType(type);
                setRefinementInstruction('');
              }}
            >
              <TypeIcon className="mr-1.5 h-4 w-4" />
              {RECORD_TYPE_CONFIG[type].label}
              {draftDirty && !active && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </Button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {/* Templates popover */}
          <TemplatePopover
            open={templatePopoverOpen}
            onOpenChange={setTemplatePopoverOpen}
            showDecorativeIcons={showDecorativeIcons}
            selectedTemplate={selectedTemplate}
            visibleBuiltins={visibleBuiltins}
            serverTemplates={serverTemplates}
            onApplyTemplate={handleApplyTemplate}
            deletingTemplateName={deletingTemplateName}
            onDeleteTemplate={handleDeleteTemplate}
            canOverwriteServerTemplate={canOverwriteServerTemplate}
            updatingTemplateName={updatingTemplateName}
            onUpdateTemplate={handleUpdateTemplate}
            canSaveBuiltinAsCustom={canSaveBuiltinAsCustom}
            inputContent={inputContent}
            showNewTemplate={showNewTemplate}
            setShowNewTemplate={setShowNewTemplate}
            newTemplateName={newTemplateName}
            setNewTemplateName={setNewTemplateName}
            newTemplateContent={newTemplateContent}
            setNewTemplateContent={setNewTemplateContent}
            isSavingTemplate={isSavingTemplate}
            onSaveAsTemplate={handleSaveAsTemplate}
          />

        </div>
      </div>

      {!canPolish && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {polishReason}
        </div>
      )}

      {isPharmacistSoapMode ? (
        <PharmacistSoapEditor
          patientId={patientId}
          canPolish={canPolish}
          polishReason={polishReason}
          soap={currentDraft.soap}
          polishedSoap={currentDraft.polishedSoap}
          onSoapChange={(next) => updateDraft(recordType, { soap: next })}
          onPolishedSoapChange={(next) =>
            updateDraft(recordType, { polishedSoap: next })
          }
          onSubmitted={() => updateDraft(recordType, { lastCopiedAt: Date.now() })}
          labData={labData}
          medications={medications}
        />
      ) : (
        <DraftPolishPanes
          config={config}
          Icon={Icon}
          showDecorativeIcons={showDecorativeIcons}
          canPolish={canPolish}
          polishReason={polishReason}
          inputContent={inputContent}
          setInputContent={setInputContent}
          polishedContent={polishedContent}
          setPolishedContent={setPolishedContent}
          isPolishedStale={isPolishedStale}
          canCopy={canCopy}
          isPolishing={isPolishing}
          isRefining={isRefining}
          onPolish={() => void handlePolishContent()}
          onStopPolish={() => polishAbortRef.current?.abort()}
          onClearDraft={clearDraft}
          onCopy={handleCopy}
          lastCopiedHint={lastCopiedHint}
          refinementInstruction={refinementInstruction}
          setRefinementInstruction={setRefinementInstruction}
          onRefine={() => void handleRefine()}
          onStopRefine={() => refineAbortRef.current?.abort()}
          selectedTemplate={selectedTemplate}
          selectedTemplateSnapshot={currentDraft.selectedTemplateSnapshot}
          hasStashedDraft={stashedDraftRef.current !== null}
          onUndoApply={handleUndoApply}
          onRemoveTemplate={() => setSelectedTemplate('')}
        />
      )}

      {/* Long-draft template-apply confirm: replace / append / cancel.
          Short drafts (< 80 chars) skip this and apply directly with an
          inline "還原上一版" chip. */}
      <Dialog open={!!pendingTemplate} onOpenChange={(open) => !open && setPendingTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('templates.applyConfirmTitle', { name: pendingTemplate?.name })}</DialogTitle>
            <DialogDescription>
              {t('templates.applyConfirmDescription', { threshold: APPLY_CONFIRM_THRESHOLD })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingTemplate(null)}
            >
              {t('templates.cancelButton')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (pendingTemplate) {
                  performApplyTemplate(pendingTemplate.name, 'append');
                  setPendingTemplate(null);
                }
              }}
            >
              {t('templates.applyConfirmAppend')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingTemplate) {
                  performApplyTemplate(pendingTemplate.name, 'replace');
                  setPendingTemplate(null);
                }
              }}
            >
              {t('templates.applyConfirmReplace')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
