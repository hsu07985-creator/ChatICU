import { toast } from 'sonner';
import i18n from '../../i18n/config';
import { EMPTY_SOAP, type SoapDraft } from '../../components/pharmacist-soap-editor';

/* ---------------- localStorage 草稿 / 歷史 ---------------- */

/** Bump when the persisted draft shape changes in a way that needs migration.
 *  Currently informational only — `mergeDraft` already tolerates missing keys. */
export const DRAFT_STORAGE_VERSION = 1;

export type RecordType = 'progress-note' | 'medication-advice' | 'nursing-record';

export type DraftEntry = {
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
export type Drafts = Record<RecordType, DraftEntry>;

export const makeEmptyDraft = (): DraftEntry => ({
  input: '',
  polished: '',
  polishedFrom: '',
  soap: { ...EMPTY_SOAP },
  polishedSoap: { ...EMPTY_SOAP },
  selectedTemplate: '',
  selectedTemplateSnapshot: null,
});

export const EMPTY_DRAFT: DraftEntry = makeEmptyDraft();
export const EMPTY_DRAFTS: Drafts = {
  'progress-note': makeEmptyDraft(),
  'medication-advice': makeEmptyDraft(),
  'nursing-record': makeEmptyDraft(),
};

export const LEGACY_DRAFT_KEY = (patientId: string) => `chaticu-draft-${patientId}`;
export const draftKey = (userId: string | null | undefined, patientId: string): string | null =>
  userId ? `chaticu-draft-${userId}-${patientId}` : null;

export function mergeDraft(parsed: Partial<DraftEntry> | undefined): DraftEntry {
  const base = makeEmptyDraft();
  if (!parsed) return base;
  return {
    ...base,
    ...parsed,
    soap: { ...base.soap, ...(parsed.soap || {}) },
    polishedSoap: { ...base.polishedSoap, ...(parsed.polishedSoap || {}) },
  };
}

export function parseDraftsBlob(raw: string | null): Drafts {
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

export function loadDrafts(userId: string | null | undefined, patientId: string): Drafts {
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

// Process-global guard: surface the quota warning at most once per session so
// the user knows their drafts may not survive reload, instead of failing
// silently on every keystroke.
let quotaToastShown = false;

export function saveDrafts(userId: string | null | undefined, patientId: string, drafts: Drafts) {
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
