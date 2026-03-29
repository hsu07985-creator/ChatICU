import { isAxiosError } from 'axios';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  streamChatMessage,
  updateChatSessionTitle,
  type ChatResponse,
} from '../lib/api/ai';
import type { SessionChatMessage } from './use-chat-sessions';

interface UseAiChatConversationOptions {
  patientId?: string;
  fallbackPatientId?: string;
  selectedSessionId?: string;
  sessionTitle: string;
  canSendAiChat: boolean;
  aiChatGateReason: string;
  onRefreshSessions: () => Promise<void>;
  onSelectNewSession: (sessionId: string, patientId: string, title: string) => void;
  onInputCleared?: () => void;
}

export function useAiChatConversation(options: UseAiChatConversationOptions) {
  const {
    patientId,
    fallbackPatientId,
    selectedSessionId,
    sessionTitle,
    canSendAiChat,
    aiChatGateReason,
    onRefreshSessions,
    onSelectNewSession,
    onInputCleared,
  } = options;

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<SessionChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  const clearChatMessages = useCallback(() => {
    setChatMessages([]);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!chatInput.trim() || isSending) return;
    if (!canSendAiChat) {
      toast.error(aiChatGateReason);
      return;
    }

    const effectivePatientId = patientId || fallbackPatientId;
    if (!effectivePatientId) {
      toast.error('找不到病患識別，無法發送訊息');
      return;
    }

    const userMessage = chatInput.trim();
    const nowTime = new Date().toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const messagesWithUser: SessionChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: userMessage, timestamp: nowTime },
    ];

    setChatMessages(messagesWithUser);
    setChatInput('');
    onInputCleared?.();
    setIsSending(true);

    try {
      setChatMessages([
        ...messagesWithUser,
        {
          role: 'assistant',
          content: '',
        },
      ]);

      const response = await new Promise<ChatResponse>((resolve, reject) => {
        streamChatMessage({
          message: userMessage,
          patientId: effectivePatientId,
          sessionId: selectedSessionId,
          onMessage: (chunk) => {
            if (!chunk) return;
            setChatMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = {
                ...last,
                content: `${last.content || ''}${chunk}`,
              };
              return next;
            });
          },
          onComplete: (streamResult) => resolve(streamResult),
          onError: (error) => reject(error),
        });
      });

      const assistantMsg: SessionChatMessage = {
        role: 'assistant',
        content: response.message.content,
        explanation: response.message.explanation || null,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        graphMeta: response.message.graphMeta || null,
        timestamp: new Date().toLocaleTimeString('zh-TW', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      const finalMessages = [...messagesWithUser, assistantMsg];
      setChatMessages(finalMessages);

      if (!selectedSessionId) {
        if (sessionTitle.trim()) {
          try {
            await updateChatSessionTitle(response.sessionId, sessionTitle.trim());
          } catch {
            // Non-blocking: chat still works even if title update fails
          }
        }
        await onRefreshSessions();
        onSelectNewSession(
          response.sessionId,
          effectivePatientId,
          sessionTitle.trim() || userMessage.slice(0, 50),
        );
      } else {
        await onRefreshSessions();
      }
    } catch (err) {
      console.error('AI 回覆失敗:', err);
      let errorMessage = 'AI 助手目前無法回應，請確認後端服務是否正常運行，稍後再試。';
      if (isAxiosError(err)) {
        const data = err.response?.data as { message?: unknown; detail?: unknown } | undefined;
        const detail = data?.message ?? data?.detail;
        if (typeof detail === 'string' && detail.trim()) {
          errorMessage = `AI 服務暫時不可用：${detail}`;
        }
      }
      setChatMessages([
        ...messagesWithUser,
        {
          role: 'assistant',
          content: errorMessage,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }, [
    aiChatGateReason,
    canSendAiChat,
    chatInput,
    chatMessages,
    fallbackPatientId,
    onInputCleared,
    onRefreshSessions,
    onSelectNewSession,
    patientId,
    selectedSessionId,
    sessionTitle,
    isSending,
  ]);

  return {
    chatInput,
    setChatInput,
    chatMessages,
    setChatMessages,
    clearChatMessages,
    isSending,
    sendMessage,
  };
}
