import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { streamPolishClinicalText, PolishStreamError } from '../lib/api/ai';
import {
  listRecordTemplates,
  createRecordTemplate,
  updateRecordTemplate,
  deleteRecordTemplate,
  type RecordTemplate,
  type RecordTemplateType,
} from '../lib/api/record-templates';
import type { LabData } from '../lib/api/lab-data';
import type { Medication } from '../lib/api/medications';
import { copyToClipboard } from '../lib/clipboard-utils';
import { isCmdEnter } from '../lib/dom/key';
import { useAuth } from '../lib/auth-context';
import {
  PharmacistSoapEditor,
  EMPTY_SOAP,
  type SoapDraft,
} from './pharmacist-soap-editor';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { ButtonLoadingIndicator } from './ui/button-loading-indicator';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  FileText,
  Pill,
  ClipboardList,
  Brain,
  Copy,
  Sparkles,
  Plus,
  Trash2,
  X,
  ArrowRight,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';

interface MedicalRecordsProps {
  patientId: string;
  patientName?: string;
  labData?: LabData | null;
  medications?: Medication[] | null;
}

type RecordType = 'progress-note' | 'medication-advice' | 'nursing-record';

const RECORD_TYPES: RecordType[] = ['progress-note', 'medication-advice', 'nursing-record'];

type RecordTypeConfig = { label: string; icon: typeof FileText; description: string; placeholder: string; polishLabel: string };

// Icons stay static; labels/strings come from t() so language switches re-render.
const RECORD_TYPE_ICONS: Record<RecordType, typeof FileText> = {
  'progress-note': FileText,
  'medication-advice': Pill,
  'nursing-record': ClipboardList,
};

function useRecordTypeConfig(): Record<RecordType, RecordTypeConfig> {
  const { t } = useTranslation('medical-records');
  return {
    'progress-note': {
      label: t('recordTypes.progressNote.label'),
      icon: RECORD_TYPE_ICONS['progress-note'],
      description: t('recordTypes.progressNote.description'),
      placeholder: t('recordTypes.progressNote.placeholder'),
      polishLabel: t('recordTypes.progressNote.polishLabel'),
    },
    'medication-advice': {
      label: t('recordTypes.medicationAdvice.label'),
      icon: RECORD_TYPE_ICONS['medication-advice'],
      description: t('recordTypes.medicationAdvice.description'),
      placeholder: t('recordTypes.medicationAdvice.placeholder'),
      polishLabel: t('recordTypes.medicationAdvice.polishLabel'),
    },
    'nursing-record': {
      label: t('recordTypes.nursingRecord.label'),
      icon: RECORD_TYPE_ICONS['nursing-record'],
      description: t('recordTypes.nursingRecord.description'),
      placeholder: t('recordTypes.nursingRecord.placeholder'),
      polishLabel: t('recordTypes.nursingRecord.polishLabel'),
    },
  };
}

type TemplateContent = string | { soap: SoapDraft };

const PHARMACIST_SOAP_TEMPLATE_NAME = '藥師 SOAP';

function isSoapTemplate(tpl: TemplateContent | undefined): tpl is { soap: SoapDraft } {
  return !!tpl && typeof tpl !== 'string' && typeof tpl.soap === 'object';
}

function flattenSoapTemplate(tpl: { soap: SoapDraft }): string {
  const { s, o, a, p } = tpl.soap;
  const sections = [
    { key: 'S', value: s },
    { key: 'O', value: o },
    { key: 'A', value: a },
    { key: 'P', value: p },
  ].filter(({ value }) => value && value.trim().length > 0);
  // When only one section has content, drop the section header. The polish
  // prompt expects no synthetic 'P:' / 'A:' prefix unless the pharmacist
  // wrote one — a leaked header would echo back into the AI output.
  if (sections.length === 1) return sections[0].value;
  return sections.map(({ key, value }) => `${key}:\n${value}`).join('\n\n');
}

const BUILTIN_TEMPLATES: Record<RecordType, Record<string, TemplateContent>> = {
  'progress-note': {
    'SOAP 格式': `S (Subjective):
O (Objective):
  Physical exam:
A (Assessment):
P (Plan):`,
    '簡要紀錄': `主訴:
目前狀況:
處置計畫:`,
  },
  'medication-advice': {
    [PHARMACIST_SOAP_TEMPLATE_NAME]: {
      soap: {
        s: '',
        o: '',
        a: '',
        p: '1.Please consider...\n2.Continue to monitor...',
      },
    },
    '劑量調整建議': `藥品名稱:
目前劑量:
建議調整:
調整原因:
監測項目:`,
    '新增藥品建議': `建議藥品:
適應症:
建議劑量:
給藥途徑:
注意事項:`,
  },
  'nursing-record': {
    '一般交班': `病患意識:
生命徵象:
呼吸器設定:
管路:
輸液:
尿量:
特殊狀況:`,
    '鎮靜評估': `RASS Score:
CAM-ICU:
使用鎮靜劑:
劑量調整:
呼吸型態:
建議:`,
    '管路評估': `氣管內管:
中心靜脈導管:
動脈導管:
尿管:
鼻胃管:
其他管路:`,
    '傷口護理': `傷口位置:
傷口大小:
傷口深度:
滲液:
紅腫熱痛:
換藥頻率:
使用敷料:`,
  },
};

/* ---------------- localStorage 草稿 / 歷史 ---------------- */

type DraftEntry = {
  input: string;
  polished: string;
  polishedFrom: string;
  soap: SoapDraft;
  polishedSoap: SoapDraft;
  /** Name of the currently-applied template ('' = none). Persisted so that
   *  switching record-type and back doesn't lose template context. */
  selectedTemplate: string;
  /** The template content as it was at apply-time. Used to compute
   *  `templateDirty` against the user's *original* applied snapshot rather
   *  than the live (possibly mutated) server template. */
  selectedTemplateSnapshot: string | null;
  /** Last time `handleCopy` succeeded for this draft (Asia/Taipei display);
   *  surfaces "上次複製 N 分鐘前" hint. */
  lastCopiedAt?: number;
};
type Drafts = Record<RecordType, DraftEntry>;

const makeEmptyDraft = (): DraftEntry => ({
  input: '',
  polished: '',
  polishedFrom: '',
  soap: { ...EMPTY_SOAP },
  polishedSoap: { ...EMPTY_SOAP },
  selectedTemplate: '',
  selectedTemplateSnapshot: null,
});

const EMPTY_DRAFT: DraftEntry = makeEmptyDraft();
const EMPTY_DRAFTS: Drafts = {
  'progress-note': makeEmptyDraft(),
  'medication-advice': makeEmptyDraft(),
  'nursing-record': makeEmptyDraft(),
};

const LEGACY_DRAFT_KEY = (patientId: string) => `chaticu-draft-${patientId}`;
const draftKey = (userId: string | null | undefined, patientId: string): string | null =>
  userId ? `chaticu-draft-${userId}-${patientId}` : null;

function mergeDraft(parsed: Partial<DraftEntry> | undefined): DraftEntry {
  const base = makeEmptyDraft();
  if (!parsed) return base;
  return {
    ...base,
    ...parsed,
    soap: { ...base.soap, ...(parsed.soap || {}) },
    polishedSoap: { ...base.polishedSoap, ...(parsed.polishedSoap || {}) },
  };
}

function parseDraftsBlob(raw: string | null): Drafts {
  if (!raw) return { ...EMPTY_DRAFTS };
  try {
    const parsed = JSON.parse(raw) as Partial<Drafts>;
    return {
      'progress-note': mergeDraft(parsed['progress-note']),
      'medication-advice': mergeDraft(parsed['medication-advice']),
      'nursing-record': mergeDraft(parsed['nursing-record']),
    };
  } catch {
    return { ...EMPTY_DRAFTS };
  }
}

function loadDrafts(userId: string | null | undefined, patientId: string): Drafts {
  const key = draftKey(userId, patientId);
  // Pre-auth render: serve empty drafts; the post-auth useEffect will reload.
  if (!key) return { ...EMPTY_DRAFTS };
  try {
    let raw = localStorage.getItem(key);
    // One-shot migration: drafts saved before user-namespacing existed under
    // `chaticu-draft-${patientId}`. Move them into the namespaced key for the
    // currently logged-in user (best guess) and remove the legacy entry so
    // a different user on the same workstation can't see it.
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_DRAFT_KEY(patientId));
      if (legacy) {
        localStorage.setItem(key, legacy);
        try {
          localStorage.removeItem(LEGACY_DRAFT_KEY(patientId));
        } catch { /* ignore */ }
        raw = legacy;
      }
    }
    return parseDraftsBlob(raw);
  } catch {
    return { ...EMPTY_DRAFTS };
  }
}

function saveDrafts(userId: string | null | undefined, patientId: string, drafts: Drafts) {
  const key = draftKey(userId, patientId);
  if (!key) return; // can't persist without a user — caller will retry post-hydrate
  try {
    localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // localStorage quota likely. Surface once per session so user knows
    // their drafts may not survive reload, instead of failing silently.
    if (!quotaToastShown) {
      quotaToastShown = true;
      toast.error(i18n.t('draftStorage.quotaWarning', { ns: 'medical-records' }), {
        id: 'draft-quota',
      });
    }
  }
}

let quotaToastShown = false;

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

  // Abort controllers (declared early so patient-switch effect can clear them).
  // Polish takes 10–20s; let the user cancel and prevent cross-patient pollution.
  const polishAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);

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

  // Drafts (per-type, per-patient, per-user, persisted)
  const [drafts, setDraftsState] = useState<Drafts>(() => loadDrafts(user?.id, patientId));
  // Reload drafts on (patient | user) switch + abort any in-flight polish so
  // the chunk callback can't write into the new patient's localStorage (P0-7).
  // user.id changes after auth hydrate → triggers reload from the namespaced key.
  useEffect(() => {
    polishAbortRef.current?.abort();
    refineAbortRef.current?.abort();
    setDraftsState(loadDrafts(user?.id, patientId));
  }, [patientId, user?.id]);

  const updateDraft = useCallback(
    (type: RecordType, patch: Partial<DraftEntry>) => {
      setDraftsState((prev) => {
        const next: Drafts = {
          ...prev,
          [type]: { ...prev[type], ...patch },
        };
        saveDrafts(user?.id, patientId, next);
        return next;
      });
    },
    [patientId, user?.id],
  );

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

  // Templates (server-backed)
  const [serverTemplates, setServerTemplates] = useState<RecordTemplate[]>([]);
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');

  // Loading flags
  const [isPolishing, setIsPolishing] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Refinement panel (per-type UI state — not persisted)
  const [refinementInstruction, setRefinementInstruction] = useState('');
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

  const handlePolishContent = async () => {
    if (!inputContent.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    polishAbortRef.current?.abort();
    const controller = new AbortController();
    polishAbortRef.current = controller;
    // Snapshot the draft as the user saw it at click time. The streaming
    // callback used to capture the latest `inputContent` from the closure,
    // which made the "草稿已變動" badge silent whenever the user kept typing
    // mid-stream (polishedFrom kept catching up to the new value). Freezing
    // here means polishedFrom always reflects the source-of-truth for the
    // run, so staleness is reliable even if the user edits during streaming.
    const sourceSnapshot = inputContent;
    setIsPolishing(true);
    try {
      const polishTypeMap: Record<RecordType, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
        'progress-note': 'progress_note',
        'medication-advice': 'medication_advice',
        'nursing-record': 'nursing_record',
      };
      const rawTemplate = selectedTemplate ? allTemplates[selectedTemplate] : undefined;
      const templateContent = isSoapTemplate(rawTemplate)
        ? flattenSoapTemplate(rawTemplate)
        : rawTemplate;
      let streamed = '';
      const result = await streamPolishClinicalText(
        {
          patientId,
          content: sourceSnapshot,
          polishType: polishTypeMap[recordType],
          templateContent,
        },
        (chunk) => {
          streamed += chunk;
          updateDraft(recordType, { polished: streamed, polishedFrom: sourceSnapshot });
        },
        controller.signal,
      );
      updateDraft(recordType, { polished: result.polished, polishedFrom: sourceSnapshot });
    } catch (err) {
      // On any non-success path the partial polished text in the draft is
      // either incomplete (timeout/network) or stale (aborted). Clear it so
      // the user can't accidentally copy a half-sentence into HIS.
      const reason = err instanceof PolishStreamError ? err.reason : 'network';
      const message = err instanceof PolishStreamError ? err.message : t('polish.fallbackError');
      updateDraft(recordType, { polished: '', polishedFrom: '' });
      if (reason === 'aborted') toast.message(message);
      else toast.error(message);
    } finally {
      if (polishAbortRef.current === controller) polishAbortRef.current = null;
      setIsPolishing(false);
    }
  };

  const handleRefine = async () => {
    const instruction = refinementInstruction.trim();
    if (!instruction) {
      toast.error(t('refine.needInstruction'));
      return;
    }
    if (!polishedContent.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    refineAbortRef.current?.abort();
    const controller = new AbortController();
    refineAbortRef.current = controller;
    // Snapshot the source draft so polishedFrom doesn't move under us if the
    // user keeps typing while refinement streams (same fix as polish above).
    const sourceSnapshot = inputContent;
    setIsRefining(true);
    try {
      const polishTypeMap: Record<RecordType, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
        'progress-note': 'progress_note',
        'medication-advice': 'medication_advice',
        'nursing-record': 'nursing_record',
      };
      let streamed = '';
      const result = await streamPolishClinicalText(
        {
          patientId,
          content: sourceSnapshot,
          polishType: polishTypeMap[recordType],
          instruction,
          previousPolished: polishedContent,
        },
        (chunk) => {
          streamed += chunk;
          updateDraft(recordType, { polished: streamed, polishedFrom: sourceSnapshot });
        },
        controller.signal,
      );
      updateDraft(recordType, { polished: result.polished, polishedFrom: sourceSnapshot });
      setRefinementInstruction('');
      toast.success(t('refine.successToast'));
    } catch (err) {
      // Refinement failure: revert to the last good polished text so the
      // user keeps what they had, but surface the reason so they can retry.
      const reason = err instanceof PolishStreamError ? err.reason : 'network';
      const message = err instanceof PolishStreamError ? err.message : t('refine.fallbackError');
      updateDraft(recordType, { polished: polishedContent, polishedFrom: inputContent });
      if (reason === 'aborted') toast.message(message);
      else toast.error(message);
    } finally {
      if (refineAbortRef.current === controller) refineAbortRef.current = null;
      setIsRefining(false);
    }
  };

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
          <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 max-w-[200px] items-center gap-1 rounded-md border border-slate-200 bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground dark:border-slate-700 dark:bg-input/30 dark:hover:bg-input/50"
              >
                {showDecorativeIcons && <Sparkles className="h-4 w-4 shrink-0" />}
                <span className="truncate">
                  {selectedTemplate ? t('templates.popoverButtonLabelWith', { name: selectedTemplate }) : t('templates.popoverButtonLabel')}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('templates.popoverTitle')}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowNewTemplate((v) => !v)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('templates.addNew')}
                  </Button>
                </div>

                <div className="max-h-60 space-y-1 overflow-auto pr-1">
                  <div className="px-1 text-[11px] uppercase tracking-wide text-slate-400">{t('templates.groupBuiltin')}</div>
                  {Object.keys(visibleBuiltins).map((name) => (
                    <Button
                      key={`b-${name}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-auto w-full justify-start py-1.5 text-left text-sm ${
                        selectedTemplate === name
                          ? 'bg-slate-100 dark:bg-slate-800'
                          : ''
                      }`}
                      onClick={() => handleApplyTemplate(name)}
                    >
                      {name}
                    </Button>
                  ))}

                  {serverTemplates.length > 0 && (
                    <>
                      <div className="mt-2 px-1 text-[11px] uppercase tracking-wide text-slate-400">
                        {t('templates.groupCustom')}
                      </div>
                      {serverTemplates.map((tpl) => (
                        <div key={tpl.id} className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`h-auto flex-1 justify-start py-1.5 text-left text-sm ${
                              selectedTemplate === tpl.name
                                ? 'bg-slate-100 dark:bg-slate-800'
                                : ''
                            }`}
                            onClick={() => handleApplyTemplate(tpl.name)}
                          >
                            {tpl.name}
                          </Button>
                          {tpl.canDelete && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                              disabled={deletingTemplateName === tpl.name}
                              onClick={() => void handleDeleteTemplate(tpl.name)}
                              title={t('templates.deleteCustomTitle', { name: tpl.name })}
                            >
                              {deletingTemplateName === tpl.name ? (
                                <ButtonLoadingIndicator compact />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {canOverwriteServerTemplate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
                    disabled={updatingTemplateName === selectedTemplate}
                    onClick={() => void handleUpdateTemplate(selectedTemplate)}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {t('templates.overwriteServerTemplate', { name: selectedTemplate })}
                    {updatingTemplateName === selectedTemplate ? (
                      <ButtonLoadingIndicator />
                    ) : null}
                  </Button>
                )}

                {canSaveBuiltinAsCustom && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => {
                      // Pre-fill new-template form with current draft + suggested name.
                      setShowNewTemplate(true);
                      setNewTemplateName(`${selectedTemplate}${t('templates.saveBuiltinSuffix')}`);
                      setNewTemplateContent(inputContent);
                    }}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {t('templates.saveBuiltinAsCustom', { name: selectedTemplate })}
                  </Button>
                )}

                {showNewTemplate && (
                  <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2 dark:border-slate-600">
                    <input
                      type="text"
                      placeholder={t('templates.newTemplateNamePlaceholder')}
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <Textarea
                      placeholder={t('templates.newTemplateContentPlaceholder')}
                      value={newTemplateContent}
                      onChange={(e) => setNewTemplateContent(e.target.value)}
                      className="min-h-[80px] text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveAsTemplate}
                        disabled={isSavingTemplate}
                      >
                        <span>{isSavingTemplate ? t('templates.saveProcessing') : t('templates.saveButton')}</span>
                        {isSavingTemplate ? <ButtonLoadingIndicator /> : null}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isSavingTemplate}
                        onClick={() => {
                          setShowNewTemplate(false);
                          setNewTemplateName('');
                          setNewTemplateContent('');
                        }}
                      >
                        {t('templates.cancelButton')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

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
      /* Side-by-side: 草稿 | AI 修飾 */
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: 草稿 */}
        <Card className="flex flex-col border-slate-300 dark:border-slate-600">
          <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4" />
              {t('draftSection.title')}
            </CardTitle>
            <CardDescription className="text-xs">{config.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <Textarea
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              placeholder={config.placeholder}
              className="min-h-[280px] flex-1 resize-none border-slate-300 dark:border-slate-600"
              onKeyDown={(e) => {
                if (isCmdEnter(e) && !isPolishing && inputContent.trim() && canPolish) {
                  e.preventDefault();
                  void handlePolishContent();
                }
              }}
            />
            <div className="flex items-center gap-2">
              {isPolishing ? (
                <Button
                  onClick={() => polishAbortRef.current?.abort()}
                  variant="outline"
                  className="flex-1 border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                >
                  <X className="mr-2 h-4 w-4" />
                  <span>{t('draftSection.stopPolish')}</span>
                </Button>
              ) : (
                <Button
                  onClick={handlePolishContent}
                  disabled={!inputContent.trim() || !canPolish}
                  style={{ backgroundColor: '#1e293b' }}
                  className="flex-1"
                  title={!canPolish ? polishReason : undefined}
                >
                  {showDecorativeIcons && <Brain className="mr-2 h-4 w-4" />}
                  <span>{config.polishLabel}</span>
                  {showDecorativeIcons && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              )}
              {(inputContent || polishedContent) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearDraft}
                  title={t('draftSection.clearDraft')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {t('draftSection.polishHint')}
            </p>
            {(isPolishing || isRefining) && (
              <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                {t('draftSection.polishingNotice')}
              </div>
            )}
            {/* "Just-applied" undo chip — visible while input still equals the
                snapshot (i.e. user hasn't started editing the template). */}
            {selectedTemplate
              && currentDraft.selectedTemplateSnapshot !== null
              && inputContent === currentDraft.selectedTemplateSnapshot
              && stashedDraftRef.current && (
              <div className="flex items-center justify-between rounded bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                <span>{t('templateApply.appliedHint', { name: selectedTemplate })}</span>
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={handleUndoApply}
                >
                  {t('templateApply.undoApply')}
                </button>
              </div>
            )}
            {selectedTemplate && (
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {t('templateApply.appliedTemplatePrefix')}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {selectedTemplate}
                  </span>
                </span>
                <button
                  className="hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => setSelectedTemplate('')}
                >
                  {t('templateApply.removeTemplate')}
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: AI 修飾後 */}
        <Card className="flex flex-col border-slate-300 dark:border-slate-600">
          <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
            <CardTitle className="flex items-center gap-2 text-base">
              {showDecorativeIcons && <Sparkles className="h-4 w-4" />}
              {t('polishedSection.title')}
              {polishedContent && (
                <Badge variant="secondary" className="text-[10px]">
                  {t('polishedSection.editableBadge')}
                </Badge>
              )}
              {isPolishedStale && (
                <Badge
                  variant="secondary"
                  className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {t('polishedSection.staleBadge')}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {polishedContent
                ? t('polishedSection.promptDescPolished')
                : t('polishedSection.promptDescBlank', { label: config.polishLabel })}
            </CardDescription>
          </CardHeader>
          <CardContent
            className="flex flex-1 flex-col gap-3 pt-4"
            role="status"
            aria-live="polite"
            aria-atomic="false"
          >
            <Textarea
              value={polishedContent}
              onChange={(e) => setPolishedContent(e.target.value)}
              placeholder={t('polishedSection.polishedPlaceholder')}
              className="min-h-[280px] flex-1 resize-none border-slate-300 font-mono text-sm dark:border-slate-600"
            />
            <Button
              onClick={handleCopy}
              disabled={!canCopy}
              className={
                polishedContent.trim().length > 0
                  ? 'w-full bg-brand hover:bg-brand-hover'
                  : 'w-full border border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
              }
              title={
                polishedContent.trim().length > 0
                  ? undefined
                  : t('polishedSection.copyDraftHisTitle')
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              {polishedContent.trim().length > 0
                ? t('polishedSection.copyPolishedToHis')
                : t('polishedSection.copyDraftToHis')}
            </Button>
            {lastCopiedHint && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {lastCopiedHint}
              </p>
            )}

            {polishedContent && (
              // Always-visible refine box. Compact by default — single-line
              // input + truncated preview chip — expands on focus (chat-input
              // pattern). Saves ~70px of vertical space when not in use,
              // restores full editor when the user actually needs it.
              <div className="group/refine space-y-2 rounded-md border-2 border-slate-300 bg-slate-50/60 p-3 dark:border-slate-600 dark:bg-slate-800/30">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('refine.title')}
                  </h4>
                  <p className="text-[11px] text-slate-400">{t('refine.shortcutHint')}</p>
                </div>
                {/* Single-line preview chip; full text shown on the polished
                    pane right above so truncation here is fine. */}
                <div className="truncate rounded bg-white px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                  {t('refine.previewLabel')}
                  <span className="ml-1 font-mono">
                    {polishedContent.replace(/\s+/g, ' ').slice(0, 60)}
                    {polishedContent.length > 60 ? '…' : ''}
                  </span>
                </div>
                <Textarea
                  value={refinementInstruction}
                  onChange={(e) => setRefinementInstruction(e.target.value)}
                  placeholder={t('refine.placeholder')}
                  className="min-h-[36px] resize-none border-slate-300 text-sm transition-[min-height] duration-150 focus:min-h-[80px] dark:border-slate-600"
                  disabled={isRefining}
                  onKeyDown={(e) => {
                    if (isCmdEnter(e) && !isRefining) {
                      e.preventDefault();
                      void handleRefine();
                    }
                  }}
                />
                {isRefining ? (
                  <Button
                    onClick={() => refineAbortRef.current?.abort()}
                    size="sm"
                    variant="outline"
                    className="w-full border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    {t('refine.stop')}
                  </Button>
                ) : (
                  <Button
                    onClick={handleRefine}
                    disabled={!refinementInstruction.trim()}
                    size="sm"
                    style={{ backgroundColor: '#1e293b' }}
                    className="w-full"
                  >
                    {t('refine.submit')}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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

