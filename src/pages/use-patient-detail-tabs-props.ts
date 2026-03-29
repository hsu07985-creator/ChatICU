import { useMemo } from 'react';
import type React from 'react';
import type { Citation as AiCitation, DataFreshness } from '../lib/api/ai';
import type { UserRole } from '../lib/auth-context';
import type { SessionChatMessage, SessionListItem } from '../hooks/use-chat-sessions';
import { PatientChatTab } from '../components/patient/patient-chat-tab';
import { PatientLabsTab } from '../components/patient/patient-labs-tab';
import { PatientMedicationsTab } from '../components/patient/patient-medications-tab';
import { PatientMessagesTab } from '../components/patient/patient-messages-tab';

interface UsePatientDetailTabsPropsParams {
  patientId?: string;
  userRole?: UserRole;
  messages: React.ComponentProps<typeof PatientMessagesTab>['messages'];
  messagesLoading: boolean;
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSendGeneralMessage: (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => void | Promise<void>;
  onSendMedicationAdvice: (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  onMarkMessageRead: (messageId: string) => void | Promise<void>;
  formatTimestamp: (timestamp: string) => string;
  presetTags: string[];
  onUpdateTags: (messageId: string, data: { add?: string[]; remove?: string[] }) => void | Promise<void>;
  onRespondToAdvice: (adviceRecordId: string, accepted: boolean) => void | Promise<void>;

  showSessionList: boolean;
  chatSessions: SessionListItem[];
  selectedSessionId?: string;
  onStartNewSession: () => void;
  onOpenSession: (session: SessionListItem) => void | Promise<void>;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  onCancelDeleteSession: () => void | Promise<void>;
  onConfirmDeleteSession: () => void | Promise<void>;
  deleteSessionDialogOpen: boolean;
  deleteSessionTargetId?: string | null;
  deletingSession: boolean;
  formatSnapshotValue: (value: number | undefined) => string;
  disclaimerCollapsed: boolean;
  onSetDisclaimerCollapsed: (value: boolean) => void;
  canSendAiChat: boolean;
  onToggleSessionList: () => void;
  chatMessages: SessionChatMessage[];
  isSending: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onMessagesScroll: () => void;
  showScrollToBottom: boolean;
  onJumpToLatest: () => void;
  expandedExplanations: Set<number>;
  expandedReferences: Set<number>;
  expandedDataQuality: Set<number>;
  onToggleExplanation: (index: number) => void;
  onToggleReferences: (index: number) => void;
  onToggleDataQuality: (index: number) => void;
  getDisplayFreshnessHints: (dataFreshness?: DataFreshness | null) => string[];
  formatAiDegradedReason: (reason?: string | null, upstreamStatus?: string | null) => string;
  formatCitationPageText: (citation: AiCitation) => string;
  compactSnippet: (snippet?: string) => string;
  avatarSrc: string;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void | Promise<void>;

  labsTabProps: React.ComponentProps<typeof PatientLabsTab>;
  medicationsTabProps: React.ComponentProps<typeof PatientMedicationsTab>;
}

export function usePatientDetailTabsProps(params: UsePatientDetailTabsPropsParams) {
  const {
    patientId,
    userRole,
    messages,
    messagesLoading,
    messageInput,
    onMessageInputChange,
    onSendGeneralMessage,
    onSendMedicationAdvice,
    onMarkAllRead,
    onMarkMessageRead,
    formatTimestamp,
    presetTags,
    onUpdateTags,
    onRespondToAdvice,
    showSessionList,
    chatSessions,
    selectedSessionId,
    onStartNewSession,
    onOpenSession,
    onDeleteSession,
    onCancelDeleteSession,
    onConfirmDeleteSession,
    deleteSessionDialogOpen,
    deleteSessionTargetId,
    deletingSession,
    formatSnapshotValue,
    disclaimerCollapsed,
    onSetDisclaimerCollapsed,
    canSendAiChat,
    onToggleSessionList,
    chatMessages,
    isSending,
    messagesContainerRef,
    messagesEndRef,
    onMessagesScroll,
    showScrollToBottom,
    onJumpToLatest,
    expandedExplanations,
    expandedReferences,
    expandedDataQuality,
    onToggleExplanation,
    onToggleReferences,
    onToggleDataQuality,
    getDisplayFreshnessHints,
    formatAiDegradedReason,
    formatCitationPageText,
    compactSnippet,
    avatarSrc,
    chatInputRef,
    chatInput,
    onChatInputChange,
    onSendMessage,
    labsTabProps,
    medicationsTabProps,
  } = params;

  return useMemo(() => {
    const unreadMessagesCount = messages.filter((message) => !message.isRead).length;

    const chatTabProps: React.ComponentProps<typeof PatientChatTab> = {
      showSessionList,
      chatSessions,
      selectedSessionId,
      onStartNewSession,
      onOpenSession,
      onDeleteSession,
      onCancelDeleteSession,
      onConfirmDeleteSession,
      deleteSessionDialogOpen,
      deleteSessionTargetId,
      deletingSession,
      formatSnapshotValue,
      disclaimerCollapsed,
      onSetDisclaimerCollapsed,
      canSendAiChat,
      onToggleSessionList,
      chatMessages,
      isSending,
      messagesContainerRef,
      messagesEndRef,
      onMessagesScroll,
      showScrollToBottom,
      onJumpToLatest,
      expandedExplanations,
      expandedReferences,
      expandedDataQuality,
      onToggleExplanation,
      onToggleReferences,
      onToggleDataQuality,
      getDisplayFreshnessHints,
      formatAiDegradedReason,
      formatCitationPageText,
      compactSnippet,
      avatarSrc,
      chatInputRef,
      chatInput,
      onChatInputChange,
      onSendMessage,
    };

    const messagesTabProps: React.ComponentProps<typeof PatientMessagesTab> = {
      patientId,
      userRole,
      messages,
      messagesLoading,
      messageInput,
      onMessageInputChange,
      onSendGeneralMessage,
      onSendMedicationAdvice,
      onMarkAllRead,
      onMarkMessageRead,
      formatTimestamp,
      presetTags,
      onUpdateTags,
      onRespondToAdvice,
    };

    return {
      unreadMessagesCount,
      chatTabProps,
      messagesTabProps,
      labsTabProps,
      medicationsTabProps,
    };
  }, [
    avatarSrc,
    canSendAiChat,
    chatInput,
    chatInputRef,
    chatMessages,
    chatSessions,
    compactSnippet,
    disclaimerCollapsed,
    expandedDataQuality,
    expandedExplanations,
    expandedReferences,
    formatAiDegradedReason,
    formatCitationPageText,
    formatSnapshotValue,
    formatTimestamp,
    getDisplayFreshnessHints,
    isSending,
    labsTabProps,
    messageInput,
    messages,
    messagesContainerRef,
    messagesEndRef,
    messagesLoading,
    medicationsTabProps,
    onChatInputChange,
    onDeleteSession,
    onCancelDeleteSession,
    onConfirmDeleteSession,
    onJumpToLatest,
    onMarkAllRead,
    onMarkMessageRead,
    onMessageInputChange,
    onMessagesScroll,
    onRespondToAdvice,
    onOpenSession,
    onSendGeneralMessage,
    onSendMedicationAdvice,
    onSendMessage,
    onUpdateTags,
    onSetDisclaimerCollapsed,
    onStartNewSession,
    onToggleDataQuality,
    onToggleExplanation,
    onToggleReferences,
    onToggleSessionList,
    patientId,
    presetTags,
    selectedSessionId,
    deleteSessionDialogOpen,
    deleteSessionTargetId,
    deletingSession,
    showScrollToBottom,
    showSessionList,
    userRole,
  ]);
}
