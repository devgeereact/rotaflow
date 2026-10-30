import { ApiError, createApiClient, type ApiClient } from '@/lib/apiClient';

/**
 * The app's one connection to the PHP API (`backend/`), same origin under `/api`.
 *
 * The token source is wired in by `AuthProvider` once Clerk has loaded, so this module stays free of React and of
 * Clerk: services import `api` and nothing else. Until a source is set every request goes without a token and the
 * API answers 401 for anything that needs one.
 */

type TokenSource = () => Promise<string | null>;

let tokenSource: TokenSource = () => Promise.resolve(null);
let unauthorized: () => void = () => undefined;

/** Called by `AuthProvider`. `onUnauthorized` runs on any 401, which means the session has ended. */
export function setApiAuth(source: TokenSource, onUnauthorized: () => void): void {
  tokenSource = source;
  unauthorized = onUnauthorized;
}

export const API_BASE_URL = '/api';

export const api: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => tokenSource(),
  onUnauthorized: () => unauthorized(),
});

/** `/orgs/{orgId}{rest}` with the id encoded, so a stray value can never change the path. */
export function orgPath(orgId: string, rest = ''): string {
  return `/orgs/${encodeURIComponent(orgId)}${rest}`;
}

/** Encodes one path segment (an id). */
export function seg(id: string): string {
  return encodeURIComponent(id);
}

/** True when the error is the API's answer with this stable code. */
export function isApiCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code);
}

export { ApiError };
