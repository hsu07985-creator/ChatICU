export function maskPatientName(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  if (!raw) return '';
  const chars = Array.from(raw);
  if (chars.length <= 1) return raw;
  if (chars.length === 2) return chars[0] + '○';
  return chars[0] + '○'.repeat(chars.length - 2) + chars[chars.length - 1];
}
