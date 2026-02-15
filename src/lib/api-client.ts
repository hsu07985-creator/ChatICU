import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { toast } from 'sonner';

// API 配置 - Dart Frog 預設 port 8080
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Token 儲存 key
const TOKEN_KEY = 'chaticu_token';
const REFRESH_TOKEN_KEY = 'chaticu_refresh_token';

// Token 管理
export const tokenManager = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  removeToken: (): void => localStorage.removeItem(TOKEN_KEY),
  
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string): void => localStorage.setItem(REFRESH_TOKEN_KEY, token),
  removeRefreshToken: (): void => localStorage.removeItem(REFRESH_TOKEN_KEY),
  
  clearAll: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// 建立 Axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request 攔截器 - 自動附加 Token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = tokenManager.getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response 攔截器 - 錯誤處理與 Token 刷新
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: AxiosError) => void;
}> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    
    // 處理 401 錯誤 - 嘗試刷新 Token
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = tokenManager.getRefreshToken();
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refreshToken,
          });
          const { token: newToken, refreshToken: newRefreshToken } = response.data.data;
          tokenManager.setToken(newToken);
          tokenManager.setRefreshToken(newRefreshToken);
          processQueue(null, newToken);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return apiClient(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError as AxiosError, null);
          tokenManager.clearAll();
          window.location.href = '/login';
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        tokenManager.clearAll();
        window.location.href = '/login';
      }
    }

    // 處理其他錯誤
    handleApiError(error);
    return Promise.reject(error);
  }
);

// 錯誤處理函數 - 配合 Dart Frog ResponseUtils 格式
// 後端錯誤格式: { error: 'ErrorCode', message: '錯誤訊息' }
function handleApiError(error: AxiosError<{ error?: string; message?: string; success?: boolean }>) {
  const status = error.response?.status;
  const errorCode = error.response?.data?.error;
  const message = error.response?.data?.message || error.message;

  // 記錄錯誤以便調試
  console.error(`[API Error] ${status} - ${errorCode}: ${message}`);

  switch (status) {
    case 400:
      toast.error(`請求錯誤: ${message}`);
      break;
    case 403:
      toast.error(`權限不足: ${message}`);
      break;
    case 404:
      toast.error(`資源不存在: ${message}`);
      break;
    case 500:
      toast.error('伺服器錯誤，請稍後再試');
      break;
    default:
      if (!error.response) {
        toast.error('網路連線失敗，請檢查網路狀態');
      }
  }
}

// 匯出 API 基礎 URL 供其他模組使用
export const getApiBaseUrl = () => API_BASE_URL;

export default apiClient;

