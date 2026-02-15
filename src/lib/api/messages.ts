import apiClient from '../api-client';

// 類型定義
export interface PatientMessage {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  authorRole: 'doctor' | 'nurse' | 'pharmacist' | 'admin';
  messageType: 'general' | 'medication-advice' | 'alert';
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
}

export interface MessagesResponse {
  patientId: string;
  patientName: string;
  messages: PatientMessage[];
  total: number;
  unreadCount: number;
}

export interface SendMessageData {
  content: string;
  messageType?: 'general' | 'medication-advice' | 'alert';
  linkedMedication?: string;
  adviceCode?: string;
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
  if (options.unreadOnly) params.append('unreadOnly', 'true');

  const response = await apiClient.get<ApiResponse<MessagesResponse>>(
    `/patients/${patientId}/messages?${params}`
  );
  return response.data.data!;
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
  return response.data.data!;
}

// 標記留言已讀
export async function markMessageRead(
  patientId: string,
  messageId: string
): Promise<PatientMessage> {
  const response = await apiClient.patch<ApiResponse<PatientMessage>>(
    `/patients/${patientId}/messages/${messageId}/read`
  );
  return response.data.data!;
}

