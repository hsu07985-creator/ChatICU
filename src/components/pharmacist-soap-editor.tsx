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

const SECTION_META: Record<SoapSection, { label: string; subtitle: string; hint: string; aiEditable: boolean; defaultMode: PolishMode }> = {
  s: { label: 'S — Subjective', subtitle: '從 HIS 貼上', hint: 'AI 不會動這段', aiEditable: false, defaultMode: 'full' },
  o: { label: 'O — Objective', subtitle: '從 HIS 貼上（Labs / Vitals / Meds）', hint: 'AI 不會動這段', aiEditable: false, defaultMode: 'full' },
  a: { label: 'A — Assessment', subtitle: '評估 / guideline / 分析', hint: 'AI 只修文法（grammar_only）', aiEditable: true, defaultMode: 'grammar_only' },
  p: { label: 'P — Plan（用藥建議）', subtitle: '條列建議，AI 會套藥師格式', hint: 'AI 套 bullet + 藥物格式 + Monitor', aiEditable: true, defaultMode: 'full' },
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
          `${key.toUpperCase()} 段已有「${label.split(' ')[0]}」區塊。\n按「確定」替換為最新版本，按「取消」追加新的一份。`,
        );
        if (replace) {
          const next = current.replace(blockRegex, wrapped);
          onSoapChange({ ...soap, [key]: next });
          return;
        }
      }
      insertAtCursor(key, wrapped);
    },
    [soap, onSoapChange, insertAtCursor],
  );

  const handleInsertLabs = useCallback(() => {
    const formatted = formatLabsForPaste(labData, labWindow);
    if (!formatted) {
      toast.error('無可貼上的檢驗資料');
      return;
    }
    insertWithDedup(lastFocusedSection, `Labs ${labWindow}`, formatted);
  }, [labData, labWindow, insertWithDedup, lastFocusedSection]);

  const handleInsertMedications = useCallback(() => {
    const formatted = formatMedicationsForPaste(medications);
    if (!formatted) {
      toast.error('無可貼上的用藥資料');
      return;
    }
    insertWithDedup(lastFocusedSection, 'Meds', formatted);
  }, [medications, insertWithDedup, lastFocusedSection]);

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
        toast.error('此段沒有內容，請先輸入草稿');
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
          toast.success('已依指示重新修飾');
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
        const message = err instanceof PolishStreamError ? err.message : 'AI 修飾失敗，請稍後再試';
        if (reason === 'aborted') toast.message(message);
        else toast.error(message);
      } finally {
        if (abortRefs.current[key] === controller) abortRefs.current[key] = null;
      }
    },
    [canPolish, patchSectionState, patientId, polishReason, setPolishedValue, soap],
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
      toast.error('A 與 P 段都沒有內容，請先輸入草稿');
      return;
    }
    await Promise.allSettled(tasks);
  }, [runPolish, soap.a, soap.p]);

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

  const handleCopy = async () => {
    if (!composed) return;
    const ok = await copyToClipboard(composed);
    if (ok) {
      toast.success('已複製，可貼到 HIS');
      onSubmitted?.();
    } else {
      toast.error('複製失敗，請手動複製');
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
            一鍵帶入到 <span className="font-mono font-semibold">{lastFocusedSection.toUpperCase()}</span> 段：
          </span>
          {labData && (
            <>
              <select
                value={labWindow}
                onChange={(e) => setLabWindow(e.target.value as LabWindow)}
                className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                data-testid="pharmacist-soap-lab-window"
                title="調整下一次插入的時間範圍"
              >
                <option value="6h">Labs 6h</option>
                <option value="24h">Labs 24h</option>
                <option value="all">Labs 全部</option>
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
                插入 Labs
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
              插入用藥
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
                  {meta.label}
                  <Badge
                    variant="secondary"
                    className={
                      meta.aiEditable
                        ? 'bg-sky-100 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                        : 'bg-slate-200 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }
                  >
                    {meta.hint}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400">{meta.subtitle}</p>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <Textarea
                  ref={(el) => {
                    textareaRefs.current[key] = el;
                  }}
                  value={soap[key]}
                  onChange={(e) => setInputValue(key, e.target.value)}
                  onFocus={() => setLastFocusedSection(key)}
                  placeholder={
                    key === 's'
                      ? '例：Patient c/o dyspnea, denied chest pain.'
                      : key === 'o'
                        ? '例：\nDx: ARDS, CRE pneumonia\nAllergy: NKDA\nLabs: Cr 1.8 (0.6-1.2), K 5.8 (3.5-5.0)\nCurrent meds: Meropenem 1g IV q8h'
                        : key === 'a'
                          ? '例：CRE coverage inadequate given worsening infiltrate... (可貼 IDSA guideline)'
                          : '例：\nsug add ceftazidime-avibactam 2.5g IV q8h d/t MIC profile.\nmonitor: CRP, procalcitonin q48h, renal fx.'
                  }
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
                        停止
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => void runPolish(key, meta.defaultMode)}
                          disabled={!soap[key].trim() || !canPolish}
                          size="sm"
                          style={{ backgroundColor: '#1e293b' }}
                        >
                          {meta.defaultMode === 'grammar_only' ? '只修文法' : '套藥師格式'}
                        </Button>
                        {key === 'p' && (
                          <Button
                            onClick={() => void runPolish(key, 'grammar_only')}
                            disabled={!soap[key].trim() || !canPolish}
                            size="sm"
                            variant="outline"
                          >
                            只修文法
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
                        ? 'AI 寫入中…完成後即可編輯'
                        : 'AI 修飾結果（可直接修改）'}
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
                    {/* Always-visible refine box (no disclosure) — pharmacists
                        used to miss the "再修一次" link in the corner. */}
                    <div className="space-y-2 rounded border-2 border-sky-300 bg-white p-2 dark:border-sky-700 dark:bg-slate-900/40">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-semibold text-sky-800 dark:text-sky-200">
                          再修一次
                        </h5>
                        <p className="text-[11px] text-slate-400">⌘/Ctrl + Enter 送出</p>
                      </div>
                      <Textarea
                        value={st.refinementInstruction}
                        onChange={(e) =>
                          patchSectionState(key, { refinementInstruction: e.target.value })
                        }
                        placeholder={
                          key === 'p'
                            ? '想怎麼調整？例：再簡短一點 / 把劑量細節拿掉 / 用條列式'
                            : '想怎麼調整？例：語氣再中性一點 / 翻譯成英文'
                        }
                        className="min-h-[60px] resize-none border-sky-300 text-sm dark:border-sky-700"
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
                        {st.refining ? '修改中...' : '再修一次'}
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
          <CardTitle className="text-base">最終輸出（自動拼接 S + O + A + P）</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A / P 若已按 AI 修飾，會優先使用修飾後版本；S / O 逐字保留。
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
                {k.toUpperCase()} 段已編輯，潤飾結果可能過時
              </Badge>
            ))}
          <pre
            className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            data-testid="pharmacist-soap-composed"
          >
            {composed || '（尚未輸入內容）'}
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
            <span>共 {composed.length} 字</span>
            <span className="font-mono">{polishStatusLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void polishAandPParallel()}
              disabled={isAnyPolishing || !canPolish || (!soap.a.trim() && !soap.p.trim())}
              size="sm"
              variant="outline"
            >
              潤飾 A + P
            </Button>
            <Button
              onClick={handleCopy}
              disabled={!composed}
              size="sm"
              className="bg-brand hover:bg-brand-hover"
            >
              <Copy className="mr-2 h-4 w-4" />
              複製貼到 HIS
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
