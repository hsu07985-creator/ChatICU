import { getPadDrugs, type PadDrugInfo } from './api/pharmacy';

let _cache: PadDrugInfo[] | null = null;
let _pending: Promise<PadDrugInfo[]> | null = null;
// PAD drug catalog rarely changes — cache for 30 minutes
const STALE_MS = 30 * 60 * 1000;
let _timestamp = 0;

/**
 * Get the cached PAD drug catalog. Fetches once and reuses.
 */
export async function getCachedPadDrugs(): Promise<PadDrugInfo[]> {
  if (_cache && Date.now() - _timestamp < STALE_MS) {
    return _cache;
  }
  if (!_pending) {
    _pending = getPadDrugs()
      .then(res => {
        _cache = res.drugs;
        _timestamp = Date.now();
        return _cache;
      })
      .finally(() => { _pending = null; });
  }
  return _pending;
}

/** Read cache synchronously (may be null on first load) */
export function getCachedPadDrugsSync(): PadDrugInfo[] | null {
  return _cache;
}
