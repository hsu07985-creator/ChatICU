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
