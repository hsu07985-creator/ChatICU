import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Returns true when the user pressed Cmd/Ctrl+Enter intentionally (not while
 * an IME composition is in progress). The composition check is critical for
 * Chinese / Japanese / Korean input methods where Enter commits the candidate
 * — without this guard, picking a 中文 candidate would trigger submit.
 *
 * Use on every Cmd/Ctrl+Enter handler in this codebase.
 */
export function isCmdEnter(e: ReactKeyboardEvent): boolean {
  if (e.key !== 'Enter') return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  // `isComposing` lives on the native event; not all React typings expose it.
  const native = e.nativeEvent as KeyboardEvent | undefined;
  if (native?.isComposing) return false;
  // keyCode 229 is the legacy IME-in-progress signal (Safari, some Android).
  if (native && (native as KeyboardEvent).keyCode === 229) return false;
  return true;
}
