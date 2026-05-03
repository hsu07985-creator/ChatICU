// @<chinese/letter/digit>+ — stops at whitespace or punctuation. \p{L} covers
// Han characters; \p{N} for digits; underscore + hyphen are common in IDs.
//
// Returns a fresh RegExp each call because the `g` flag makes the instance
// stateful via `lastIndex`; sharing a singleton across callers would corrupt
// iteration when one caller's `exec` resumes from another's leftover position.
export const mentionRegex = (): RegExp => /@([\p{L}\p{N}_-]+)/gu;
