import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as authApi from './api/auth';
import { tokenManager } from './api-client';

export type UserRole = 'nurse' | 'doctor' | 'admin' | 'pharmacist';

export interface User {
  id: string;
  name: string;
  username?: string;
  email?: string;
  role: UserRole;
  unit: string;
  lastLogin?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 檢查並恢復登入狀態
  const checkAuth = useCallback(async () => {
    const token = tokenManager.getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const currentUser = await authApi.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      // Token 無效或過期，嘗試刷新
      console.warn('Token 驗證失敗，嘗試刷新...');
      try {
        await authApi.refreshToken();
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
      } catch (refreshError) {
        // 刷新失敗，清除所有 token
        console.error('Token 刷新失敗，需要重新登入');
        tokenManager.clearAll();
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
  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      setLoading(true);
      const loggedInUser = await authApi.login(username, password);
      setUser(loggedInUser);
      return true;
    } catch (error) {
      console.error('登入失敗:', error);
      return false;
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