import apiClient, { ensureData } from '../api-client';

// 團隊聊天訊息類型
export interface TeamChatMessage {
  id: string;
  userId: string;
  userName: string;
  userRole: 'doctor' | 'np' | 'nurse' | 'pharmacist' | 'admin';
  content: string;
  timestamp: string;
  pinned?: boolean;
}

// API 回應類型
export interface TeamChatResponse {
  messages: TeamChatMessage[];
  total: number;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * 獲取團隊聊天訊息列表
 */
export async function getTeamChatMessages(options: { limit?: number } = {}): Promise<TeamChatResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.append('limit', String(options.limit));

  const response = await apiClient.get<ApiResponse<TeamChatResponse>>(`/team/chat?${params}`);
  return ensureData(response.data, 'API contract');
}

/**
 * 發送團隊聊天訊息
 */
export async function sendTeamChatMessage(content: string, pinned = false): Promise<TeamChatMessage> {
  const response = await apiClient.post<ApiResponse<TeamChatMessage>>('/team/chat', { content, pinned });
  return ensureData(response.data, 'API contract');
}

/**
 * 發布公告（釘選訊息）
 */
export async function postAnnouncement(content: string): Promise<TeamChatMessage> {
  return sendTeamChatMessage(content, true);
}

/**
 * 釘選/取消釘選訊息
 */
export async function togglePinMessage(messageId: string): Promise<{ messageId: string; pinned: boolean }> {
  const response = await apiClient.patch<ApiResponse<{ messageId: string; pinned: boolean }>>(
    `/team/chat/${messageId}/pin`
  );
  return ensureData(response.data, 'API contract');
}

/**
 * 刪除團隊聊天訊息（admin only）
 */
export async function deleteTeamChatMessage(messageId: string): Promise<void> {
  await apiClient.delete(`/team/chat/${messageId}`);
}

// 導出所有 API 函數
export const teamChatApi = {
  getMessages: getTeamChatMessages,
  sendMessage: sendTeamChatMessage,
  postAnnouncement,
  togglePin: togglePinMessage,
};

