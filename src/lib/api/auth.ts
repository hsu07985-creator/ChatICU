import apiClient, { tokenManager } from '../api-client';
import type { User, UserRole } from '../auth-context';

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

interface LoginResponse {
  user: User;
  token: string;
  refreshToken: string;
  expiresIn: string;
}

interface RefreshResponse {
  token: string;
  refreshToken: string;
  expiresIn: string;
}

// 登入
export async function login(username: string, password: string): Promise<User> {
  const response = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', {
    username,
    password,
  });

  const { user, token, refreshToken } = response.data.data!;
  tokenManager.setToken(token);
  tokenManager.setRefreshToken(refreshToken);
  
  return user;
}

// 登出 — send refreshToken so backend can blacklist both tokens
export async function logout(): Promise<void> {
  try {
    const currentRefreshToken = tokenManager.getRefreshToken();
    await apiClient.post('/auth/logout', {
      refreshToken: currentRefreshToken || undefined,
    });
  } finally {
    tokenManager.clearAll();
  }
}

// 取得當前用戶資訊
export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>('/auth/me');
  return response.data.data!;
}

// 刷新 Token
export async function refreshToken(): Promise<RefreshResponse> {
  const currentRefreshToken = tokenManager.getRefreshToken();
  if (!currentRefreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await apiClient.post<ApiResponse<RefreshResponse>>('/auth/refresh', {
    refreshToken: currentRefreshToken,
  });

  const data = response.data.data!;
  tokenManager.setToken(data.token);
  tokenManager.setRefreshToken(data.refreshToken);
  
  return data;
}

// 檢查是否已登入
export function isAuthenticated(): boolean {
  return !!tokenManager.getToken();
}

