import { useCallback, useEffect, useState } from 'react';
import {
  deleteChatSession,
  getChatSession as fetchChatSessionApi,
  getChatSessions as fetchChatSessionsApi,
  type ChatMessage as ApiChatMessage,
  type ChatSession as ApiChatSession,
  type Citation as AiCitation,
  type DataFreshness,
  type GraphMeta,
} from '../lib/api/ai';

export interface SessionChatMessage {
  role: 'user' | 'assistant';
  content: string;
  explanation?: string | null;
  timestamp?: string;
  references?: AiCitation[];
  warnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  graphMeta?: GraphMeta | null;
}

export interface SessionListItem {
  id: string;
  patientId: string;
  sessionDate: string;
  sessionTime: string;
  title: string;
  messages: SessionChatMessage[];
  lastUpdated: string;
  messageCount?: number;
  labDataSnapshot?: {
    K?: number;
    Na?: number;
    Scr?: number;
    eGFR?: number;
    CRP?: number;
    WBC?: number;
  };
}

function toLocalDateKey(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapApiSession(item: ApiChatSession, patientId: string): SessionListItem {
  return {
    id: item.id,
    patientId: item.patientId || patientId,
    sessionDate: toLocalDateKey(item.createdAt),
    sessionTime: new Date(item.createdAt).toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    title: item.title,
    messages: [],
    lastUpdated: new Date(item.updatedAt).toLocaleString('zh-TW'),
    messageCount: item.messageCount,
  };
}

function mapApiMessage(item: ApiChatMessage): SessionChatMessage {
  let timestamp: string | undefined;
  if (item.timestamp) {
    try {
      timestamp = new Date(item.timestamp).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      timestamp = undefined;
    }
  }

  return {
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content,
    explanation: item.explanation || null,
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

export function useChatSessions(patientId?: string) {
  const [chatSessions, setChatSessions] = useState<SessionListItem[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionListItem | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');

  const refreshChatSessions = useCallback(async () => {
    if (!patientId) return;
    try {
      const sessionsData = await fetchChatSessionsApi({ patientId });
      setChatSessions(sessionsData.sessions.map((item) => mapApiSession(item, patientId)));
    } catch {
      setChatSessions([]);
    }
  }, [patientId]);

  const clearSessionSelection = useCallback(() => {
    setSelectedSession(null);
    setSessionTitle('');
  }, []);

  const openSession = useCallback(async (session: SessionListItem): Promise<SessionChatMessage[] | null> => {
    setSelectedSession(session);
    setSessionTitle(session.title);
    try {
      const detail = await fetchChatSessionApi(session.id);
      return (detail.messages || []).map(mapApiMessage);
    } catch {
      return null;
    }
  }, []);

  const removeSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      await deleteChatSession(sessionId);
      const wasSelected = selectedSession?.id === sessionId;
      if (wasSelected) {
        clearSessionSelection();
      }
      await refreshChatSessions();
      return wasSelected;
    },
    [clearSessionSelection, refreshChatSessions, selectedSession],
  );

  const selectNewSession = useCallback(
    (sessionId: string, fallbackPatientId: string, title: string) => {
      const now = new Date();
      setSelectedSession({
        id: sessionId,
        patientId: fallbackPatientId,
        sessionDate: toLocalDateKey(now),
        sessionTime: now.toLocaleTimeString('zh-TW', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        title,
        messages: [],
        lastUpdated: now.toLocaleString('zh-TW'),
      });
      setSessionTitle(title);
    },
    [],
  );

  useEffect(() => {
    clearSessionSelection();
  }, [clearSessionSelection, patientId]);

  useEffect(() => {
    void refreshChatSessions();
  }, [refreshChatSessions]);

  return {
    chatSessions,
    selectedSession,
    sessionTitle,
    setSessionTitle,
    refreshChatSessions,
    clearSessionSelection,
    openSession,
    removeSession,
    selectNewSession,
  };
}
