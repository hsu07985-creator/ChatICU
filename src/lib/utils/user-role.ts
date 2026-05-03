import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import type { UserRole } from '../api/team-chat';

// Static zh-TW fallback. Reads survive in non-React contexts and act as
// the safety net when a key is missing from the active dictionary. New
// React code should prefer {@link useRoleLabel} for reactive switching.
export const ROLE_LABEL: Record<UserRole, string> = {
  doctor: '醫師',
  np: '專科護理師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: '管理者',
};

export function roleLabel(role: string): string {
  const key = role as UserRole;
  return i18n.t(key, { ns: 'roles', defaultValue: ROLE_LABEL[key] ?? role });
}

export function useRoleLabel() {
  const { t } = useTranslation('roles');
  return (role: string): string => {
    const key = role as UserRole;
    return t(key, { defaultValue: ROLE_LABEL[key] ?? role });
  };
}
