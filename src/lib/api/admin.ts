import apiClient, { ensureData } from '../api-client';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// ========== 稽核日誌 ==========

export type AuditLogStatus = 'success' | 'failed' | 'error' | 'degraded';

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  user: string;
  role: string;
  action: string;
  target: string;
  status: AuditLogStatus;
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
    activeUsers: number;
  };
}

export interface AuditLogsParams {
  page?: number;
  limit?: number;
  action?: string;
  user?: string;
  userId?: string;
  role?: string;
  status?: AuditLogStatus;
  startDate?: string;
  endDate?: string;
}

export async function getAuditLogs(params?: AuditLogsParams): Promise<AuditLogsResponse> {
  const response = await apiClient.get<ApiResponse<AuditLogsResponse>>('/admin/audit-logs', {
    params,
  });
  return ensureData(response.data, 'API contract');
}

// ========== 用戶管理 ==========

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'doctor' | 'np' | 'nurse' | 'pharmacist';
  unit: string;
  email: string;
  active: boolean;
  lastLogin: string | null;
  createdAt: string | null;
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
  return ensureData(response.data, 'API contract');
}

export async function getUserById(userId: string): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>(`/admin/users/${userId}`);
  return ensureData(response.data, 'API contract');
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
  return ensureData(response.data, 'API contract');
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
  return ensureData(response.data, 'API contract');
}

export interface DeleteUserResult {
  id: string;
  hardDeleted: boolean;
  message?: string;
}

export async function deleteUser(userId: string): Promise<DeleteUserResult> {
  const response = await apiClient.delete<ApiResponse<{ id: string; hardDeleted: boolean }>>(
    `/admin/users/${userId}`
  );
  const data = ensureData(response.data, 'API contract');
  return { ...data, message: response.data?.message };
}

// ========== 用藥標準化字典 ==========

export interface MedicationNormalizationConfig {
  version: string;
  routeAliases: Record<string, string>;
  frequencyAliases: Record<string, string>;
  routeAliasCount?: number;
  frequencyAliasCount?: number;
  filePath?: string;
  modifiedAt?: string;
}

export async function getMedicationNormalizationConfig(): Promise<MedicationNormalizationConfig> {
  const response = await apiClient.get<ApiResponse<MedicationNormalizationConfig>>(
    '/admin/medication-normalization'
  );
  return ensureData(response.data, 'API contract');
}

export async function updateMedicationNormalizationConfig(
  data: MedicationNormalizationConfig
): Promise<MedicationNormalizationConfig> {
  const response = await apiClient.put<ApiResponse<MedicationNormalizationConfig>>(
    '/admin/medication-normalization',
    data
  );
  return ensureData(response.data, 'API contract');
}

// 導出所有 API 函數
export const adminApi = {
  getAuditLogs,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getMedicationNormalizationConfig,
  updateMedicationNormalizationConfig,
};
