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
    sanByCategory: {
      sedation: number;
      analgesia: number;
      nmb: number;
    };
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
  const response = await apiClient.get<ApiResponse<DashboardStats>>('/dashboard/stats', { suppressErrorToast: true });
  const raw = (response.data.data || {}) as Partial<DashboardStats>;
  return {
    patients: {
      total: raw.patients?.total ?? 0,
      intubated: raw.patients?.intubated ?? 0,
      intubatedBeds: raw.patients?.intubatedBeds ?? [],
      withSAN: raw.patients?.withSAN ?? 0,
      sanByCategory: {
        sedation: raw.patients?.sanByCategory?.sedation ?? 0,
        analgesia: raw.patients?.sanByCategory?.analgesia ?? 0,
        nmb: raw.patients?.sanByCategory?.nmb ?? 0,
      },
    },
    alerts: {
      total: raw.alerts?.total ?? 0,
    },
    medications: {
      active: raw.medications?.active ?? 0,
      sedation: raw.medications?.sedation ?? 0,
      analgesia: raw.medications?.analgesia ?? 0,
      nmb: raw.medications?.nmb ?? 0,
    },
    messages: {
      today: raw.messages?.today ?? 0,
      unread: raw.messages?.unread ?? 0,
    },
    timestamp: raw.timestamp ?? new Date().toISOString(),
  };
}

// 導出所有 API 函數
export const dashboardApi = {
  getStats: getDashboardStats,
};
