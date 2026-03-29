import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionChatMessage } from './use-chat-sessions';

export function useChatUiState(chatMessages: SessionChatMessage[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const [expandedExplanations, setExpandedExplanations] = useState<Set<number>>(new Set());
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(new Set());
  const [expandedDataQuality, setExpandedDataQuality] = useState<Set<number>>(new Set());
  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showSessionList, setShowSessionList] = useState(true);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distFromBottom > 200);
  }, []);

  const jumpToLatest = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const toggleExplanation = useCallback((index: number) => {
    setExpandedExplanations((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleReferences = useCallback((index: number) => {
    setExpandedReferences((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleDataQuality = useCallback((index: number) => {
    setExpandedDataQuality((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    expandedExplanations,
    expandedReferences,
    expandedDataQuality,
    disclaimerCollapsed,
    setDisclaimerCollapsed,
    showScrollToBottom,
    showSessionList,
    setShowSessionList,
    handleMessagesScroll,
    jumpToLatest,
    toggleExplanation,
    toggleReferences,
    toggleDataQuality,
  };
}
