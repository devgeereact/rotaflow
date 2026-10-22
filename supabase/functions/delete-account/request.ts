// The part of delete-account that decides what it is asked to do.
//
// No Deno globals, so it runs under vitest. The handler in index.ts holds the
// service-role key, which can delete ANY user, so what is worth testing outside
// Deno is that it accepts exactly one user id and nothing else, and that it
// reads "already gone" as success so a retried drain does no harm.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DeleteAccountRequest {
  userId: string;
}

/** Validate a body posted by `dispatch_account_deletions()` (0162), or null. */
export function parseDeleteAccountRequest(body: unknown): DeleteAccountRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { userId } = body as Record<string, unknown>;
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  return { userId };
}

/** The fields of an Auth Admin API error this function reads. */
export interface AdminErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Is this error the user already being gone? The drain retries after a lost
 * response, and the second call then finds nobody to delete, which is the
 * outcome it wanted.
 */
export function isAlreadyGone(error: AdminErrorLike): boolean {
  return (
    error.status === 404 ||
    error.code === 'user_not_found' ||
    /user not found/i.test(error.message ?? '')
  );
}
