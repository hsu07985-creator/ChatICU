import { getDashboardStats, type DashboardStats } from './api/dashboard';

let cache: DashboardStats | null = null;
let timestamp = 0;
let pending: Promise<DashboardStats> | null = null;
const STALE_MS = 5 * 60 * 1000;
const listeners = new Set<(stats: DashboardStats) => void>();

function notifyDashboardStatsListeners(stats: DashboardStats) {
  listeners.forEach((listener) => listener(stats));
}

export async function getCachedDashboardStats(): Promise<DashboardStats> {
  if (cache && Date.now() - timestamp < STALE_MS) {
    return cache;
  }

  if (!pending) {
    pending = getDashboardStats()
      .then((data) => {
        cache = data;
        timestamp = Date.now();
        notifyDashboardStatsListeners(data);
        return data;
      })
      .finally(() => {
        pending = null;
      });
  }

  return pending;
}

export function getCachedDashboardStatsSync(): DashboardStats | null {
  return cache;
}

export async function invalidateDashboardStats(): Promise<DashboardStats> {
  cache = null;
  timestamp = 0;
  return getCachedDashboardStats();
}

export function subscribeDashboardStats(
  listener: (stats: DashboardStats) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
