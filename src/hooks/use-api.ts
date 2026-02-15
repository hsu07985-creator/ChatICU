import { useState, useCallback } from 'react';
import { toast } from 'sonner';

interface UseApiOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
  successMessage?: string;
}

interface UseApiReturn<T, P extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  execute: (...params: P) => Promise<T | null>;
  reset: () => void;
}

/**
 * 通用 API 呼叫 Hook
 * 處理 loading 狀態、錯誤處理和成功回調
 */
export function useApi<T, P extends unknown[] = []>(
  apiFunction: (...params: P) => Promise<T>,
  options: UseApiOptions<T> = {}
): UseApiReturn<T, P> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (...params: P): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiFunction(...params);
        setData(result);

        if (options.showSuccessToast && options.successMessage) {
          toast.success(options.successMessage);
        }

        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        options.onError?.(error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiFunction, options]
  );

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
}

/**
 * 用於需要自動執行的 API 呼叫
 */
export function useApiQuery<T>(
  apiFunction: () => Promise<T>,
  options: UseApiOptions<T> & { enabled?: boolean } = {}
) {
  const { enabled = true, ...restOptions } = options;
  const api = useApi(apiFunction, restOptions);

  // 自動執行 (需要在 useEffect 中調用)
  const autoExecute = useCallback(() => {
    if (enabled) {
      api.execute();
    }
  }, [enabled, api]);

  return { ...api, autoExecute };
}

/**
 * 用於 mutation 操作 (POST, PUT, DELETE)
 */
export function useApiMutation<T, P extends unknown[] = []>(
  apiFunction: (...params: P) => Promise<T>,
  options: UseApiOptions<T> = {}
) {
  return useApi(apiFunction, options);
}

