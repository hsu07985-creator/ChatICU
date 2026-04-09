import apiClient, { ensureData } from '../api-client';

// 類型定義
export interface PatientMessage {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  authorRole: 'doctor' | 'np' | 'nurse' | 'pharmacist' | 'admin';
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

// 取得藥事標籤（分類結構）
export interface PharmacyTagCategory {
  category: string;
  tags: string[];
}

export async function getPharmacyTags(
  patientId: string
): Promise<PharmacyTagCategory[]> {
  const response = await apiClient.get<ApiResponse<PharmacyTagCategory[]>>(
    `/patients/${patientId}/messages/pharmacy-tags`
  );
  return ensureData(response.data, 'API contract');
}

// @我的留言 — 跨病患查詢被 @到的留言
export interface MentionMessage {
  id: string;
  content: string;
  authorName: string;
  authorRole: string;
  timestamp: string;
  isRead: boolean;
  mentionedRoles: string[];
  tags: string[];
}

export interface MentionGroup {
  patientId: string;
  patientName: string;
  bedNumber: string;
  unreadCount: number;
  totalCount: number;
  messages: MentionMessage[];
}

export interface MyMentionsResponse {
  groups: MentionGroup[];
  totalMentions: number;
}

export async function getMyMentions(
  options: { hoursBack?: number; unreadOnly?: boolean } = {}
): Promise<MyMentionsResponse> {
  const params = new URLSearchParams();
  if (options.hoursBack) params.append('hours_back', String(options.hoursBack));
  if (options.unreadOnly) params.append('unread_only', 'true');

  const response = await apiClient.get<ApiResponse<MyMentionsResponse>>(
    `/patients/messages/my-mentions?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 自訂共用標籤
export interface CustomTag {
  id: string;
  name: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export async function getCustomTags(
  patientId: string
): Promise<CustomTag[]> {
  const response = await apiClient.get<ApiResponse<CustomTag[]>>(
    `/patients/${patientId}/messages/custom-tags`
  );
  return ensureData(response.data, 'API contract');
}

export async function createCustomTag(
  patientId: string,
  name: string
): Promise<CustomTag> {
  const response = await apiClient.post<ApiResponse<CustomTag>>(
    `/patients/${patientId}/messages/custom-tags`,
    { name }
  );
  return ensureData(response.data, 'API contract');
}

export async function deleteCustomTag(
  patientId: string,
  tagId: string
): Promise<void> {
  await apiClient.delete(
    `/patients/${patientId}/messages/custom-tags/${tagId}`
  );
}

// 刪除留言（admin only）
export async function deletePatientMessage(
  patientId: string,
  messageId: string
): Promise<void> {
  await apiClient.delete(`/patients/${patientId}/messages/${messageId}`);
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
