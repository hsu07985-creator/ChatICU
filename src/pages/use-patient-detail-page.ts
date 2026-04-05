import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getReadinessReason } from '../lib/api/ai';
import { recordScore, deleteScore, getScoreTrends, type LatestScores, type ScoreTrendsResponse } from '../lib/api/scores';
import { useAuth } from '../lib/auth-context';
import { useAiChatConversation } from '../hooks/use-ai-chat-conversation';
import { useChatSessions } from '../hooks/use-chat-sessions';
import { useChatUiState } from '../hooks/use-chat-ui-state';
import { usePatientBundle } from '../hooks/use-patient-bundle';
import chatBotAvatar from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';
import {
  compactSnippet,
  formatAiDegradedReason,
  formatCitationPageText,
  formatDisplayTimestamp,
  formatDisplayValue,
  formatMedicationRegimen,
  formatSnapshotValue,
  getDisplayFreshnessHints,
} from './patient-detail-utils';
import { usePatientAiStatus } from './use-patient-ai-status';
import { usePatientDetailController } from './use-patient-detail-controller';
import { usePatientDetailTabsProps } from './use-patient-detail-tabs-props';
import { usePatientDetailViewModel } from './use-patient-detail-view-model';

export function usePatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const VALID_TABS = new Set(['chat', 'messages', 'records', 'labs', 'meds', 'summary']);
  const rawTab = searchParams.get('tab');
  const [activeTab, setActiveTabInternal] = useState(
    rawTab && VALID_TABS.has(rawTab) ? rawTab : 'chat'
  );
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabInternal(tab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'chat') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const {
    ragStatus,
    aiReadiness,
  } = usePatientAiStatus();

  const {
    patient,
    patientLoading,
    patientError,
    labData,
    medicationGroups,
    medicationsLoading,
    messages,
    messagesLoading,
    vitalSigns,
    vitalSignsLoading,
    ventilator,
    ventilatorLoading,
    latestScores,
    loadPatientBundle,
    refreshScores,
    refreshMessagesOnly,
    prependMessage,
  } = usePatientBundle(id);

  useEffect(() => {
    if (!id) return undefined;

    const intervalId = window.setInterval(() => {
      void loadPatientBundle('auto');
    }, 5 * 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [id, loadPatientBundle]);

  const {
    chatSessions,
    selectedSession,
    sessionTitle,
    refreshChatSessions,
    clearSessionSelection,
    openSession,
    removeSession,
    selectNewSession,
  } = useChatSessions(id);

  const canSendAiChat = aiReadiness ? aiReadiness.feature_gates.chat : true;
  const aiChatGateReason = getReadinessReason(aiReadiness, 'chat');

  const {
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
  } = useAiChatConversation({
    patientId: id,
    fallbackPatientId: patient?.id,
    selectedSessionId: selectedSession?.id,
    sessionTitle,
    canSendAiChat,
    aiChatGateReason,
    onRefreshSessions: refreshChatSessions,
    onSelectNewSession: selectNewSession,
    onInputCleared: () => {
      requestAnimationFrame(() => {
        if (chatInputRef.current) {
          chatInputRef.current.value = '';
          chatInputRef.current.focus();
        }
      });
    },
  });

  const {
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
  } = useChatUiState(chatMessages);

  const {
    messageInput,
    setMessageInput,
    selectedTrendMetric,
    setSelectedTrendMetric,
    trendChartData,
    handleSendBoardMessage,
    handleSendMedicationAdvice,
    handleMarkAllMessagesRead,
    handleMarkMessageRead,
    handleDeleteSession,
    handleCancelDeleteSession,
    handleConfirmDeleteSession,
    deleteSessionDialogOpen,
    deleteSessionTargetId,
    deletingSession,
    handleStartNewSession,
    handleOpenSession,
    handleVitalSignClick,
    presetTags,
    pharmacyTagCategories,
    handleUpdateMessageTags,
    handleRespondToAdvice,
    formatTimestamp,
  } = usePatientDetailController({
    patientId: id,
    userRole: user?.role,
    messages,
    prependMessage,
    refreshMessagesOnly,
    openSession,
    removeSession,
    clearSessionSelection,
    clearChatMessages,
    setChatMessages,
  });

  const {
    daysAdmitted,
    painMedications,
    sedationMedications,
    nmbMedications,
    otherMedications,
    painScoreValue,
    rassScoreValue,
    painIndication,
    sedationIndication,
    nmbIndication,
    respiratoryRate,
    temperature,
    systolicBP,
    diastolicBP,
    heartRate,
    spo2,
    cvp,
    icp,
    ventTimestamp,
    ventMode,
    ventFiO2,
    ventPeep,
    ventTidalVolume,
    ventRespRate,
    ventPip,
    ventPlateau,
    ventCompliance,
  } = usePatientDetailViewModel({
    patient,
    medicationGroups,
    messages,
    vitalSigns,
    ventilator,
    latestScores,
  });

  // Score trend dialog state
  const [scoreTrendOpen, setScoreTrendOpen] = useState(false);
  const [scoreTrendType, setScoreTrendType] = useState<'pain' | 'rass'>('pain');
  const [scoreTrendData, setScoreTrendData] = useState<{ date: string; value: number }[]>([]);
  const [scoreEntries, setScoreEntries] = useState<import('@/lib/api/scores').ScoreEntry[]>([]);

  const handleRecordScore = useCallback(async (scoreType: 'pain' | 'rass', value: number) => {
    if (!id) return;
    try {
      const entry = await recordScore(id, { score_type: scoreType, value });
      const label = scoreType === 'pain' ? 'Pain' : 'RASS';
      toast.success(`${label} Score 已記錄: ${value}`, {
        duration: 5000,
        action: {
          label: '撤銷',
          onClick: async () => {
            try {
              await deleteScore(id, entry.id);
              toast.success(`已撤銷 ${label} Score: ${value}`);
              await refreshScores();
            } catch {
              toast.error('撤銷失敗');
            }
          },
        },
      });
      await refreshScores();
    } catch {
      toast.error('記錄失敗，請稍後再試');
    }
  }, [id, refreshScores]);

  const loadScoreTrends = useCallback(async (scoreType: 'pain' | 'rass') => {
    if (!id) return;
    try {
      const result: ScoreTrendsResponse = await getScoreTrends(id, scoreType, 72);
      setScoreEntries(result.trends);
      setScoreTrendData(
        result.trends.map((t) => ({
          date: new Date(t.timestamp).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
          value: t.value,
        })),
      );
    } catch {
      toast.error('載入趨勢資料失敗');
      setScoreEntries([]);
      setScoreTrendData([]);
    }
  }, [id]);

  const handleOpenScoreTrend = useCallback(async (scoreType: 'pain' | 'rass') => {
    if (!id) return;
    setScoreTrendType(scoreType);
    setScoreTrendOpen(true);
    await loadScoreTrends(scoreType);
  }, [id, loadScoreTrends]);

  const handleDeleteScoreEntry = useCallback(async (scoreId: string) => {
    if (!id) return;
    await deleteScore(id, scoreId);
    toast.success('已刪除紀錄');
    await loadScoreTrends(scoreTrendType);
  }, [id, scoreTrendType, loadScoreTrends]);

  const { unreadMessagesCount, chatTabProps, messagesTabProps, labsTabProps, medicationsTabProps } = usePatientDetailTabsProps({
    patientId: id,
    userRole: user?.role,
    messages,
    messagesLoading,
    messageInput,
    onMessageInputChange: setMessageInput,
    onSendGeneralMessage: handleSendBoardMessage,
    onSendMedicationAdvice: handleSendMedicationAdvice,
    onMarkAllRead: handleMarkAllMessagesRead,
    onMarkMessageRead: handleMarkMessageRead,
    formatTimestamp,
    presetTags,
    pharmacyTagCategories,
    onUpdateTags: handleUpdateMessageTags,
    onRespondToAdvice: handleRespondToAdvice,
    showSessionList,
    chatSessions,
    selectedSessionId: selectedSession?.id,
    onStartNewSession: handleStartNewSession,
    onOpenSession: handleOpenSession,
    onDeleteSession: handleDeleteSession,
    onCancelDeleteSession: handleCancelDeleteSession,
    onConfirmDeleteSession: handleConfirmDeleteSession,
    deleteSessionDialogOpen,
    deleteSessionTargetId,
    deletingSession,
    formatSnapshotValue,
    disclaimerCollapsed,
    onSetDisclaimerCollapsed: setDisclaimerCollapsed,
    canSendAiChat,
    onToggleSessionList: () => setShowSessionList(!showSessionList),
    chatMessages,
    isSending,
    thinkingStatus,
    messagesContainerRef,
    messagesEndRef,
    onMessagesScroll: handleMessagesScroll,
    showScrollToBottom,
    onJumpToLatest: jumpToLatest,
    expandedExplanations,
    expandedReferences,
    expandedDataQuality,
    onToggleExplanation: toggleExplanation,
    onToggleReferences: toggleReferences,
    onToggleDataQuality: toggleDataQuality,
    getDisplayFreshnessHints,
    formatAiDegradedReason,
    formatCitationPageText,
    compactSnippet,
    avatarSrc: chatBotAvatar,
    chatInputRef,
    chatInput,
    onChatInputChange: setChatInput,
    onSendMessage: sendMessage,
    onSetMessageFeedback: setMessageFeedback,
    onRegenerateMessage: regenerateMessage,
    labsTabProps: {
      patientId: patient?.id || '',
      patientIntubated: patient?.intubated || false,
      labData,
      vitalSignsLoading,
      vitalSignsTimestamp: vitalSigns?.timestamp,
      respiratoryRate,
      temperature,
      systolicBP,
      diastolicBP,
      heartRate,
      spo2,
      cvp,
      icp,
      ventilatorLoading,
      ventTimestamp,
      ventMode,
      ventFiO2,
      ventPeep,
      ventTidalVolume,
      ventRespRate,
      ventPip,
      ventPlateau,
      ventCompliance,
      formatDisplayTimestamp,
      formatDisplayValue,
      onVitalSignClick: handleVitalSignClick,
    },
    medicationsTabProps: {
      patientId: patient?.id,
      userRole: user?.role,
      medicationsLoading,
      painIndication,
      sedationIndication,
      nmbIndication,
      painMedications,
      sedationMedications,
      nmbMedications,
      otherMedications,
      formatDisplayValue,
      formatMedicationRegimen,
      painScoreValue,
      rassScoreValue,
      onRecordScore: handleRecordScore,
      onOpenScoreTrend: handleOpenScoreTrend,
      scoreTrendOpen,
      scoreTrendType,
      scoreTrendData,
      scoreEntries,
      onDeleteScoreEntry: handleDeleteScoreEntry,
      onCloseScoreTrend: () => setScoreTrendOpen(false),
      onRefreshMedications: async () => {
        await loadPatientBundle('auto');
      },
    },
  });

  const records = patient
    ? { patientId: patient.id, patientName: patient.name, aiReadiness }
    : null;

  const summary = patient
    ? { patient, userRole: user?.role, ragStatus, aiReadiness }
    : null;

  return {
    patient,
    patientLoading,
    patientError,
    activeTab,
    setActiveTab,
    daysAdmitted,
    unreadMessagesCount,
    chatTabProps,
    messagesTabProps,
    labsTabProps,
    medicationsTabProps,
    records,
    summary,
    selectedTrendMetric,
    setSelectedTrendMetric,
    trendChartData,
    onBackToPatients: () => navigate('/patients'),
    onRetry: () => window.location.reload(),
    showEditButton: user?.role === 'admin',
  };
}
