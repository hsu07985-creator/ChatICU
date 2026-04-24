import apiClient from '../api-client';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface NotificationSummary {
  mentions: number;
  alerts: number;
  total: number;
  windowHours: number;
  generatedAt: string;
}

export async function getNotificationSummary(): Promise<NotificationSummary> {
  const response = await apiClient.get<ApiResponse<NotificationSummary>>(
    '/notifications/summary',
    { suppressErrorToast: true }
  );
  const raw = (response.data.data || {}) as Partial<NotificationSummary>;
  return {
    mentions: raw.mentions ?? 0,
    alerts: raw.alerts ?? 0,
    total: raw.total ?? 0,
    windowHours: raw.windowHours ?? 168,
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
  };
}

export type NotificationSource = 'patient_board' | 'team_chat';

export interface NotificationItem {
  id: string;
  source: NotificationSource;
  messageId: string;
  patientId: string | null;
  patientName: string | null;
  bedNumber: string | null;
  authorName: string;
  authorRole: string;
  preview: string;
  timestamp: string;
  isRead: boolean;
  deepLink: string;
}

export interface RecentNotificationsResponse {
  items: NotificationItem[];
  windowHours: number;
  generatedAt: string;
}

export async function getRecentNotifications(limit = 30): Promise<RecentNotificationsResponse> {
  const response = await apiClient.get<ApiResponse<RecentNotificationsResponse>>(
    `/notifications/recent?limit=${limit}`,
    { suppressErrorToast: true },
  );
  const raw = (response.data.data || {}) as Partial<RecentNotificationsResponse>;
  return {
    items: raw.items ?? [],
    windowHours: raw.windowHours ?? 168,
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
  };
}
