import type { UserRole } from './auth-context';

export function canAccessAdmin(role?: UserRole | null): boolean {
  return role === 'admin';
}

export function canAccessPharmacy(role?: UserRole | null): boolean {
  return role === 'pharmacist' || role === 'admin';
}
