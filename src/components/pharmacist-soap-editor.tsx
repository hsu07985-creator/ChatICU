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
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { ButtonLoadingIndicator } from './ui/button-loading-indicator';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Brain, Copy, Sparkles, Wand2, Pill, FlaskConical, Syringe } from 'lucide-react';
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
  refinementOpen: boolean;
  refinementInstruction: string;
};

const INITIAL_STATE: PerSectionState = {
  polishing: false,
  refining: false,
  refinementOpen: false,
  refinementInstruction: '',
};

/**
 * Best-effort incremental extractor for the target section value out of the
 * pharmacist_polish JSON stream. The LLM emits `{"s":"...","o":"...","a":"...","p":"..."}`.
 * We scan for `"<key>":"` and read characters (with minimal escape handling)
 * until the closing `"` that terminates the string. Partial / truncated
 * buffers return whatever has been accumulated so far.
 */
function extractStreamedSoapValue(buffer: string, key: SoapSection): string {
  const marker = `"${key}":"`;
  const idx = buffer.indexOf(marker);
  if (idx < 0) return '';
  let i = idx + marker.length;
  let out = '';
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === '\\') {
      if (i + 1 >= buffer.length) break;
      const next = buffer[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  return out;
}

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

  const handleInsertLabs = useCallback(() => {
    const formatted = formatLabsForPaste(labData, labWindow);
    if (!formatted) {
      toast.error('無可貼上的檢驗資料');
      return;
    }
    insertAtCursor('o', formatted);
  }, [labData, labWindow, insertAtCursor]);

  const handleInsertMedications = useCallback(() => {
    const formatted = formatMedicationsForPaste(medications);
    if (!formatted) {
      toast.error('無可貼上的用藥資料');
      return;
    }
    insertAtCursor('o', formatted);
  }, [medications, insertAtCursor]);

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
      patchSectionState(key, isRefinement ? { refining: true } : { polishing: true });
      let streamBuffer = '';
      let lastPreview = '';
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
          (chunk) => {
            streamBuffer += chunk;
            // Extract the target section's value incrementally from the JSON
            // stream so the pharmacist sees characters appear while the model
            // is still writing. The authoritative value comes from the final
            // parsed payload on `done`.
            const preview = extractStreamedSoapValue(streamBuffer, key);
            if (preview && preview !== lastPreview) {
              lastPreview = preview;
              setPolishedValue(key, preview);
            }
          },
        );
        const returned = result.polished_sections?.[key];
        const fallback = result.polished;
        const next = (returned && returned.trim()) ? returned : fallback;
        setPolishedValue(key, next);
        if (isRefinement) {
          patchSectionState(key, { refining: false, refinementInstruction: '' });
          toast.success('已依指示重新修飾');
        } else {
          patchSectionState(key, { polishing: false });
        }
      } catch {
        patchSectionState(key, isRefinement ? { refining: false } : { polishing: false });
        toast.error('AI 修飾失敗，請稍後再試');
      }
    },
    [canPolish, patchSectionState, patientId, polishReason, setPolishedValue, soap],
  );

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
                {key === 'o' && (labData || (medications && medications.length > 0)) && (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900/40"
                    data-testid="pharmacist-soap-insert-toolbar"
                  >
                    <span className="text-xs text-slate-500 dark:text-slate-400">一鍵帶入：</span>
                    {labData && (
                      <>
                        <label className="text-xs text-slate-500 dark:text-slate-400">Labs</label>
                        <select
                          value={labWindow}
                          onChange={(e) => setLabWindow(e.target.value as LabWindow)}
                          className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                          data-testid="pharmacist-soap-lab-window"
                        >
                          <option value="6h">6h</option>
                          <option value="24h">24h</option>
                          <option value="all">全部</option>
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
                <Textarea
                  ref={(el) => {
                    textareaRefs.current[key] = el;
                  }}
                  value={soap[key]}
                  onChange={(e) => setInputValue(key, e.target.value)}
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
                    <Button
                      onClick={() => void runPolish(key, meta.defaultMode)}
                      disabled={st.polishing || !soap[key].trim() || !canPolish}
                      size="sm"
                      style={{ backgroundColor: '#1e293b' }}
                    >
                      <Brain className="mr-1.5 h-4 w-4" />
                      {st.polishing ? 'AI 修飾中...' : meta.defaultMode === 'grammar_only' ? '只修文法' : '套藥師格式'}
                      {st.polishing ? <ButtonLoadingIndicator /> : null}
                    </Button>
                    {key === 'p' && (
                      <Button
                        onClick={() => void runPolish(key, 'grammar_only')}
                        disabled={st.polishing || !soap[key].trim() || !canPolish}
                        size="sm"
                        variant="outline"
                      >
                        <Pill className="mr-1.5 h-4 w-4" />
                        只修文法
                      </Button>
                    )}
                  </div>
                )}

                {meta.aiEditable && hasPolished && (
                  <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI 修飾結果（可直接修改）
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          patchSectionState(key, { refinementOpen: !st.refinementOpen })
                        }
                        className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline dark:text-sky-300"
                      >
                        <Wand2 className="h-3 w-3" />
                        {st.refinementOpen ? '收起' : '再修一次'}
                      </button>
                    </div>
                    <Textarea
                      value={polished}
                      onChange={(e) => setPolishedValue(key, e.target.value)}
                      className="min-h-[90px] resize-y border-sky-300 font-mono text-sm dark:border-sky-700"
                      data-testid={`pharmacist-soap-polished-${key}`}
                    />
                    {st.refinementOpen && (
                      <div className="space-y-2 border-t border-sky-200 pt-2 dark:border-sky-800">
                        <Textarea
                          value={st.refinementInstruction}
                          onChange={(e) =>
                            patchSectionState(key, { refinementInstruction: e.target.value })
                          }
                          placeholder={
                            key === 'p'
                              ? '例：再簡短一點 / 把劑量細節拿掉 / 用條列式'
                              : '例：語氣再中性一點 / 翻譯成英文'
                          }
                          className="min-h-[60px] resize-none border-sky-300 text-sm dark:border-sky-700"
                          disabled={st.refining}
                          onKeyDown={(e) => {
                            if (
                              e.key === 'Enter'
                              && (e.metaKey || e.ctrlKey)
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
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-400">
                            會套回同段，格式規則仍保留 · ⌘/Ctrl + Enter 送出
                          </p>
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
                            variant="outline"
                          >
                            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                            {st.refining ? '修改中...' : '再修一次'}
                            {st.refining ? <ButtonLoadingIndicator /> : null}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Composed output + copy button */}
      <Card className="border-emerald-300 dark:border-emerald-700">
        <CardHeader className="bg-emerald-50 py-3 dark:bg-emerald-950/30">
          <CardTitle className="flex items-center gap-2 text-base">
            <Copy className="h-4 w-4" />
            最終輸出（自動拼接 S + O + A + P）
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A / P 若已按 AI 修飾，會優先使用修飾後版本；S / O 逐字保留。
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <pre
            className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            data-testid="pharmacist-soap-composed"
          >
            {composed || '（尚未輸入內容）'}
          </pre>
          <Button
            onClick={handleCopy}
            disabled={!composed}
            className="w-full bg-brand hover:bg-brand-hover"
          >
            <Copy className="mr-2 h-4 w-4" />
            複製貼到 HIS
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
