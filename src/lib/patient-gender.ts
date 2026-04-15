export type NormalizedPatientSex = 'male' | 'female';

export function normalizePatientGender(
  gender: string | null | undefined,
): NormalizedPatientSex | undefined {
  const value = String(gender ?? '').trim().toLowerCase();
  if (!value) return undefined;

  if (value === '男' || value === 'm' || value === 'male') {
    return 'male';
  }

  if (value === '女' || value === 'f' || value === 'female') {
    return 'female';
  }

  return undefined;
}
