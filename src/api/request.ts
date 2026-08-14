// 统一封装 HTTP 请求、鉴权处理、重试和并发去重。
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { useAuthStore } from '@/store/useAuthStore';
import { AUTH_EXPIRED_EVENT } from './authEvents';

export { AUTH_EXPIRED_EVENT };

/** 判断错误是否为 AbortController 取消导致（用于 catch 分支跳过透传） */
export function isRequestCanceled(error: unknown): boolean {
  return axios.isCancel(error) || (error instanceof DOMException && error.name === 'AbortError');
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface ApiError<T = unknown> extends Error {
  code?: number | undefined;
  status?: number | undefined;
  data?: T | undefined;
  originalError?: unknown;
}

export interface RequestConfig<D = unknown> extends AxiosRequestConfig<D> {
  skipAuth?: boolean;
  /** 临时错误的最大重试次数，GET 默认 2 次，写操作默认不重试。 */
  retry?: number;
  /** 重试间隔的基础时长，默认 1000 毫秒，每次按指数增加。 */
  retryDelay?: number;
  /** 是否复用相同参数的在途 GET 请求，默认开启。 */
  dedupe?: boolean;
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let redirectingToLogin = false;

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler;
}

export function resetUnauthorizedRedirect() {
  redirectingToLogin = false;
}

function createApiError<T = unknown>(
  message: string,
  options: Omit<ApiError<T>, 'name' | 'message'> = {},
): ApiError<T> {
  return Object.assign(new Error(message), options);
}

function isApiResponse<T = unknown>(value: unknown): value is ApiResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'data' in value
  );
}

function isSuccessCode(code: number) {
  return code >= 200 && code < 300;
}

function resolveToken(config: RequestConfig) {
  if (config.skipAuth) return null;
  // Zustand：非组件上下文必须用 getState()，hook 形态调用会抛 Invalid hook call
  const authStore = useAuthStore.getState();
  return authStore.token;
}

function handleUnauthorized() {
  const authStore = useAuthStore.getState();
  authStore.clearSession();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  if (redirectingToLogin) return;
  redirectingToLogin = true;

  if (unauthorizedHandler) {
    unauthorizedHandler();
    return;
  }

  if (typeof window !== 'undefined') {
    if (window.location.pathname === '/login') {
      return;
    }

    const current = `${window.location.pathname}${window.location.search}`;
    const redirect = encodeURIComponent(current);
    window.location.replace(`/login?redirect=${redirect}`);
  }
}

instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = resolveToken(config as RequestConfig);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// 重试条件与退避策略。
function isRetryableError(error: AxiosError): boolean {
  // 已取消的请求不应重试。
  if (axios.isCancel(error)) return false;
  // 没有响应时通常是网络错误。
  if (!error.response) return true;
  const status = error.response.status;
  // 服务端错误和限流响应可以重试。
  return status >= 500 || status === 429;
}

function getRetryConfig(config: RequestConfig): { maxRetries: number; baseDelay: number } {
  // GET 天然幂等可安全重试；写操作不具备幂等保证，除非调用方显式声明否则不重试
  const isIdempotentRead = (config.method ?? '').toLowerCase() === 'get';
  return {
    maxRetries: config.retry ?? (isIdempotentRead ? 2 : 0),
    baseDelay: config.retryDelay ?? 1000,
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

instance.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const body = response.data;
    if (!isApiResponse(body)) {
      return body as unknown as AxiosResponse<ApiResponse>;
    }

    if (isSuccessCode(body.code)) {
      return body as unknown as AxiosResponse<ApiResponse>;
    }

    if (body.code === 401) {
      handleUnauthorized();
    }

    return Promise.reject(
      createApiError(body.message || 'Request failed', {
        code: body.code,
        status: response.status,
        data: body.data,
      }),
    );
  },
  async (error: AxiosError<ApiResponse>) => {
    const config = error.config as RequestConfig | undefined;
    const { maxRetries, baseDelay } = getRetryConfig(config ?? {});

    // 重试次数记录在请求配置中，随请求一起传递。
    const retryCount =
      (config as Record<string, unknown> & { __retryCount?: number }).__retryCount ?? 0;

    if (retryCount < maxRetries && isRetryableError(error)) {
      (config as Record<string, unknown> & { __retryCount: number }).__retryCount = retryCount + 1;
      // 使用带随机抖动的指数退避，避免多个请求同时再次冲击服务端。
      const jitter = 0.5 + Math.random() * 0.5;
      const waitMs = baseDelay * Math.pow(2, retryCount) * jitter;
      await delay(waitMs);
      return instance.request(config!);
    }

    // 取消错误保持原样抛出，不包装为 ApiError（让调用方 catch 可区分取消）
    if (isRequestCanceled(error)) {
      return Promise.reject(error);
    }

    const status = error.response?.status;
    const body = error.response?.data;

    if (status === 401) {
      handleUnauthorized();
    }

    return Promise.reject(
      createApiError(body?.message || error.message || 'Network error', {
        code: body?.code ?? status,
        status,
        data: body?.data,
        originalError: error,
      }),
    );
  },
);

// 复用相同参数的在途 GET 请求。
const pendingGets = new Map<string, Promise<ApiResponse<unknown>>>();

/** 根据 URL 和参数生成与参数顺序无关的请求键。 */
export function buildRequestKey(url: string, params?: Record<string, unknown>): string {
  if (!params) return url;
  const normalized = Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
  return normalized ? `${url}?${normalized}` : url;
}

export async function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  config?: RequestConfig,
): Promise<ApiResponse<T>> {
  // 相同地址和参数的在途请求共享同一个 Promise，避免重复访问服务端；
  // 调用方传入自定义 signal 时跳过去重，取消只影响当前调用方。
  const shouldDedupe = (config?.dedupe ?? true) && !config?.signal;
  if (!shouldDedupe) {
    return instance.get<ApiResponse<T>, ApiResponse<T>>(url, { params, ...config });
  }

  const key = buildRequestKey(url, params);
  const pending = pendingGets.get(key);
  if (pending) {
    return pending as Promise<ApiResponse<T>>;
  }

  const request = instance
    .get<ApiResponse<T>, ApiResponse<T>>(url, { params, ...config })
    .finally(() => {
      pendingGets.delete(key);
    });
  pendingGets.set(key, request as Promise<ApiResponse<unknown>>);
  return request;
}

export async function post<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<ApiResponse<T>> {
  return instance.post<ApiResponse<T>, ApiResponse<T>>(url, data, config);
}

export async function put<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<ApiResponse<T>> {
  return instance.put<ApiResponse<T>, ApiResponse<T>>(url, data, config);
}

export async function del<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  config?: RequestConfig,
): Promise<ApiResponse<T>> {
  return instance.delete<ApiResponse<T>, ApiResponse<T>>(url, { params, ...config });
}

export default instance;
