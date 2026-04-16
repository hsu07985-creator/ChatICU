import type { AxiosProgressEvent } from 'axios';
import apiClient, { ensureData } from '../api-client';

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

// ========== 向量資料庫 ==========

export interface VectorDatabase {
  id: string;
  name: string;
  documentCount: number;
  chunkCount: number;
  status: 'active' | 'updating' | 'error';
  embeddingModel: string;
}

export interface VectorsResponse {
  databases: VectorDatabase[];
}

export interface UploadVectorDocumentResponse {
  documentId: string;
  fileName: string;
  collection: string;
  status: 'indexed' | 'processing';
  database: VectorDatabase;
  metadata?: Record<string, unknown>;
}

export interface UploadVectorDocumentParams {
  file: File;
  collection: string;
  metadata?: Record<string, unknown>;
  onUploadProgress?: (progress: number) => void;
}

export async function getVectorDatabases(): Promise<VectorsResponse> {
  const response = await apiClient.get<ApiResponse<VectorsResponse>>('/admin/vectors');
  return ensureData(response.data, 'API contract');
}

export async function uploadVectorDocument(
  params: UploadVectorDocumentParams
): Promise<UploadVectorDocumentResponse> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('collection', params.collection);
  if (params.metadata) {
    formData.append('metadata', JSON.stringify(params.metadata));
  }

  const response = await apiClient.post<ApiResponse<UploadVectorDocumentResponse>>(
    '/admin/vectors/upload',
    formData,
    {
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!event.total || event.total <= 0) return;
        const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        params.onUploadProgress?.(progress);
      },
    }
  );
  return ensureData(response.data, 'API contract');
}

export async function rebuildVectorIndex(): Promise<{ message: string; database: VectorDatabase }> {
  const response = await apiClient.post<
    ApiResponse<{ message: string; database: VectorDatabase }>
  >('/admin/vectors/rebuild');
  return ensureData(response.data, 'API contract');
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
  getVectorDatabases,
  uploadVectorDocument,
  rebuildVectorIndex,
  getMedicationNormalizationConfig,
  updateMedicationNormalizationConfig,
};
