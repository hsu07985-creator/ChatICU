import apiClient from '../api-client';

// 類型定義
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  patientContext?: {
    patientId: string;
    patientName: string;
  };
  citations?: Citation[];
  suggestedActions?: SuggestedAction[];
}

export interface Citation {
  id: string;
  type: 'guideline' | 'literature' | 'protocol' | 'patient-data';
  title: string;
  source: string;
  url?: string;
  relevance: number;
}

export interface SuggestedAction {
  id: string;
  type: 'order' | 'assessment' | 'consultation' | 'documentation';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ChatSession {
  id: string;
  userId: string;
  patientId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionsResponse {
  sessions: ChatSession[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ChatResponse {
  message: ChatMessage;
  sessionId: string;
}

export interface StreamChatOptions {
  sessionId?: string;
  patientId?: string;
  message: string;
  onMessage: (chunk: string) => void;
  onComplete: (response: ChatResponse) => void;
  onError: (error: Error) => void;
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 發送聊天訊息
export async function sendChatMessage(
  message: string,
  options: { sessionId?: string; patientId?: string } = {}
): Promise<ChatResponse> {
  const response = await apiClient.post<ApiResponse<ChatResponse>>('/ai/chat', {
    message,
    sessionId: options.sessionId,
    patientId: options.patientId,
  });
  return response.data.data!;
}

// 串流聊天訊息 — uses regular POST /ai/chat (backend does not support SSE streaming)
export async function streamChatMessage(options: StreamChatOptions): Promise<void> {
  try {
    const result = await sendChatMessage(options.message, {
      sessionId: options.sessionId,
      patientId: options.patientId,
    });
    options.onMessage(result.message.content);
    options.onComplete(result);
  } catch (err) {
    options.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// 取得聊天歷史
export async function getChatSessions(
  options: { page?: number; limit?: number; patientId?: string } = {}
): Promise<ChatSessionsResponse> {
  const params = new URLSearchParams();
  if (options.page) params.append('page', String(options.page));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.patientId) params.append('patientId', options.patientId);

  const response = await apiClient.get<ApiResponse<ChatSessionsResponse>>(`/ai/sessions?${params}`);
  return response.data.data!;
}

// 取得單一聊天會話
export async function getChatSession(sessionId: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const response = await apiClient.get<ApiResponse<{ session: ChatSession; messages: ChatMessage[] }>>(
    `/ai/sessions/${sessionId}`
  );
  return response.data.data!;
}

// 刪除聊天會話
export async function deleteChatSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/ai/sessions/${sessionId}`);
}

