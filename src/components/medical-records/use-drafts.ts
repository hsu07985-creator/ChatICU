import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadDrafts,
  saveDrafts,
  type DraftEntry,
  type Drafts,
  type RecordType,
} from '../../lib/medical-records/draft-storage';

export interface UseDraftsResult {
  drafts: Drafts;
  /** Patch a single record-type's draft and persist the full blob. */
  updateDraft: (type: RecordType, patch: Partial<DraftEntry>) => void;
  /** Replace the in-memory drafts (used by tests / external reloads). */
  setDraftsState: React.Dispatch<React.SetStateAction<Drafts>>;
}

/**
 * Owns the per-type, per-patient, per-user draft state and its localStorage
 * persistence. Reloads drafts whenever the patient or user changes; the
 * provided `onPatientOrUserSwitch` callback fires *before* the reload so the
 * caller can abort any in-flight polish (preventing a streaming chunk from
 * writing into the new patient's localStorage — P0-7).
 */
export function useDrafts(
  userId: string | null | undefined,
  patientId: string,
  onPatientOrUserSwitch?: () => void,
): UseDraftsResult {
  const [drafts, setDraftsState] = useState<Drafts>(() => loadDrafts(userId, patientId));

  // Keep the latest switch callback in a ref so the reload effect depends only
  // on (patientId, userId) — matching the original component's effect deps.
  const switchCbRef = useRef(onPatientOrUserSwitch);
  switchCbRef.current = onPatientOrUserSwitch;

  // Reload drafts on (patient | user) switch + let the caller abort any
  // in-flight polish so the chunk callback can't write into the new patient's
  // localStorage (P0-7). user.id changes after auth hydrate → triggers reload
  // from the namespaced key.
  useEffect(() => {
    switchCbRef.current?.();
    setDraftsState(loadDrafts(userId, patientId));
  }, [patientId, userId]);

  const updateDraft = useCallback(
    (type: RecordType, patch: Partial<DraftEntry>) => {
      setDraftsState((prev) => {
        const next: Drafts = {
          ...prev,
          [type]: { ...prev[type], ...patch },
        };
        saveDrafts(userId, patientId, next);
        return next;
      });
    },
    [patientId, userId],
  );

  return { drafts, updateDraft, setDraftsState };
}
