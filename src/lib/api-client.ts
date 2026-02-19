import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { toast } from 'sonner';

// API 配置 — dev 走 Vite proxy（同源），production 可用 VITE_API_URL 覆蓋
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Cookie name (non-httpOnly, set by backend — used only for login-state check)
const COOKIE_LOGGED_IN_KEY = 'chaticu_logged_in';

// Legacy localStorage keys (cleared on first load for migration)
const TOKEN_KEY = 'chaticu_token';
const REFRESH_TOKEN_KEY = 'chaticu_refresh_token';

export interface ApiResponse<T> {
  success?: boolean;
  message?: string;
  error?: string;
  data?: T;
  request_id?: string;
  trace_id?: string;
}

interface RequestMeta {
  requestId: string;
  traceId: string;
}

interface ApiClientConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  metadata?: RequestMeta;
  suppressErrorToast?: boolean;
}

interface ApiErrorContext {
  requestId?: string;
  traceId?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `fe_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `fe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function resolveRequestMeta(config?: ApiClientConfig | null): RequestMeta {
  const requestId = config?.metadata?.requestId || createRequestId();
  const traceId = config?.metadata?.traceId || requestId;
  return { requestId, traceId };
}

function readHeaderValue(headers: unknown, key: string): string | undefined {
  if (!headers) return undefined;
  if (isObjectRecord(headers)) {
    const direct = headers[key] ?? headers[key.toLowerCase()];
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }
  }
  return undefined;
}

export function getApiErrorContext(error: unknown): ApiErrorContext {
  if (!axios.isAxiosError(error)) {
    return {};
  }

  const data = error.response?.data as { request_id?: string; trace_id?: string } | undefined;
  const responseRequestId = readHeaderValue(error.response?.headers, 'X-Request-ID');
  const responseTraceId = readHeaderValue(error.response?.headers, 'X-Trace-ID');
  const config = error.config as ApiClientConfig | undefined;
  const fallbackMeta = resolveRequestMeta(config);

  return {
    requestId: data?.request_id || responseRequestId || fallbackMeta.requestId,
    traceId: data?.trace_id || responseTraceId || fallbackMeta.traceId,
  };
}

function formatErrorContextSuffix(context: ApiErrorContext): string {
  const parts: string[] = [];
  if (context.requestId) {
    parts.push(`request_id=${context.requestId}`);
  }
  if (context.traceId) {
    parts.push(`trace_id=${context.traceId}`);
  }
  return parts.length ? ` (${parts.join(' ')})` : '';
}

export function ensureSuccess<T>(
  payload: ApiResponse<T> | null | undefined,
  context: string
): ApiResponse<T> {
  if (!isObjectRecord(payload)) {
    throw new Error(`[INTG][API][CONTRACT] ${context}: 回應格式錯誤（非 JSON 物件）`);
  }

  const normalized = payload as ApiResponse<T>;
  if (normalized.success === false) {
    throw new Error(normalized.message || `[INTG][API][CONTRACT] ${context}: 請求失敗`);
  }

  return normalized;
}

export function ensureData<T>(
  payload: ApiResponse<T> | null | undefined,
  context: string
): T {
  const normalized = ensureSuccess(payload, context);
  if (normalized.data === undefined || normalized.data === null) {
    throw new Error(`[INTG][API][CONTRACT] ${context}: 回應缺少 data 欄位`);
  }
  return normalized.data;
}

export function getApiErrorMessage(error: unknown, fallback = '操作失敗'): string {
  const context = getApiErrorContext(error);
  const traceSuffix = formatErrorContextSuffix(context);

  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) {
      return `${data.message}${traceSuffix}`;
    }
    if (!error.response) {
      return `網路連線失敗，請檢查網路狀態${traceSuffix}`;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

// Token 管理 — httpOnly cookie 模式
// JWT 存在 httpOnly cookie 中（由 backend Set-Cookie），JS 不可直接讀寫。
// 僅用 non-httpOnly `chaticu_logged_in` cookie 判斷是否已登入。
export const tokenManager = {
  /** @deprecated Tokens are now in httpOnly cookies; returns null. */
  getToken: (): string | null => null,
  /** @deprecated No-op — tokens set via Set-Cookie by backend. */
  setToken: (_token: string): void => { /* no-op */ },
  removeToken: (): void => { /* no-op */ },

  /** @deprecated No-op — refresh token in httpOnly cookie. */
  getRefreshToken: (): string | null => null,
  /** @deprecated No-op. */
  setRefreshToken: (_token: string): void => { /* no-op */ },
  removeRefreshToken: (): void => { /* no-op */ },

  /** Clear any legacy localStorage remnants and the indicator cookie. */
  clearAll: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    // Also clear the non-httpOnly indicator cookie to prevent auth-check loops
    document.cookie = `${COOKIE_LOGGED_IN_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  },

  /** Check non-httpOnly indicator cookie set by backend. */
  isLoggedIn: (): boolean => {
    return document.cookie.split(';').some(c => c.trim().startsWith(`${COOKIE_LOGGED_IN_KEY}=`));
  },
};

// 建立 Axios instance — withCredentials 讓 httpOnly cookie 隨請求送出
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request 攔截器 — 附加 trace headers（token 由 httpOnly cookie 自動隨請求送出）
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const mutableConfig = config as ApiClientConfig;
    const requestMeta = resolveRequestMeta(mutableConfig);
    mutableConfig.metadata = requestMeta;

    if (mutableConfig.headers) {
      mutableConfig.headers['X-Request-ID'] = requestMeta.requestId;
      mutableConfig.headers['X-Trace-ID'] = requestMeta.traceId;
    }

    return mutableConfig;
  },
  (error) => Promise.reject(error)
);

// Response 攔截器 — 錯誤處理與 cookie-based refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: () => void;
  reject: (error: AxiosError) => void;
}> = [];

const processQueue = (error: AxiosError | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as ApiClientConfig;

    // 處理 401 錯誤 — 嘗試透過 httpOnly cookie 刷新
    // Skip auto-refresh for auth endpoints themselves to prevent loops
    const requestUrl = originalRequest?.url || '';
    const isAuthEndpoint = requestUrl.includes('/auth/');
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise<void>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => apiClient(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshRequestId = createRequestId();
        await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          {
            withCredentials: true,
            headers: {
              'X-Request-ID': refreshRequestId,
              'X-Trace-ID': refreshRequestId,
            },
          }
        );
        processQueue(null);
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as AxiosError);
        tokenManager.clearAll();
        // Only redirect if not already on the login page (prevents infinite reload loop)
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // 處理其他錯誤
    handleApiError(error);
    return Promise.reject(error);
  }
);

// 錯誤處理函數 - 配合 Dart Frog ResponseUtils 格式
// 後端錯誤格式: { error: 'ErrorCode', message: '錯誤訊息' }
function handleApiError(error: AxiosError) {
  const config = error.config as ApiClientConfig | undefined;
  const suppressErrorToast = Boolean(config?.suppressErrorToast);
  const status = error.response?.status;
  const data = error.response?.data as {
    error?: string;
    message?: string;
    success?: boolean;
    request_id?: string;
    trace_id?: string;
  } | undefined;
  const errorCode = data?.error;
  const message = data?.message || error.message;
  const context = getApiErrorContext(error);
  const traceSuffix = formatErrorContextSuffix(context);

  // 記錄錯誤以便調試
  console.error(
    `[INTG][API] request failed status=${status ?? 'N/A'} code=${errorCode ?? 'N/A'} message=${message}${traceSuffix}`
  );

  if (suppressErrorToast) return;

  switch (status) {
    case 400:
      toast.error(`請求錯誤: ${message}${traceSuffix}`);
      break;
    case 422:
      toast.error(`資料格式錯誤: ${message}${traceSuffix}`);
      break;
    case 403:
      toast.error(`權限不足: ${message}${traceSuffix}`);
      break;
    case 404:
      toast.error(`資源不存在: ${message}${traceSuffix}`);
      break;
    case 502:
      toast.error(`上游服務錯誤: ${message}${traceSuffix}`);
      break;
    case 503:
      toast.error(`服務暫時不可用: ${message}${traceSuffix}`);
      break;
    case 500:
      toast.error(`伺服器錯誤，請稍後再試${traceSuffix}`);
      break;
    default:
      if (!error.response) {
        toast.error(`網路連線失敗，請檢查網路狀態${traceSuffix}`);
      }
  }
}

// 匯出 API 基礎 URL 供其他模組使用
export const getApiBaseUrl = () => API_BASE_URL;

export default apiClient;
