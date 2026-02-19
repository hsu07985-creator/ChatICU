import apiClient, { ensureData, tokenManager } from '../api-client';
import type { User } from '../auth-context';

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
  expiresIn: number;
  passwordExpired?: boolean;
}

interface RefreshResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

// 登入 — backend 透過 Set-Cookie 設定 httpOnly JWT cookies
export async function login(username: string, password: string): Promise<User> {
  const response = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', {
    username,
    password,
  });

  const { user } = ensureData(response.data, 'API contract');
  // Tokens are now in httpOnly cookies — clear any legacy localStorage
  tokenManager.clearAll();
  return user;
}

// 登出 — backend 讀取 cookie 中的 tokens 進行 blacklist
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout');
  } finally {
    tokenManager.clearAll();
  }
}

// 取得當前用戶資訊
export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>('/auth/me');
  return ensureData(response.data, 'API contract');
}

// 刷新 Token — backend 讀取 cookie 中的 refresh token
export async function refreshToken(): Promise<RefreshResponse> {
  const response = await apiClient.post<ApiResponse<RefreshResponse>>('/auth/refresh', {});
  return ensureData(response.data, 'API contract');
}

// 檢查是否已登入（透過 non-httpOnly indicator cookie）
export function isAuthenticated(): boolean {
  return tokenManager.isLoggedIn();
}

