import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { streamPolishClinicalText, PolishStreamError } from '../../lib/api/ai';
import { polishTypeMap, type RecordType } from '../../lib/medical-records/templates';
import type { DraftEntry } from '../../lib/medical-records/draft-storage';

export interface UseClinicalPolishArgs {
  patientId: string;
  recordType: RecordType;
  updateDraft: (type: RecordType, patch: Partial<DraftEntry>) => void;
  canPolish: boolean;
  polishReason: string;
}

export interface PolishContentArgs {
  /** Current draft input — also used as the frozen source snapshot. */
  inputContent: string;
  /** Flattened template content sent to the polish endpoint, if any. */
  templateContent: string | undefined;
}

export interface RefineArgs {
  inputContent: string;
  refinementInstruction: string;
  polishedContent: string;
  onSuccess: () => void;
}

export interface UseClinicalPolishResult {
  polishAbortRef: React.MutableRefObject<AbortController | null>;
  refineAbortRef: React.MutableRefObject<AbortController | null>;
  isPolishing: boolean;
  isRefining: boolean;
  polishContent: (args: PolishContentArgs) => Promise<void>;
  refine: (args: RefineArgs) => Promise<void>;
}

/**
 * Owns the clinical-polish + refine streaming lifecycle: abort controllers,
 * loading flags, and the chunk → draft persistence wiring. Behavior is
 * identical to the original inline handlers — the source snapshot is frozen at
 * call time so `polishedFrom` reliably reflects the run even if the user keeps
 * typing while the stream is in flight.
 */
export function useClinicalPolish({
  patientId,
  recordType,
  updateDraft,
  canPolish,
  polishReason,
}: UseClinicalPolishArgs): UseClinicalPolishResult {
  const { t } = useTranslation('medical-records');

  // Abort controllers. Polish takes 10–20s; let the user cancel and prevent
  // cross-patient pollution.
  const polishAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);

  const [isPolishing, setIsPolishing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  const polishContent = useCallback(
    async ({ inputContent, templateContent }: PolishContentArgs) => {
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
    },
    [patientId, recordType, updateDraft, canPolish, polishReason, t],
  );

  const refine = useCallback(
    async ({ inputContent, refinementInstruction, polishedContent, onSuccess }: RefineArgs) => {
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
        onSuccess();
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
    },
    [patientId, recordType, updateDraft, canPolish, polishReason, t],
  );

  return {
    polishAbortRef,
    refineAbortRef,
    isPolishing,
    isRefining,
    polishContent,
    refine,
  };
}
