import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as authApi from './api/auth';

export type UserRole = 'nurse' | 'doctor' | 'np' | 'admin' | 'pharmacist';

export interface User {
  id: string;
  name: string;
  username?: string;
  email?: string;
  role: UserRole;
  unit: string;
  lastLogin?: string;
}

export interface LoginResult {
  success: boolean;
  passwordExpired?: boolean;
  status?: number;
  message?: string;
  code?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 檢查並恢復登入狀態（透過 httpOnly cookie）
  const checkAuth = useCallback(async () => {
    // Quick check via non-httpOnly indicator cookie
    if (!authApi.isAuthenticated()) {
      setLoading(false);
      return;
    }

    try {
      const currentUser = await authApi.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      // Cookie 驗證失敗，嘗試刷新（refresh cookie 自動送出）
      console.warn('Session 驗證失敗，嘗試刷新...');
      try {
        await authApi.refreshToken();
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
      } catch (refreshError) {
        console.error('Session 刷新失敗，需要重新登入');
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 應用程式啟動時檢查登入狀態
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 登入
  const login = async (username: string, password: string): Promise<LoginResult> => {
    try {
      setLoading(true);
      const { user: loggedInUser, passwordExpired } = await authApi.login(username, password);
      setUser(loggedInUser);
      console.info('[INTG][API][AUTH] login success');
      return { success: true, passwordExpired };
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const data = (error as { response?: { data?: { message?: string; detail?: string; error?: string } } })
        ?.response?.data;
      const message = data?.message || data?.detail || '登入失敗，請稍後再試';
      const code = data?.error;

      console.error(
        `[INTG][API][AUTH] login failed status=${status ?? 'N/A'} code=${code ?? 'N/A'} message=${message}`,
      );
      return {
        success: false,
        status,
        message,
        code,
      };
    } finally {
      setLoading(false);
    }
  };

  // 登出
  const logout = async (): Promise<void> => {
    try {
      setLoading(true);
      await authApi.logout();
    } catch (error) {
      console.error('登出 API 呼叫失敗:', error);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      isAuthenticated: !!user,
      checkAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
