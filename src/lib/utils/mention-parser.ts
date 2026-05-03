// @<chinese/letter/digit>+ — stops at whitespace or punctuation. \p{L} covers
// Han characters; \p{N} for digits; underscore + hyphen are common in IDs.
//
// Returns a fresh RegExp each call because the `g` flag makes the instance
// stateful via `lastIndex`; sharing a singleton across callers would corrupt
// iteration when one caller's `exec` resumes from another's leftover position.
export const mentionRegex = (): RegExp => /@([\p{L}\p{N}_-]+)/gu;

// Sentinel name used to flag "@所有人" mentions. Kept as a single source
// of truth so the textarea inserter, send-side detector, and UI badge
// label all agree.
export const MENTION_ALL_NAME = '所有人';

export const mentionAllRegex = (): RegExp => /@所有人(?![\p{L}\p{N}_-])/u;

export function containsMentionAll(text: string): boolean {
  return mentionAllRegex().test(text);
}
