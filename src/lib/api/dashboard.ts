import apiClient from '../api-client';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface DashboardStats {
  patients: {
    total: number;
    intubated: number;
    intubatedBeds: string[];
    withSAN: number;
  };
  alerts: {
    total: number;
  };
  medications: {
    active: number;
    sedation: number;
    analgesia: number;
    nmb: number;
  };
  messages: {
    today: number;
    unread: number;
  };
  timestamp: string;
}

/**
 * 獲取儀表板統計數據
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await apiClient.get<ApiResponse<DashboardStats>>('/dashboard/stats');
  return response.data.data!;
}

// 導出所有 API 函數
export const dashboardApi = {
  getStats: getDashboardStats,
};

