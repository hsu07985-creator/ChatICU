// AI 問答頁的純資料轉換 helper / 型別 / 常數。
// 從 ai-chat.tsx 抽出(D1 page-split,2026-07-20);零 React/state 依賴。
import {
  splitMainAndDetail,
  type ChatSession as ApiChatSession,
  type Citation as AiCitation,
  type DataFreshness,
  type GraphMeta,
} from '../lib/api/ai';
import type { SessionChatMessage } from '../lib/api/ai';
import i18n from '../i18n/config';

// Must match backend `_MAX_MESSAGE_LENGTH` in ai_chat.py. Bumped from 4000
// → 8000 on 2026-05-13 after users hit HTTP 422 pasting ~4200-char drafts.
export const MAX_MESSAGE_LENGTH = 8000;
export const MESSAGE_WARN_THRESHOLD = Math.floor(MAX_MESSAGE_LENGTH * 0.9);

export interface SessionItem {
  id: string;
  title: string;
  sessionDate: string;
  sessionTime: string;
  lastUpdated: string;
  messageCount?: number;
}

export function toLocalDateKey(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function mapApiSession(item: ApiChatSession): SessionItem {
  const created = new Date(item.createdAt);
  return {
    id: item.id,
    title: item.title,
    sessionDate: toLocalDateKey(created),
    sessionTime: created.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    lastUpdated: new Date(item.updatedAt).toLocaleString('zh-TW'),
    messageCount: item.messageCount,
  };
}

export function formatCitationPageText(citation: AiCitation): string {
  const tr = (k: string, opts?: Record<string, unknown>) => i18n.t(k, { ns: 'chat', ...(opts ?? {}) }) as string;
  const pages = Array.isArray(citation.pages)
    ? citation.pages.filter((p): p is number => Number.isFinite(Number(p))).map((p) => Number(p))
    : [];
  if (pages.length > 1) {
    const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
    return tr('ai.citation.pages', { pages: uniq.join('、') });
  }
  if (typeof citation.page === 'number') return tr('ai.citation.page', { page: citation.page });
  if (pages.length === 1) return tr('ai.citation.page', { page: pages[0] });
  return tr('ai.citation.pageMissing');
}

export function compactSnippet(snippet?: string): string {
  return String(snippet || '').trim();
}

export function mapApiMessage(item: {
  role: string;
  content: string;
  explanation?: string | null;
  timestamp?: string | null;
  citations?: AiCitation[];
  safetyWarnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  graphMeta?: GraphMeta | null;
}): SessionChatMessage {
  let timestamp: string | undefined;
  if (item.timestamp) {
    try {
      timestamp = new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    } catch {
      timestamp = undefined;
    }
  }
  // FIX-LOAD-SPLIT (2026-05-03): assistant `content` from the backend is
  // the raw concatenated string with 【說明/補充】 inline. Without this
  // split, the bubble shows main + detail in one block on session reload
  // (the 詳細 collapse button only appears for live-sent messages because
  // the send path was the only one calling splitMainAndDetail). Match
  // patient-detail.tsx's send-time logic so live and reloaded views are
  // identical — backend `explanation` takes precedence if it ever arrives
  // populated (no current path emits it, but contract preserved).
  let mainContent = item.content || '';
  let detailContent: string | null = item.explanation || null;
  if (!detailContent && item.role === 'assistant' && mainContent) {
    const split = splitMainAndDetail(mainContent);
    mainContent = split.main;
    detailContent = split.detail;
  }
  return {
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: mainContent,
    explanation: detailContent,
    timestamp,
    references: item.citations || [],
    warnings: item.safetyWarnings || null,
    requiresExpertReview: item.requiresExpertReview || false,
    degraded: item.degraded || false,
    degradedReason: item.degradedReason || null,
    upstreamStatus: item.upstreamStatus || null,
    dataFreshness: item.dataFreshness || null,
    graphMeta: item.graphMeta || null,
  };
}
