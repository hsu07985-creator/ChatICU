import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Textarea } from './textarea';
import type { TeamUser, UserRole } from '../../lib/api/team-chat';

const ROLE_LABEL: Record<UserRole, string> = {
  doctor: '醫師',
  np: '專科護理師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: 'admin',
};

// @<chinese/letter/digit>+ — stops at whitespace or punctuation. \p{L} covers
// Han characters; \p{N} for digits; underscore + hyphen are common in IDs.
const MENTION_REGEX = /@([\p{L}\p{N}_-]+)/gu;

export interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  /** Called whenever the set of mentioned user-IDs derivable from the text changes. */
  onMentionsChange?: (ids: string[]) => void;
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

  // Re-derive mentioned user IDs whenever text or user list changes.
  useEffect(() => {
    if (!onMentionsChange) return;
    const ids = new Set<string>();
    MENTION_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_REGEX.exec(value)) !== null) {
      const name = m[1];
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

  const filtered = useMemo(() => {
    if (!query) return users.slice(0, 8);
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q)).slice(0, 8);
  }, [users, query]);

  // Keep activeIdx in range when filter changes
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

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

  const handleSelect = (user: TeamUser) => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? value.length;
    const mention = detectMention(value, cursor);
    if (!mention) return;
    const before = value.slice(0, mention.at);
    const after = value.slice(cursor);
    const inserted = `@${user.name} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const newCursor = (before + inserted).length;
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelect(filtered[activeIdx]);
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
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 bottom-full mb-1 w-64 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg z-50"
          role="listbox"
          aria-label="使用者建議"
        >
          {filtered.map((u, idx) => {
            const isActive = idx === activeIdx;
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
                onMouseEnter={() => setActiveIdx(idx)}
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
