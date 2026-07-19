import { useMemo } from 'react';
import { Pin, Trash2, CornerUpLeft } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ButtonLoadingIndicator } from '../../components/ui/button-loading-indicator';
import type { TeamChatMessage, TeamUser } from '../../lib/api/team-chat';
import { roleLabel } from '../../lib/utils/user-role';
import { MENTION_ALL_NAME, mentionRegex } from '../../lib/utils/mention-parser';
import { formatTimestamp } from './format-timestamp';
import { useTranslation } from 'react-i18next';

/**
 * Render message content, highlighting @姓名 tokens that match real users and
 * the @所有人 broadcast sentinel. Pure typography styling — no chip, no
 * background — so the highlight stays inline; @所有人 adds an underline to
 * read as a broadcast vs a personal mention.
 */
function renderMentionContent(
  content: string,
  userByName: Map<string, TeamUser>,
  mentionClass?: string,
) {
  if (!userByName.size) return content;
  const cls = mentionClass ?? 'font-semibold text-brand dark:text-brand-light';
  const allCls = `${cls} underline underline-offset-4`;
  type MentionPart = { name: string; kind: 'user' | 'all' | 'plain' };
  const parts: Array<string | MentionPart> = [];
  const re = mentionRegex();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    const name = m[1];
    const kind: MentionPart['kind'] =
      name === MENTION_ALL_NAME ? 'all' : userByName.has(name) ? 'user' : 'plain';
    parts.push({ name, kind });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts.map((p, i) => {
    if (typeof p === 'string') return <span key={i}>{p}</span>;
    if (p.kind === 'all') return <span key={i} className={allCls}>@{p.name}</span>;
    if (p.kind === 'user') return <span key={i} className={cls}>@{p.name}</span>;
    return <span key={i}>@{p.name}</span>;
  });
}

export interface ChatMessageBubbleProps {
  msg: TeamChatMessage;
  currentUserId?: string;
  isAdmin: boolean;
  repliedTo: TeamChatMessage | null;
  userByName: Map<string, TeamUser>;
  flashed: boolean;
  pinning: boolean;
  deleting: boolean;
  onReply: (msg: TeamChatMessage) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onJumpToParent: (id: string) => void;
}

/**
 * LINE-style chat bubble: self → right-aligned mint, others → left-aligned
 * gray with avatar + name above. Replies show a quote block INSIDE the bubble
 * pointing back to the parent.
 */
export function ChatMessageBubble({
  msg,
  currentUserId,
  isAdmin,
  repliedTo,
  userByName,
  flashed,
  pinning,
  deleting,
  onReply,
  onTogglePin,
  onDelete,
  onJumpToParent,
}: ChatMessageBubbleProps) {
  const { t } = useTranslation('chat');
  const isSelf = !!currentUserId && msg.userId === currentUserId;
  const content = useMemo(
    () => renderMentionContent(msg.content, userByName),
    [msg.content, userByName],
  );

  const bubbleClass = isSelf
    ? 'bg-[#DCF8C6] dark:bg-emerald-600 text-slate-900 dark:text-white'
    : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100';
  const cornerClass = isSelf ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl rounded-tl-sm';

  return (
    <div
      id={`msg-${msg.id}`}
      data-testid="team-chat-message"
      className={`group flex gap-2 transition-all duration-300 rounded-2xl py-1 ${isSelf ? 'flex-row-reverse' : 'flex-row'} ${flashed ? 'ring-2 ring-brand ring-offset-2 ring-offset-background bg-brand/5' : 'ring-0'}`}
    >
      {/* Avatar — only for others (self knows it's themself) */}
      {!isSelf && (
        <div className="shrink-0 mt-5 h-8 w-8 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200">
          {msg.userName.slice(0, 1)}
        </div>
      )}

      <div className={`flex flex-col max-w-[78%] ${isSelf ? 'items-end' : 'items-start'}`}>
        {/* Header row above bubble — name+role for others, pin badge for any */}
        {(!isSelf || msg.pinned) && (
          <div className={`flex items-center gap-1.5 mb-1 px-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
            {!isSelf && (
              <>
                <span className="text-xs font-medium text-foreground">{msg.userName}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {roleLabel(msg.userRole)}
                </Badge>
              </>
            )}
            {msg.pinned && (
              <Badge className="bg-[#f59e0b] text-white text-[10px] px-1 py-0 h-4">
                <Pin className="h-2.5 w-2.5 mr-0.5" />
                {t('team.message.pinnedBadge')}
              </Badge>
            )}
          </div>
        )}

        {/* Bubble + hover actions, side-by-side */}
        <div className={`flex items-end gap-1 ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`px-3 py-2 ${bubbleClass} ${cornerClass} shadow-sm`}>
            {/* Reply quote — click to jump to the parent message */}
            {repliedTo && (
              <button
                type="button"
                onClick={() => onJumpToParent(repliedTo.id)}
                className={`mb-1.5 pl-2 border-l-2 text-left w-full block rounded transition-colors hover:bg-black/5 ${isSelf ? 'border-slate-700/40' : 'border-slate-500/40 dark:border-slate-300/40'} opacity-90 hover:opacity-100`}
                title={t('team.message.jumpToOriginal')}
              >
                <div className="text-[11px] font-medium flex items-center gap-1">
                  <CornerUpLeft className="h-2.5 w-2.5" />
                  {t('team.input.replyPrefix')} {repliedTo.userName}
                </div>
                <div className="text-xs truncate max-w-[260px] sm:max-w-[320px]">
                  {repliedTo.content}
                </div>
              </button>
            )}
            <p className="text-base leading-relaxed whitespace-pre-wrap break-words">
              {content}
            </p>
          </div>

          {/* Hover actions, opposite side from the bubble */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity self-center">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-brand"
              onClick={() => onReply(msg)}
              title={t('team.message.replyTitle')}
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </Button>
            {isAdmin && (
              <span className="inline-flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 w-7 p-0 ${msg.pinned ? 'text-[#f59e0b]' : 'text-muted-foreground hover:text-[#f59e0b]'}`}
                  onClick={() => void onTogglePin(msg.id)}
                  disabled={pinning}
                  title={msg.pinned ? t('team.message.togglePinFrom') : t('team.message.togglePinTo')}
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
                {pinning ? <ButtonLoadingIndicator compact /> : null}
              </span>
            )}
            {isAdmin && (
              <span className="inline-flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => void onDelete(msg.id)}
                  disabled={deleting}
                  title={t('team.message.deleteTitle')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {deleting ? <ButtonLoadingIndicator compact /> : null}
              </span>
            )}
          </div>
        </div>

        {/* Timestamp under bubble */}
        <div className={`text-[10px] text-muted-foreground mt-1 px-1 ${isSelf ? 'text-right' : 'text-left'}`}>
          {formatTimestamp(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}
