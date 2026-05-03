import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Textarea } from './textarea';
import type { TeamUser } from '../../lib/api/team-chat';
import { ROLE_LABEL } from '../../lib/utils/user-role';
import {
  MENTION_ALL_NAME,
  containsMentionAll,
  mentionRegex,
} from '../../lib/utils/mention-parser';

export interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  /** Called whenever the set of mentioned user-IDs derivable from the text changes. */
  onMentionsChange?: (ids: string[]) => void;
  /** Called whenever the textarea gains/loses an "@所有人" token. */
  onMentionsAllChange?: (mentionsAll: boolean) => void;
  /** When true, "@所有人" appears as the first dropdown option. */
  enableMentionAll?: boolean;
  users: TeamUser[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

interface MentionContext {
  at: number;
  query: string;
}

function detectMention(text: string, cursor: number): MentionContext | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const between = before.slice(at + 1);
  if (/\s/.test(between)) return null;
  return { at, query: between };
}

export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  onMentionsAllChange,
  enableMentionAll = false,
  users,
  placeholder,
  disabled,
  className,
  onKeyDown,
}: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const lastIdsKeyRef = useRef('');
  const lastAllRef = useRef(false);

  // Re-derive mentioned user IDs whenever text or user list changes.
  useEffect(() => {
    if (!onMentionsChange) return;
    const ids = new Set<string>();
    const re = mentionRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      const name = m[1];
      // Skip the "@所有人" sentinel — it is not a real user and is
      // tracked separately via onMentionsAllChange.
      if (name === MENTION_ALL_NAME) continue;
      for (const u of users) {
        if (u.name === name) ids.add(u.id);
      }
    }
    const key = [...ids].sort().join(',');
    if (key !== lastIdsKeyRef.current) {
      lastIdsKeyRef.current = key;
      onMentionsChange([...ids]);
    }
  }, [value, users, onMentionsChange]);

  // Re-derive @所有人 flag whenever text changes.
  useEffect(() => {
    if (!onMentionsAllChange) return;
    const next = enableMentionAll && containsMentionAll(value);
    if (next !== lastAllRef.current) {
      lastAllRef.current = next;
      onMentionsAllChange(next);
    }
  }, [value, enableMentionAll, onMentionsAllChange]);

  const filteredUsers = useMemo(() => {
    // Show all team members when no query — the popover scrolls (max-h-60).
    // The previous slice(0, 8) silently hid 黃英哲 / 曾涵雲 etc.
    if (!query) return users;
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q));
  }, [users, query]);

  // "所有人" appears at the top of the dropdown when its name matches
  // the current query (or there is no query). Pure prefix match — no
  // pinyin or alias — keeps the surface tiny and predictable.
  const showAllOption = useMemo(() => {
    if (!enableMentionAll) return false;
    if (!query) return true;
    return MENTION_ALL_NAME.startsWith(query);
  }, [enableMentionAll, query]);

  const optionCount = (showAllOption ? 1 : 0) + filteredUsers.length;

  // Keep activeIdx in range when filter changes
  useEffect(() => {
    if (activeIdx >= optionCount) setActiveIdx(0);
  }, [optionCount, activeIdx]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    const cursor = e.target.selectionStart ?? next.length;
    const mention = detectMention(next, cursor);
    if (mention) {
      setQuery(mention.query);
      setActiveIdx(0);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const insertAtMention = (label: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? value.length;
    const mention = detectMention(value, cursor);
    if (!mention) return;
    const before = value.slice(0, mention.at);
    const after = value.slice(cursor);
    const inserted = `@${label} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const newCursor = (before + inserted).length;
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleSelect = (user: TeamUser) => insertAtMention(user.name);
  const handleSelectAll = () => insertAtMention(MENTION_ALL_NAME);

  const selectActive = () => {
    if (showAllOption && activeIdx === 0) {
      handleSelectAll();
      return;
    }
    const userIdx = showAllOption ? activeIdx - 1 : activeIdx;
    const target = filteredUsers[userIdx];
    if (target) handleSelect(target);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && optionCount > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % optionCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + optionCount) % optionCount);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectActive();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative w-full">
      <Textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
      {open && optionCount > 0 && (
        <div
          className="absolute left-0 bottom-full mb-1 w-64 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg z-50"
          role="listbox"
          aria-label="使用者建議"
        >
          {showAllOption && (() => {
            const isActive = activeIdx === 0;
            return (
              <button
                key="__mention_all__"
                type="button"
                role="option"
                aria-selected={isActive}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b ${
                  isActive ? 'bg-rose-600 text-white' : 'hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectAll();
                }}
                onMouseEnter={() => setActiveIdx(0)}
              >
                <span className="font-medium">所有人</span>
                <span className={`text-xs ${isActive ? 'text-white/80' : 'text-rose-600/80 dark:text-rose-400/80'}`}>
                  通知全體成員
                </span>
              </button>
            );
          })()}
          {filteredUsers.map((u, idx) => {
            const optionIdx = showAllOption ? idx + 1 : idx;
            const isActive = optionIdx === activeIdx;
            return (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  isActive ? 'bg-brand text-white' : 'hover:bg-muted'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(u);
                }}
                onMouseEnter={() => setActiveIdx(optionIdx)}
              >
                <span className="font-medium">{u.name}</span>
                <span className={`text-xs ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}>
                  {ROLE_LABEL[u.role]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
