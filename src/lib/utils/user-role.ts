import type { UserRole } from '../api/team-chat';

export const ROLE_LABEL: Record<UserRole, string> = {
  doctor: '醫師',
  np: '專科護理師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: '管理者',
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as UserRole] ?? role;
}
