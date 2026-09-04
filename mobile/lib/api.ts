import CookieManager from '@react-native-cookies/cookies';

import { DEFAULT_API_BASE_URL, getStoredApiBaseUrl, setStoredApiBaseUrl } from './storage';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let cachedBaseUrl: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await getStoredApiBaseUrl();
  cachedBaseUrl = stored || DEFAULT_API_BASE_URL;
  return cachedBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  cachedBaseUrl = trimmed;
  await setStoredApiBaseUrl(trimmed);
  // Switching servers means any previously stored admin session cookie is
  // for the wrong host's session Map — drop it so we don't send stale junk.
  await CookieManager.clearAll();
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `?${params.join('&')}` : '';
}

// Matches the server's `{ error: string }` convention (server/index.js) —
// every failed request throws an ApiError carrying that message and the
// HTTP status so screens can branch on 401 vs 404 vs 409 etc.
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${path}${buildQuery(options.query)}`;

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. an HTML error page from a misconfigured
      // base URL) — surface the raw text so it's still visible to the user.
      throw new ApiError(text.slice(0, 200) || `HTTP ${res.status}`, res.status);
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (data && typeof data === 'object' && 'error' in data && (data as any).error) {
      message = String((data as any).error);
    }
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(path: string, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { method: 'GET', query }),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T = unknown>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
