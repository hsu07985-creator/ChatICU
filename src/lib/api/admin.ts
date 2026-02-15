import apiClient from '../api-client';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// ========== 稽核日誌 ==========

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  user: string;
  role: string;
  action: string;
  target: string;
  status: 'success' | 'failed';
  ip: string;
  details?: Record<string, unknown>;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    success: number;
    failed: number;
  };
}

export interface AuditLogsParams {
  page?: number;
  limit?: number;
  action?: string;
  user?: string;
  status?: 'success' | 'failed';
  startDate?: string;
  endDate?: string;
}

export async function getAuditLogs(params?: AuditLogsParams): Promise<AuditLogsResponse> {
  const response = await apiClient.get<ApiResponse<AuditLogsResponse>>('/admin/audit-logs', {
    params,
  });
  return response.data.data!;
}

// ========== 用戶管理 ==========

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'doctor' | 'nurse' | 'pharmacist';
  unit: string;
  email: string;
  active: boolean;
  lastLogin: string;
  createdAt: string;
}

export interface UsersResponse {
  users: User[];
  stats: {
    total: number;
    active: number;
    byRole: {
      admin: number;
      doctor: number;
      nurse: number;
      pharmacist: number;
    };
  };
}

export interface UsersParams {
  role?: string;
  status?: string;
  search?: string;
}

export async function getUsers(params?: UsersParams): Promise<UsersResponse> {
  const response = await apiClient.get<ApiResponse<UsersResponse>>('/admin/users', { params });
  return response.data.data!;
}

export async function getUserById(userId: string): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>(`/admin/users/${userId}`);
  return response.data.data!;
}

export interface CreateUserData {
  username: string;
  name: string;
  password: string;
  role?: string;
  unit?: string;
  email?: string;
}

export async function createUser(data: CreateUserData): Promise<User> {
  const response = await apiClient.post<ApiResponse<User>>(
    '/admin/users',
    data
  );
  return response.data.data!;
}

export interface UpdateUserData {
  name?: string;
  role?: string;
  unit?: string;
  email?: string;
  active?: boolean;
}

export async function updateUser(
  userId: string,
  data: UpdateUserData
): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>(
    `/admin/users/${userId}`,
    data
  );
  return response.data.data!;
}

// ========== 向量資料庫 ==========

export interface VectorDatabase {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  lastUpdated: string;
  status: 'active' | 'updating' | 'error';
  size: string;
}

export interface VectorsResponse {
  databases: VectorDatabase[];
  stats: {
    totalDatabases: number;
    totalDocuments: number;
    totalSize: string;
    activeDatabases: number;
  };
}

export async function getVectorDatabases(): Promise<VectorsResponse> {
  const response = await apiClient.get<ApiResponse<VectorsResponse>>('/admin/vectors');
  return response.data.data!;
}

export async function rebuildVectorIndex(): Promise<{ message: string; database: VectorDatabase }> {
  const response = await apiClient.post<
    ApiResponse<{ message: string; database: VectorDatabase }>
  >('/admin/vectors/rebuild');
  return response.data.data!;
}

// 導出所有 API 函數
export const adminApi = {
  getAuditLogs,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  getVectorDatabases,
  rebuildVectorIndex,
};

