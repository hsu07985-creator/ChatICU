import { isAxiosError } from 'axios';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  streamChatMessage,
  extractStreamMainContent,
  updateChatSessionTitle,
  updateMessageFeedback,
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
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);

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

      setThinkingStatus('正在準備回覆…');
      const response = await new Promise<ChatResponse>((resolve, reject) => {
        let rawBuffer = '';
        let rafId: number | null = null;

        const flushDisplay = () => {
          rafId = null;
          const mainContent = extractStreamMainContent(rawBuffer);
          setChatMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (last?.role !== 'assistant') return prev;
            next[lastIndex] = { ...last, content: mainContent };
            return next;
          });
        };

        streamChatMessage({
          message: userMessage,
          patientId: effectivePatientId,
          sessionId: selectedSessionId,
          onThinking: (detail) => {
            setThinkingStatus(detail);
          },
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
            if (rafId === null) {
              rafId = requestAnimationFrame(flushDisplay);
            }
          },
          onComplete: (streamResult) => {
            // Flush any remaining content before completing
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            const mainContent = extractStreamMainContent(rawBuffer);
            setChatMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = { ...last, content: mainContent };
              return next;
            });
            setThinkingStatus(null);
            resolve(streamResult);
          },
          onError: (error) => {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
            }
            setThinkingStatus(null);
            reject(error);
          },
        });
      });

      const assistantMsg: SessionChatMessage = {
        role: 'assistant',
        content: response.message.content,
        messageId: response.message.id,
        explanation: response.message.explanation || null,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        graphMeta: response.message.graphMeta || null,
        feedback: null,
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
        } else if (err.response) {
          errorMessage = `AI 服務錯誤（HTTP ${err.response.status}）`;
        }
      } else if (err instanceof Error && err.message) {
        errorMessage = `AI 回覆失敗：${err.message}`;
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
      setThinkingStatus(null);
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

  const setMessageFeedback = useCallback(
    async (msgIndex: number, feedback: 'up' | 'down' | null) => {
      const msg = chatMessages[msgIndex];
      if (!msg || msg.role !== 'assistant' || !msg.messageId) return;

      const newFeedback = msg.feedback === feedback ? null : feedback;
      setChatMessages((prev) => {
        const next = [...prev];
        next[msgIndex] = { ...next[msgIndex], feedback: newFeedback };
        return next;
      });
      try {
        await updateMessageFeedback(msg.messageId, newFeedback);
      } catch {
        // Revert on failure
        setChatMessages((prev) => {
          const next = [...prev];
          next[msgIndex] = { ...next[msgIndex], feedback: msg.feedback };
          return next;
        });
        toast.error('回饋儲存失敗');
      }
    },
    [chatMessages],
  );

  const regenerateMessage = useCallback(
    async (msgIndex: number) => {
      if (isSending) return;
      // Find the user message right before this assistant message
      const assistantMsg = chatMessages[msgIndex];
      if (!assistantMsg || assistantMsg.role !== 'assistant') return;

      let userMsgIndex = msgIndex - 1;
      while (userMsgIndex >= 0 && chatMessages[userMsgIndex].role !== 'user') {
        userMsgIndex--;
      }
      if (userMsgIndex < 0) return;

      const userMessage = chatMessages[userMsgIndex].content;
      const effectivePatientId = patientId || fallbackPatientId;
      if (!effectivePatientId) return;

      // Remove the old assistant message and replace with streaming placeholder
      const messagesBeforeAssistant = chatMessages.slice(0, msgIndex);
      setChatMessages([...messagesBeforeAssistant, { role: 'assistant', content: '' }]);
      setIsSending(true);

      try {
        setThinkingStatus('正在重新生成…');
        const response = await new Promise<ChatResponse>((resolve, reject) => {
          let rawBuffer = '';
          let rafId: number | null = null;

          const flushDisplay = () => {
            rafId = null;
            const mainContent = extractStreamMainContent(rawBuffer);
            setChatMessages((prev) => {
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = { ...last, content: mainContent };
              return next;
            });
          };

          streamChatMessage({
            message: userMessage,
            patientId: effectivePatientId,
            sessionId: selectedSessionId,
            onThinking: (detail) => setThinkingStatus(detail),
            onMessage: (chunk) => {
              if (!chunk) return;
              rawBuffer += chunk;
              if (rafId === null) {
                rafId = requestAnimationFrame(flushDisplay);
              }
            },
            onComplete: (streamResult) => {
              if (rafId !== null) {
                cancelAnimationFrame(rafId);
              }
              const mainContent = extractStreamMainContent(rawBuffer);
              setChatMessages((prev) => {
                const next = [...prev];
                const lastIndex = next.length - 1;
                const last = next[lastIndex];
                if (last?.role !== 'assistant') return prev;
                next[lastIndex] = { ...last, content: mainContent };
                return next;
              });
              setThinkingStatus(null);
              resolve(streamResult);
            },
            onError: (error) => {
              if (rafId !== null) cancelAnimationFrame(rafId);
              setThinkingStatus(null);
              reject(error);
            },
          });
        });

        const newAssistantMsg: SessionChatMessage = {
          role: 'assistant',
          content: response.message.content,
          messageId: response.message.id,
          explanation: response.message.explanation || null,
          references: response.message.citations || [],
          warnings: response.message.safetyWarnings || null,
          requiresExpertReview: response.message.requiresExpertReview || false,
          degraded: response.message.degraded || false,
          degradedReason: response.message.degradedReason || null,
          upstreamStatus: response.message.upstreamStatus || null,
          dataFreshness: response.message.dataFreshness || null,
          graphMeta: response.message.graphMeta || null,
          feedback: null,
          timestamp: new Date().toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };

        setChatMessages([...messagesBeforeAssistant, newAssistantMsg]);
      } catch {
        setChatMessages([
          ...messagesBeforeAssistant,
          { role: 'assistant', content: '重新生成失敗，請稍後再試。' },
        ]);
      } finally {
        setIsSending(false);
        setThinkingStatus(null);
      }
    },
    [chatMessages, isSending, patientId, fallbackPatientId, selectedSessionId],
  );

  return {
    chatInput,
    setChatInput,
    chatMessages,
    setChatMessages,
    clearChatMessages,
    isSending,
    thinkingStatus,
    sendMessage,
    setMessageFeedback,
    regenerateMessage,
  };
}
