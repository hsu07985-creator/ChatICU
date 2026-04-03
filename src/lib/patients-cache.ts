import { getPatients, type Patient } from './api/patients';

let _cache: Patient[] | null = null;
let _timestamp = 0;
let _pending: Promise<Patient[]> | null = null;
const STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the cached patient list. If the cache is stale or empty,
 * fetches from API (deduplicating concurrent calls).
 */
export async function getCachedPatients(): Promise<Patient[]> {
  if (_cache && Date.now() - _timestamp < STALE_MS) {
    return _cache;
  }
  // Deduplicate concurrent fetches
  if (!_pending) {
    _pending = getPatients({ limit: 100 })
      .then(res => {
        _cache = res.patients;
        _timestamp = Date.now();
        return _cache;
      })
      .finally(() => { _pending = null; });
  }
  return _pending;
}

/** Read cache synchronously (may be null on first load) */
export function getCachedPatientsSync(): Patient[] | null {
  return _cache;
}

/** Force-refresh the cache (after create/update/archive) */
export async function invalidatePatients(): Promise<Patient[]> {
  _cache = null;
  _timestamp = 0;
  return getCachedPatients();
}

/** Check if cache is fresh */
export function isPatientsCacheFresh(): boolean {
  return !!_cache && Date.now() - _timestamp < STALE_MS;
}
