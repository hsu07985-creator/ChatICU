import apiClient, { ensureData } from '../api-client';

// 類型定義
export interface PatientMessage {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  authorRole: 'doctor' | 'nurse' | 'pharmacist' | 'admin';
  messageType: 'general' | 'medication-advice' | 'alert' | 'urgent' | 'note' | 'progress-note' | 'nursing-record';
  content: string;
  timestamp: string;
  isRead: boolean;
  readBy: {
    userId: string;
    userName: string;
    readAt: string;
  }[];
  linkedMedication?: string;
  adviceCode?: string;
  replyToId?: string;
  replyCount?: number;
  replies?: PatientMessage[];
  tags?: string[];
  mentionedRoles?: string[];
  adviceRecordId?: string;
  adviceAccepted?: boolean | null;
  adviceRespondedBy?: string;
}

export interface MessagesResponse {
  messages: PatientMessage[];
  total: number;
  unreadCount: number;
}

export interface SendMessageData {
  content: string;
  messageType?: 'general' | 'medication-advice' | 'alert' | 'urgent' | 'note' | 'progress-note' | 'nursing-record';
  linkedMedication?: string;
  adviceCode?: string;
  replyToId?: string;
  tags?: string[];
  mentionedRoles?: string[];
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 取得病人留言列表
export async function getMessages(
  patientId: string,
  options: { type?: string; unreadOnly?: boolean } = {}
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options.type) params.append('type', options.type);
  if (options.unreadOnly) params.append('unread', 'true');

  const response = await apiClient.get<ApiResponse<{ messages: PatientMessage[]; total: number }>>(
    `/patients/${patientId}/messages?${params}`
  );
  const payload = ensureData(response.data, 'API contract');
  const unreadCount = (payload.messages || []).filter((m) => !m.isRead).length;
  return { ...payload, unreadCount };
}

// 發送留言
export async function sendMessage(
  patientId: string,
  data: SendMessageData
): Promise<PatientMessage> {
  const response = await apiClient.post<ApiResponse<PatientMessage>>(
    `/patients/${patientId}/messages`,
    data
  );
  return ensureData(response.data, 'API contract');
}

// 標記留言已讀
export async function markMessageRead(
  patientId: string,
  messageId: string
): Promise<PatientMessage> {
  const response = await apiClient.patch<ApiResponse<PatientMessage>>(
    `/patients/${patientId}/messages/${messageId}/read`
  );
  return ensureData(response.data, 'API contract');
}

// 取得預設標籤
export async function getPresetTags(
  patientId: string
): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    `/patients/${patientId}/messages/preset-tags`
  );
  return ensureData(response.data, 'API contract');
}

// 更新留言標籤
export async function updateMessageTags(
  patientId: string,
  messageId: string,
  data: { add?: string[]; remove?: string[] }
): Promise<PatientMessage> {
  const response = await apiClient.patch<ApiResponse<PatientMessage>>(
    `/patients/${patientId}/messages/${messageId}/tags`,
    data
  );
  return ensureData(response.data, 'API contract');
}
