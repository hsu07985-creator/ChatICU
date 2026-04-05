import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { LabTrendData } from '../components/lab-trend-chart';
import { messagesApi, vitalSignsApi, ventilatorApi, type PatientMessage } from '../lib/api';
import type { PharmacyTagCategory } from '../lib/api/messages';
import { respondToAdvice } from '../lib/api/pharmacy';
import type { UserRole } from '../lib/auth-context';
import type { SessionChatMessage, SessionListItem } from '../hooks/use-chat-sessions';
import {
  formatMessageTimestamp,
  formatTrendAxisLabel,
  getLabChineseName,
  getVentilatorTrendValue,
  getVitalTrendValue,
  isFiniteNumber,
} from './patient-detail-utils';

type TrendSource = 'vital' | 'ventilator';

interface SelectedTrendMetric {
  name: string;
  nameChinese: string;
  unit: string;
  value: number;
  source: TrendSource;
}

interface UsePatientDetailControllerParams {
  patientId?: string;
  userRole?: UserRole;
  messages: PatientMessage[];
  prependMessage: (message: PatientMessage) => void;
  refreshMessagesOnly: () => Promise<void>;
  openSession: (session: SessionListItem) => Promise<SessionChatMessage[] | null>;
  removeSession: (sessionId: string) => Promise<boolean>;
  clearSessionSelection: () => void;
  clearChatMessages: () => void;
  setChatMessages: Dispatch<SetStateAction<SessionChatMessage[]>>;
}

export function usePatientDetailController({
  patientId,
  userRole,
  messages,
  prependMessage,
  refreshMessagesOnly,
  openSession,
  removeSession,
  clearSessionSelection,
  clearChatMessages,
  setChatMessages,
}: UsePatientDetailControllerParams) {
  const [messageInput, setMessageInput] = useState('');
  const [selectedTrendMetric, setSelectedTrendMetric] = useState<SelectedTrendMetric | null>(null);
  const [trendChartData, setTrendChartData] = useState<LabTrendData[]>([]);
  const [deleteSessionDialogOpen, setDeleteSessionDialogOpen] = useState(false);
  const [deleteSessionTargetId, setDeleteSessionTargetId] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [presetTags, setPresetTags] = useState<string[]>([]);
  const [pharmacyTagCategories, setPharmacyTagCategories] = useState<PharmacyTagCategory[]>([]);

  useEffect(() => {
    if (!patientId) return;
    messagesApi.getPresetTags(patientId)
      .then(setPresetTags)
      .catch(() => setPresetTags([]));
    messagesApi.getPharmacyTags(patientId)
      .then(setPharmacyTagCategories)
      .catch(() => setPharmacyTagCategories([]));
  }, [patientId]);

  const handleSendBoardMessage = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => {
    if (!messageInput.trim() || !patientId) return;

    try {
      const newMessage = await messagesApi.sendMessage(patientId, {
        content: messageInput.trim(),
        messageType: 'general',
        replyToId,
        tags,
        mentionedRoles,
      });
      if (replyToId) {
        await refreshMessagesOnly();
      } else {
        prependMessage(newMessage);
      }
      setMessageInput('');
      toast.success('留言發送成功');
    } catch (err) {
      console.error('發送留言失敗:', err);
      toast.error('發送留言失敗');
    }
  }, [messageInput, patientId, prependMessage, refreshMessagesOnly]);

  const handleSendMedicationAdvice = useCallback(async (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => {
    if (!messageInput.trim() || !patientId) return;
    if (userRole !== 'pharmacist') {
      toast.error('只有藥師可以發送用藥建議');
      return;
    }
    try {
      const newMessage = await messagesApi.sendMessage(patientId, {
        content: messageInput.trim(),
        messageType: 'medication-advice',
        replyToId,
        tags,
        mentionedRoles,
      });
      if (replyToId) {
        await refreshMessagesOnly();
      } else {
        prependMessage(newMessage);
      }
      setMessageInput('');
      toast.success('用藥建議發送成功');
    } catch (err) {
      console.error('發送用藥建議失敗:', err);
      toast.error('發送用藥建議失敗');
    }
  }, [messageInput, patientId, prependMessage, refreshMessagesOnly, userRole]);

  const handleMarkAllMessagesRead = useCallback(async () => {
    if (!patientId) return;
    const unread = messages.filter((message) => !message.isRead);
    if (unread.length === 0) return;

    try {
      await Promise.all(unread.map((message) => messagesApi.markMessageRead(patientId, message.id).catch(() => null)));
      toast.success(`已標記 ${unread.length} 則留言為已讀`);
      await refreshMessagesOnly();
    } catch (err) {
      console.error('全部標為已讀失敗:', err);
      toast.error('全部標為已讀失敗');
    }
  }, [messages, patientId, refreshMessagesOnly]);

  const handleMarkMessageRead = useCallback(async (messageId: string) => {
    if (!patientId) return;

    try {
      await messagesApi.markMessageRead(patientId, messageId);
      toast.success('已標記為已讀');
      await refreshMessagesOnly();
    } catch (err) {
      console.error('標記已讀失敗:', err);
      toast.error('標記已讀失敗');
    }
  }, [patientId, refreshMessagesOnly]);

  const handleUpdateMessageTags = useCallback(async (
    messageId: string,
    data: { add?: string[]; remove?: string[] }
  ) => {
    if (!patientId) return;
    try {
      await messagesApi.updateMessageTags(patientId, messageId, data);
      await refreshMessagesOnly();
      toast.success('標籤已更新');
    } catch (err) {
      console.error('更新標籤失敗:', err);
      toast.error('更新標籤失敗');
    }
  }, [patientId, refreshMessagesOnly]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    setDeleteSessionTargetId(sessionId);
    setDeleteSessionDialogOpen(true);
  }, []);

  const handleCancelDeleteSession = useCallback(() => {
    if (deletingSession) return;
    setDeleteSessionDialogOpen(false);
    setDeleteSessionTargetId(null);
  }, [deletingSession]);

  const handleConfirmDeleteSession = useCallback(async () => {
    if (!deleteSessionTargetId) return;
    setDeletingSession(true);
    try {
      const wasSelected = await removeSession(deleteSessionTargetId);
      if (wasSelected) {
        clearChatMessages();
      }
      toast.success('對話記錄已刪除');
      setDeleteSessionDialogOpen(false);
      setDeleteSessionTargetId(null);
    } catch {
      toast.error('刪除對話記錄失敗');
    } finally {
      setDeletingSession(false);
    }
  }, [clearChatMessages, deleteSessionTargetId, removeSession]);

  const handleStartNewSession = useCallback(() => {
    clearSessionSelection();
    clearChatMessages();
  }, [clearChatMessages, clearSessionSelection]);

  const handleOpenSession = useCallback(async (session: SessionListItem) => {
    const detail = await openSession(session);
    if (!detail) {
      toast.error('載入對話內容失敗');
      clearChatMessages();
      return;
    }
    setChatMessages(detail);
  }, [clearChatMessages, openSession, setChatMessages]);

  const handleRespondToAdvice = useCallback(async (adviceRecordId: string, accepted: boolean) => {
    try {
      await respondToAdvice(adviceRecordId, { accepted });
      toast.success(accepted ? '已接受藥事建議' : '已拒絕藥事建議');
      await refreshMessagesOnly();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('此建議已有回覆，無法重複操作');
      } else {
        toast.error('回覆藥事建議失敗');
      }
    }
  }, [refreshMessagesOnly]);

  const handleVitalSignClick = useCallback((labName: string, value: number, unit: string, source: TrendSource = 'vital') => {
    setSelectedTrendMetric({
      name: labName,
      nameChinese: getLabChineseName(labName),
      unit,
      value,
      source,
    });
  }, []);

  useEffect(() => {
    if (!selectedTrendMetric || !patientId) {
      setTrendChartData([]);
      return;
    }

    const fetchTrend = async () => {
      try {
        const points: LabTrendData[] = [];

        if (selectedTrendMetric.source === 'vital') {
          const response = await vitalSignsApi.getVitalSignsTrends(patientId, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVitalTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({
                date: formatTrendAxisLabel(record.timestamp),
                value: trendValue,
              });
            }
          }
        } else if (selectedTrendMetric.source === 'ventilator') {
          const response = await ventilatorApi.getVentilatorTrends(patientId, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVentilatorTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({
                date: formatTrendAxisLabel(record.timestamp),
                value: trendValue,
              });
            }
          }
        }

        if (points.length === 0) {
          points.push({
            date: '目前',
            value: selectedTrendMetric.value,
          });
        }

        setTrendChartData(points);
      } catch {
        setTrendChartData([
          {
            date: '目前',
            value: selectedTrendMetric.value,
          },
        ]);
      }
    };

    void fetchTrend();
  }, [patientId, selectedTrendMetric]);

  return {
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
    formatTimestamp: formatMessageTimestamp,
  };
}
