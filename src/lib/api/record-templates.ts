import apiClient, { ensureData } from '../api-client';

export type RecordTemplateType = 'progress-note' | 'medication-advice' | 'nursing-record';
export type RecordTemplateRoleScope = 'doctor' | 'nurse' | 'pharmacist' | 'admin' | 'all';

export interface RecordTemplate {
  id: string;
  name: string;
  description?: string | null;
  recordType: RecordTemplateType;
  roleScope: RecordTemplateRoleScope;
  content: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  createdById: string;
  createdByName: string;
  updatedById?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function listRecordTemplates(recordType: RecordTemplateType, includeInactive = false): Promise<RecordTemplate[]> {
  const params = new URLSearchParams({
    recordType,
    includeInactive: String(includeInactive),
  });
  const response = await apiClient.get<ApiResponse<{ templates: RecordTemplate[] }>>(`/record-templates?${params}`);
  return ensureData(response.data, 'API contract').templates ?? [];
}

export async function createRecordTemplate(data: {
  name: string;
  description?: string;
  recordType: RecordTemplateType;
  roleScope: RecordTemplateRoleScope;
  content: string;
  isSystem?: boolean;
  sortOrder?: number;
}): Promise<RecordTemplate> {
  const response = await apiClient.post<ApiResponse<RecordTemplate>>('/record-templates', {
    name: data.name,
    description: data.description || undefined,
    record_type: data.recordType,
    role_scope: data.roleScope,
    content: data.content,
    is_system: data.isSystem ?? false,
    sort_order: data.sortOrder ?? 0,
  });
  return ensureData(response.data, 'API contract');
}

export async function updateRecordTemplate(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    roleScope: RecordTemplateRoleScope;
    content: string;
    isSystem: boolean;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<RecordTemplate> {
  const response = await apiClient.patch<ApiResponse<RecordTemplate>>(`/record-templates/${id}`, {
    name: data.name,
    description: data.description,
    role_scope: data.roleScope,
    content: data.content,
    is_system: data.isSystem,
    is_active: data.isActive,
    sort_order: data.sortOrder,
  });
  return ensureData(response.data, 'API contract');
}

export async function deleteRecordTemplate(id: string): Promise<void> {
  await apiClient.delete(`/record-templates/${id}`);
}
