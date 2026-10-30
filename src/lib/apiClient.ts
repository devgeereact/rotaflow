/**
 * The client for the PHP API (`backend/`). Pure: the token source, the base URL and `fetch` are passed in,
 * so it is tested without a browser and imports nothing from `src/services` or `@/lib/supabase`.
 *
 * Every error the API returns has one shape, `{"error":{"code","message"}}`. It is turned into an `ApiError`
 * carrying the HTTP status and the stable `code`, so a screen can branch on `code` (for example
 * `already_applied` or `invite_email_mismatch`) instead of parsing prose.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiClientOptions {
  /** e.g. `/api` in production (same origin) or the live API origin under local-live. */
  baseUrl: string;
  /** Resolves the current Clerk session token, or null when signed out. Called once per request. */
  getToken: () => Promise<string | null>;
  /** Called on a 401 so the app can send the person to sign in. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  get: <T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function isErrorBody(v: unknown): v is { error: { code: string; message: string } } {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const e: unknown = v.error;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit', // the bearer token is the only credential; no cookies cross to the API
      });
    } catch {
      throw new ApiError(0, 'network', 'Could not reach the server');
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized?.();
      if (isErrorBody(payload)) {
        throw new ApiError(res.status, payload.error.code, payload.error.message);
      }
      throw new ApiError(res.status, 'http_error', `Request failed (${res.status})`);
    }
    return payload as T;
  }

  return {
    get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  };
}
