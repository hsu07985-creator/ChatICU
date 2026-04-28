import apiClient, { ensureData } from '../api-client';

export type UserRole = 'doctor' | 'np' | 'nurse' | 'pharmacist' | 'admin';

export interface TeamChatReadReceipt {
  userId: string;
  userName: string;
  readAt: string;
}

export interface TeamChatMessage {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  content: string;
  timestamp: string;
  pinned?: boolean;
  pinnedBy?: { userId: string; userName: string } | null;
  pinnedAt?: string | null;
  replyToId?: string | null;
  isRead?: boolean;
  readBy?: TeamChatReadReceipt[];
  mentionedRoles?: string[];
  mentionedUserIds?: string[];
  replyCount?: number;
  replies?: TeamChatMessage[];
}

export interface TeamChatResponse {
  messages: TeamChatMessage[];
  total: number;
}

export interface TeamUser {
  id: string;
  name: string;
  role: UserRole;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function getTeamChatMessages(options: { limit?: number } = {}): Promise<TeamChatResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.append('limit', String(options.limit));

  const response = await apiClient.get<ApiResponse<TeamChatResponse>>(`/team/chat?${params}`);
  return ensureData(response.data, 'API contract');
}

export interface SendTeamChatOptions {
  pinned?: boolean;
  mentionedUserIds?: string[];
  mentionedRoles?: string[];
  replyToId?: string;
}

export async function sendTeamChatMessage(
  content: string,
  opts: SendTeamChatOptions = {},
): Promise<TeamChatMessage> {
  const body: Record<string, unknown> = { content, pinned: opts.pinned ?? false };
  if (opts.mentionedUserIds && opts.mentionedUserIds.length > 0) {
    body.mentionedUserIds = opts.mentionedUserIds;
  }
  if (opts.mentionedRoles && opts.mentionedRoles.length > 0) {
    body.mentionedRoles = opts.mentionedRoles;
  }
  if (opts.replyToId) {
    body.replyToId = opts.replyToId;
  }
  const response = await apiClient.post<ApiResponse<TeamChatMessage>>('/team/chat', body);
  return ensureData(response.data, 'API contract');
}

export async function postAnnouncement(content: string): Promise<TeamChatMessage> {
  return sendTeamChatMessage(content, { pinned: true });
}

export async function togglePinMessage(messageId: string): Promise<{ messageId: string; pinned: boolean }> {
  const response = await apiClient.patch<ApiResponse<{ messageId: string; pinned: boolean }>>(
    `/team/chat/${messageId}/pin`,
  );
  return ensureData(response.data, 'API contract');
}

export async function deleteTeamChatMessage(messageId: string): Promise<void> {
  await apiClient.delete(`/team/chat/${messageId}`);
}

// Module-level cache (5 min) — user list rarely changes within a session.
let _teamUsersCache: TeamUser[] | null = null;
let _teamUsersFetchedAt = 0;
const TEAM_USERS_TTL_MS = 5 * 60 * 1000;

export async function getTeamUsers(force = false): Promise<TeamUser[]> {
  if (!force && _teamUsersCache && Date.now() - _teamUsersFetchedAt < TEAM_USERS_TTL_MS) {
    return _teamUsersCache;
  }
  const response = await apiClient.get<ApiResponse<{ users: TeamUser[] }>>('/team/users');
  const payload = ensureData(response.data, 'API contract');
  _teamUsersCache = payload.users;
  _teamUsersFetchedAt = Date.now();
  return _teamUsersCache;
}

export const teamChatApi = {
  getMessages: getTeamChatMessages,
  sendMessage: sendTeamChatMessage,
  postAnnouncement,
  togglePin: togglePinMessage,
  getTeamUsers,
};
