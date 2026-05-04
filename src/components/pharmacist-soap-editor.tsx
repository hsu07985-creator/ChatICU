/**
 * Pharmacist SOAP Editor — Phase 3 deliverable.
 *
 * Structural fix for the pharmacist polish flow. The pharmacist pastes S/O
 * verbatim from HIS (AI must not touch those), writes A (may include guideline
 * paste or mixed-language prose — wants grammar-only), and writes P in broken
 * Chinese/English with the 4 format rules expected on output.
 *
 * Gated by `user.role === 'pharmacist' && recordType === 'medication-advice'`
 * from the parent component.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  streamPolishClinicalText,
  PolishStreamError,
  type PolishMode,
  type SoapSection,
  type SoapSections,
} from '../lib/api/ai';
import type { LabData } from '../lib/api/lab-data';
import type { Medication } from '../lib/api/medications';
import {
  formatLabsForPaste,
  formatMedicationsForPaste,
  type LabWindow,
} from '../lib/clinical/format-for-paste';
import { copyToClipboard } from '../lib/clipboard-utils';
import { isCmdEnter } from '../lib/dom/key';
import { createPharmacySoapRecord } from '../lib/api/pharmacy';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { ButtonLoadingIndicator } from './ui/button-loading-indicator';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
// CLAUDE.md memory `feedback_no_icons_emoji`: 藥事工具頁面避免 emoji 與裝飾
// icon。FlaskConical / Syringe label paste sources, Copy labels the copy
// action, X is the close/stop affordance — all functional. Brain / Sparkles /
// Wand2 / Pill are decorative and removed.
import { Copy, FlaskConical, Syringe, X } from 'lucide-react';
import { toast } from 'sonner';

export type SoapDraft = SoapSections;

export const EMPTY_SOAP: SoapDraft = { s: '', o: '', a: '', p: '' };

export interface PharmacistSoapEditorProps {
  patientId: string;
  canPolish: boolean;
  polishReason: string;
  soap: SoapDraft;
  polishedSoap: SoapDraft;
  onSoapChange: (next: SoapDraft) => void;
  onPolishedSoapChange: (next: SoapDraft) => void;
  onSubmitted?: () => void;
  labData?: LabData | null;
  medications?: Medication[] | null;
}

type PerSectionState = {
  polishing: boolean;
  refining: boolean;
  refinementInstruction: string;
};

const INITIAL_STATE: PerSectionState = {
  polishing: false,
  refining: false,
  refinementInstruction: '',
};

// Legacy hand-rolled JSON scanner removed (W2-T2). The server now emits
// `section_delta` events with already-decoded chunks for the target section,
// so the frontend no longer parses the JSON stream. The fallback is the
// authoritative `polished_sections` payload on the `done` event.

// SECTION_META holds non-localised structural attributes (aiEditable, defaultMode).
// User-facing strings (label / subtitle / hint) are resolved at render time via
// `t('soap-editor:section.{key}')` so they follow language switching.
const SECTION_META: Record<SoapSection, { aiEditable: boolean; defaultMode: PolishMode }> = {
  s: { aiEditable: false, defaultMode: 'full' },
  o: { aiEditable: false, defaultMode: 'full' },
  a: { aiEditable: true, defaultMode: 'grammar_only' },
  p: { aiEditable: true, defaultMode: 'full' },
};

export function PharmacistSoapEditor({
  patientId,
  canPolish,
  polishReason,
  soap,
  polishedSoap,
  onSoapChange,
  onPolishedSoapChange,
  onSubmitted,
  labData = null,
  medications = null,
}: PharmacistSoapEditorProps) {
  const { t } = useTranslation('soap-editor');
  const [sectionState, setSectionState] = useState<Record<SoapSection, PerSectionState>>({
    s: { ...INITIAL_STATE },
    o: { ...INITIAL_STATE },
    a: { ...INITIAL_STATE },
    p: { ...INITIAL_STATE },
  });
  const [labWindow, setLabWindow] = useState<LabWindow>('24h');
  const textareaRefs = useRef<Partial<Record<SoapSection, HTMLTextAreaElement | null>>>({});
  // Per-section abort controllers — pharmacist polish averages 15s; let them cancel.
  const abortRefs = useRef<Partial<Record<SoapSection, AbortController | null>>>({});
  // Snapshot of soap[key] at the moment a polish *completed*. Compared to live
  // soap[key] in render to flag composed output as stale. Session-scoped (not
  // persisted) — a reload clears the warning, which is acceptable.
  const [polishedFromSoap, setPolishedFromSoap] = useState<SoapDraft>({ ...EMPTY_SOAP });
  // W4-T5: track the last focused editable section so Labs/Meds insertion can
  // target wherever the pharmacist's cursor was, not just O. Defaults to 'o'.
  const [lastFocusedSection, setLastFocusedSection] = useState<SoapSection>('o');

  const patchSectionState = useCallback(
    (key: SoapSection, patch: Partial<PerSectionState>) => {
      setSectionState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    },
    [],
  );

  const setInputValue = useCallback(
    (key: SoapSection, value: string) => {
      onSoapChange({ ...soap, [key]: value });
    },
    [soap, onSoapChange],
  );

  const insertAtCursor = useCallback(
    (key: SoapSection, text: string) => {
      if (!text) return;
      const el = textareaRefs.current[key];
      const current = soap[key] || '';
      if (!el || typeof el.selectionStart !== 'number') {
        const joined = current ? `${current}\n${text}` : text;
        onSoapChange({ ...soap, [key]: joined });
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const needsLeadingNewline = start > 0 && current[start - 1] !== '\n';
      const prefix = needsLeadingNewline ? '\n' : '';
      const next = `${current.slice(0, start)}${prefix}${text}${current.slice(end)}`;
      onSoapChange({ ...soap, [key]: next });
      const caret = start + prefix.length + text.length;
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      });
    },
    [soap, onSoapChange],
  );

  // W4-T5: Wrap inserts with a human-readable delimiter so the pharmacist
  // can see (and HIS receives) where the auto-pasted block starts/ends, AND
  // we can detect existing blocks for dedup without HTML-comment sentinels
  // (which would leak as raw `<!--` text into HIS).
  const wrapInsertion = (label: string, body: string): string => {
    const ts = new Date().toLocaleTimeString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `=== ${label} (${ts}) ===\n${body}\n=== /${label.split(' ')[0]} ===`;
  };

  const insertWithDedup = useCallback(
    (key: SoapSection, label: string, body: string) => {
      const current = soap[key] || '';
      const blockRegex = new RegExp(`=== ${label.split(' ')[0]}[^\\n]*?===[\\s\\S]*?=== /${label.split(' ')[0]} ===`, 'g');
      const wrapped = wrapInsertion(label, body);
      if (blockRegex.test(current)) {
        const replace = window.confirm(
          t('confirm.replaceBlock', { section: key.toUpperCase(), label: label.split(' ')[0] }),
        );
        if (replace) {
          const next = current.replace(blockRegex, wrapped);
          onSoapChange({ ...soap, [key]: next });
          return;
        }
      }
      insertAtCursor(key, wrapped);
    },
    [soap, onSoapChange, insertAtCursor, t],
  );

  const handleInsertLabs = useCallback(() => {
    const formatted = formatLabsForPaste(labData, labWindow);
    if (!formatted) {
      toast.error(t('toast.noLabsToInsert'));
      return;
    }
    insertWithDedup(lastFocusedSection, `Labs ${labWindow}`, formatted);
  }, [labData, labWindow, insertWithDedup, lastFocusedSection, t]);

  const handleInsertMedications = useCallback(() => {
    const formatted = formatMedicationsForPaste(medications);
    if (!formatted) {
      toast.error(t('toast.noMedsToInsert'));
      return;
    }
    insertWithDedup(lastFocusedSection, 'Meds', formatted);
  }, [medications, insertWithDedup, lastFocusedSection, t]);

  const setPolishedValue = useCallback(
    (key: SoapSection, value: string) => {
      onPolishedSoapChange({ ...polishedSoap, [key]: value });
    },
    [polishedSoap, onPolishedSoapChange],
  );

  const runPolish = useCallback(
    async (key: SoapSection, mode: PolishMode, instruction?: string, previousPolished?: string) => {
      if (!canPolish) {
        toast.error(polishReason);
        return;
      }
      const input = (soap[key] || '').trim();
      if (!input && mode !== 'refinement') {
        toast.error(t('toast.noContentForPolish'));
        return;
      }
      const isRefinement = mode === 'refinement';
      abortRefs.current[key]?.abort();
      const controller = new AbortController();
      abortRefs.current[key] = controller;
      patchSectionState(key, isRefinement ? { refining: true } : { polishing: true });
      // Reset section preview at start of each polish so previous artifacts
      // don't bleed in (e.g. retry after error).
      let sectionAccum = '';
      setPolishedValue(key, '');
      try {
        const result = await streamPolishClinicalText(
          {
            patientId,
            polishType: 'medication_advice',
            task: 'pharmacist_polish',
            polishMode: mode,
            // Only send the targeted section with real content; others empty so
            // the prompt's TARGET_SECTION rule scopes the output.
            soapSections: { s: '', o: '', a: '', p: '', [key]: soap[key] },
            targetSection: key,
            instruction: isRefinement ? instruction : undefined,
            previousPolished: isRefinement ? previousPolished : undefined,
          },
          // `delta` (raw JSON chunks) is unused now — section_delta gives us
          // already-decoded text for the target section.
          () => {},
          controller.signal,
          (sectionKey, chunk) => {
            if (sectionKey !== key) return;
            sectionAccum += chunk;
            setPolishedValue(key, sectionAccum);
          },
        );
        const returned = result.polished_sections?.[key];
        const fallback = result.polished;
        const next = (returned && returned.trim()) ? returned : fallback;
        setPolishedValue(key, next);
        // Record the source value at completion so we can flag staleness if
        // the pharmacist edits this section's source textarea afterwards.
        setPolishedFromSoap((prev) => ({ ...prev, [key]: soap[key] }));
        if (isRefinement) {
          patchSectionState(key, { refining: false, refinementInstruction: '' });
          toast.success(t('toast.refinementSuccess'));
        } else {
          patchSectionState(key, { polishing: false });
        }
      } catch (err) {
        patchSectionState(key, isRefinement ? { refining: false } : { polishing: false });
        // Per-section partial polish text is now garbage if not refinement —
        // clear it so pharmacist doesn't paste a half-sentence into HIS.
        // Refinement keeps the previous good polished value (the prior version
        // is what `polishedSoap[key]` holds before this run started).
        if (!isRefinement) {
          setPolishedValue(key, '');
        }
        const reason = err instanceof PolishStreamError ? err.reason : 'network';
        const message = err instanceof PolishStreamError ? err.message : t('toast.polishFailed');
        if (reason === 'aborted') toast.message(message);
        else toast.error(message);
      } finally {
        if (abortRefs.current[key] === controller) abortRefs.current[key] = null;
      }
    },
    [canPolish, patchSectionState, patientId, polishReason, setPolishedValue, soap, t],
  );

  const abortSection = useCallback((key: SoapSection) => {
    abortRefs.current[key]?.abort();
  }, []);

  // W4-T3: parallel polish for A and P. Each section already has its own
  // AbortController so the two streams don't collide. Section state turns to
  // polishing for both simultaneously and the existing per-section error
  // handling fires independently.
  const polishAandPParallel = useCallback(async () => {
    const tasks: Promise<void>[] = [];
    if ((soap.a || '').trim()) tasks.push(runPolish('a', SECTION_META.a.defaultMode));
    if ((soap.p || '').trim()) tasks.push(runPolish('p', SECTION_META.p.defaultMode));
    if (!tasks.length) {
      toast.error(t('toast.noContentForAandP'));
      return;
    }
    await Promise.allSettled(tasks);
  }, [runPolish, soap.a, soap.p, t]);

  const isAnyPolishing =
    sectionState.a.polishing || sectionState.a.refining
    || sectionState.p.polishing || sectionState.p.refining;
  const polishStatusLabel = (() => {
    const aDone = polishedSoap.a.trim().length > 0;
    const pDone = polishedSoap.p.trim().length > 0;
    return `A ${sectionState.a.polishing ? '⏳' : aDone ? '✓' : '·'}` +
      `  P ${sectionState.p.polishing ? '⏳' : pDone ? '✓' : '·'}`;
  })();

  const composed = [
    polishedSoap.s || soap.s,
    polishedSoap.o || soap.o,
    polishedSoap.a || soap.a,
    polishedSoap.p || soap.p,
  ]
    .map((chunk) => (chunk || '').trim())
    .filter((chunk) => chunk.length > 0)
    .join('\n\n');

  const [submitting, setSubmitting] = useState(false);

  // TC-FU-T2: persist the SOAP draft into ChatICU before copying to HIS
  // so the pharmacist can re-read it from the SOAP records tab on
  // /pharmacy/advice-statistics. Clipboard write is the fallback path —
  // even if the DB write fails, we still let the pharmacist paste into HIS.
  const handleCopy = async () => {
    if (!composed) return;
    setSubmitting(true);
    let saved = false;
    try {
      await createPharmacySoapRecord({
        patientId,
        subjective: soap.s || undefined,
        objective: soap.o || undefined,
        // For A / P prefer the polished version (what the pharmacist
        // actually intends to keep); fall back to the raw draft when AI
        // wasn't run / refused.
        assessment: (polishedSoap.a || soap.a || '') || undefined,
        plan: (polishedSoap.p || soap.p || '') || undefined,
        polished: composed,
      });
      saved = true;
    } catch {
      saved = false;
    }
    const copied = await copyToClipboard(composed);
    setSubmitting(false);
    if (saved && copied) {
      toast.success(t('toast.saveAndCopySuccess'));
      onSubmitted?.();
    } else if (!saved && copied) {
      toast.error(t('toast.saveFailedCopiedOnly'));
      onSubmitted?.();
    } else if (saved && !copied) {
      toast.success(t('toast.savedCopyFailed'));
      onSubmitted?.();
    } else {
      toast.error(t('toast.saveAndCopyAllFailed'));
    }
  };

  return (
    <div className="space-y-4">
      {!canPolish && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {polishReason}
        </div>
      )}

      {/* W4-T5 floating insert toolbar — targets the last focused editable
          section (defaults to O), so pharmacist can pull Labs/Meds into A/P
          when reasoning about a value too. */}
      {(labData || (medications && medications.length > 0)) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900/40"
          data-testid="pharmacist-soap-insert-toolbar"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('insertToolbar.preLabel')} <span className="font-mono font-semibold">{lastFocusedSection.toUpperCase()}</span> {t('insertToolbar.postLabel')}
          </span>
          {labData && (
            <>
              <select
                value={labWindow}
                onChange={(e) => setLabWindow(e.target.value as LabWindow)}
                className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                data-testid="pharmacist-soap-lab-window"
                title={t('insertToolbar.labWindowTitle')}
              >
                <option value="6h">{t('insertToolbar.labWindow6h')}</option>
                <option value="24h">{t('insertToolbar.labWindow24h')}</option>
                <option value="all">{t('insertToolbar.labWindowAll')}</option>
              </select>
              <Button
                type="button"
                onClick={handleInsertLabs}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="pharmacist-soap-insert-labs"
              >
                <FlaskConical className="mr-1 h-3 w-3" />
                {t('insertToolbar.insertLabs')}
              </Button>
            </>
          )}
          {medications && medications.length > 0 && (
            <Button
              type="button"
              onClick={handleInsertMedications}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              data-testid="pharmacist-soap-insert-meds"
            >
              <Syringe className="mr-1 h-3 w-3" />
              {t('insertToolbar.insertMeds')}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {(['s', 'o', 'a', 'p'] as SoapSection[]).map((key) => {
          const meta = SECTION_META[key];
          const st = sectionState[key];
          const polished = polishedSoap[key] || '';
          const hasPolished = polished.trim().length > 0;

          return (
            <Card
              key={key}
              className={
                meta.aiEditable
                  ? 'border-sky-300 dark:border-sky-700'
                  : 'border-slate-300 dark:border-slate-600'
              }
            >
              <CardHeader
                className={
                  meta.aiEditable
                    ? 'bg-sky-50 py-3 dark:bg-sky-950/30'
                    : 'bg-slate-50 py-3 dark:bg-slate-800'
                }
              >
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {t(`section.${key}Label`)}
                  <Badge
                    variant="secondary"
                    className={
                      meta.aiEditable
                        ? 'bg-sky-100 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                        : 'bg-slate-200 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }
                  >
                    {t(`section.${key}Hint`)}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(`section.${key}Subtitle`)}</p>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <Textarea
                  ref={(el) => {
                    textareaRefs.current[key] = el;
                  }}
                  value={soap[key]}
                  onChange={(e) => setInputValue(key, e.target.value)}
                  onFocus={() => setLastFocusedSection(key)}
                  placeholder={t(`placeholder.${key}`)}
                  className={`resize-y ${meta.aiEditable ? 'min-h-[100px]' : 'min-h-[80px] font-mono bg-slate-50 dark:bg-slate-900/40'}`}
                  data-testid={`pharmacist-soap-input-${key}`}
                />

                {meta.aiEditable && (
                  <div className="flex flex-wrap items-center gap-2">
                    {st.polishing ? (
                      <Button
                        onClick={() => abortSection(key)}
                        size="sm"
                        variant="outline"
                        className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                      >
                        <X className="mr-1.5 h-4 w-4" />
                        {t('actions.stop')}
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => void runPolish(key, meta.defaultMode)}
                          disabled={!soap[key].trim() || !canPolish}
                          size="sm"
                          style={{ backgroundColor: '#1e293b' }}
                        >
                          {meta.defaultMode === 'grammar_only' ? t('actions.grammarOnly') : t('actions.applyPharmacistFormat')}
                        </Button>
                        {key === 'p' && (
                          <Button
                            onClick={() => void runPolish(key, 'grammar_only')}
                            disabled={!soap[key].trim() || !canPolish}
                            size="sm"
                            variant="outline"
                          >
                            {t('actions.grammarOnly')}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {meta.aiEditable && hasPolished && (
                  <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                    <div className="text-xs font-medium text-sky-700 dark:text-sky-300">
                      {st.polishing || st.refining
                        ? t('polish.writingInProgress')
                        : t('polish.polishedEditable')}
                    </div>
                    <Textarea
                      value={polished}
                      onChange={(e) => setPolishedValue(key, e.target.value)}
                      readOnly={st.polishing || st.refining}
                      className={
                        'min-h-[90px] resize-y border-sky-300 font-mono text-sm dark:border-sky-700'
                        + (st.polishing || st.refining ? ' bg-slate-50 dark:bg-slate-900/40' : '')
                      }
                      data-testid={`pharmacist-soap-polished-${key}`}
                    />
                    {/* Always-visible refine box, compact by default
                        (1-line input that expands on focus). Pharmacists no
                        longer need to find a corner link, but A + P × 4
                        sections × full-height refine boxes would dominate
                        the page. Chat-input pattern keeps both. */}
                    <div className="space-y-2 rounded border-2 border-sky-300 bg-white p-2 dark:border-sky-700 dark:bg-slate-900/40">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-semibold text-sky-800 dark:text-sky-200">
                          {t('actions.refineAgainHeading')}
                        </h5>
                        <p className="text-[11px] text-slate-400">{t('actions.refineShortcut')}</p>
                      </div>
                      <Textarea
                        value={st.refinementInstruction}
                        onChange={(e) =>
                          patchSectionState(key, { refinementInstruction: e.target.value })
                        }
                        placeholder={
                          key === 'p'
                            ? t('placeholder.refinementP')
                            : t('placeholder.refinementA')
                        }
                        className="min-h-[36px] resize-none border-sky-300 text-sm transition-[min-height] duration-150 focus:min-h-[72px] dark:border-sky-700"
                        disabled={st.refining}
                        onKeyDown={(e) => {
                          if (
                            isCmdEnter(e)
                            && !st.refining
                            && st.refinementInstruction.trim()
                          ) {
                            e.preventDefault();
                            void runPolish(
                              key,
                              'refinement',
                              st.refinementInstruction.trim(),
                              polished,
                            );
                          }
                        }}
                      />
                      <Button
                        onClick={() =>
                          void runPolish(
                            key,
                            'refinement',
                            st.refinementInstruction.trim(),
                            polished,
                          )
                        }
                        disabled={st.refining || !st.refinementInstruction.trim()}
                        size="sm"
                        style={{ backgroundColor: '#1e293b' }}
                        className="w-full"
                      >
                        {st.refining ? t('actions.refining') : t('actions.refineButton')}
                        {st.refining ? <ButtonLoadingIndicator /> : null}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Composed output preview — kept as a regular card on top of scroll;
          the sticky bottom bar below holds the canonical Copy CTA so the
          pharmacist never needs to scroll to the bottom to paste into HIS. */}
      <Card className="border-emerald-300 dark:border-emerald-700">
        <CardHeader className="bg-emerald-50 py-3 dark:bg-emerald-950/30">
          <CardTitle className="text-base">{t('compose.title')}</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('compose.description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {/* Stale warning per editable section: source textarea was edited
              after polish completed — composed is using the older polished. */}
          {(['a', 'p'] as const)
            .filter((k) => polishedSoap[k] && polishedFromSoap[k] !== soap[k])
            .map((k) => (
              <Badge
                key={`stale-${k}`}
                variant="secondary"
                className="bg-amber-100 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {t('compose.staleBadge', { section: k.toUpperCase() })}
              </Badge>
            ))}
          <pre
            className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            data-testid="pharmacist-soap-composed"
          >
            {composed || t('compose.empty')}
          </pre>
        </CardContent>
      </Card>

      {/* W4-T2 sticky bar — pharmacist can copy from any scroll position.
          Also W4-T3 Polish A+P trigger lives here so the action density at
          decision time is in one place. */}
      <div
        className="sticky bottom-0 -mx-4 mt-2 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-950/90"
        data-testid="pharmacist-soap-sticky-bar"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <span>{t('compose.charCount', { count: composed.length })}</span>
            <span className="font-mono">{polishStatusLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void polishAandPParallel()}
              disabled={isAnyPolishing || !canPolish || (!soap.a.trim() && !soap.p.trim())}
              size="sm"
              variant="outline"
            >
              {t('actions.polishAandP')}
            </Button>
            <Button
              onClick={handleCopy}
              disabled={!composed || submitting}
              size="sm"
              className="bg-brand hover:bg-brand-hover"
            >
              <Copy className="mr-2 h-4 w-4" />
              {submitting ? t('actions.saving') : t('actions.saveAndCopy')}
              {submitting ? <ButtonLoadingIndicator /> : null}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
