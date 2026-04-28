/**
 * Centralised TanStack Query key factory.
 *
 * Lives in `src/lib/` (not `src/hooks/`) so non-hook modules
 * (e.g. patient-data-sync.ts) can import it without creating a
 * lib → hooks reverse dependency.
 *
 * Usage:
 *   queryKeys.patients.all          → ['patients']
 *   queryKeys.patients.list(filters) → ['patients', 'list', filters]
 *   queryKeys.patients.detail(id)    → ['patients', 'detail', id]
 *   queryKeys.dashboard.stats()      → ['dashboard', 'stats']
 */
export const queryKeys = {
  patients: {
    all: ['patients'] as const,
    lists: () => [...queryKeys.patients.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.patients.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.patients.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.patients.details(), id] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    stats: () => [...queryKeys.dashboard.all, 'stats'] as const,
  },
  ai: {
    all: ['ai'] as const,
    readiness: () => [...queryKeys.ai.all, 'readiness'] as const,
    sessions: (params?: Record<string, unknown>) =>
      [...queryKeys.ai.all, 'sessions', params ?? {}] as const,
    session: (id: string) => [...queryKeys.ai.all, 'session', id] as const,
  },
} as const;
