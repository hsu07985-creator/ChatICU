import type { TeamChatMessage } from './team-chat';
import type { MentionGroup } from './messages';

export interface MentionsCacheEntry {
  groups: MentionGroup[];
  total: number;
  unreadOnly: boolean;
}

export const MSGS_STALE_MS = 30 * 1000;
export const MENTIONS_STALE_MS = 2 * 60 * 1000;

interface ChatCache {
  msgs: TeamChatMessage[] | null;
  msgsTimestamp: number;
  mentions: MentionsCacheEntry | null;
  mentionsTimestamp: number;
}

export const chatCache: ChatCache = {
  msgs: null,
  msgsTimestamp: 0,
  mentions: null,
  mentionsTimestamp: 0,
};

export function resetChatCache(): void {
  chatCache.msgs = null;
  chatCache.msgsTimestamp = 0;
  chatCache.mentions = null;
  chatCache.mentionsTimestamp = 0;
}
