/** Read the backend classification derived from the source ATC_CODE field. */
export function isAntibiotic(med: { isAntibiotic?: boolean | null }): boolean {
  return med.isAntibiotic === true;
}
