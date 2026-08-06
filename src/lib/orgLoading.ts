/**
 * When the organisation context may be trusted.
 *
 * `OrgProvider` sits above `ProtectedRoute`, so it mounts and runs once while
 * auth is still restoring. That pass takes the "no user" branch and settles on
 * "no memberships, not a platform admin, finished loading", which is a correct
 * description of nobody. When auth then resolves, `ProtectedRoute` renders the
 * tenant shell in the same pass, and the shell reads that settled state before
 * the provider's effect has re-run for the user who just arrived.
 *
 * What the shell saw was a finished load and an empty membership list, which
 * is indistinguishable from a brand-new signup, so it redirected to onboarding
 * with `replace`. Every cold load of an `/app/*` URL ended there: a pasted
 * link, a page refresh, reopening the installed app. An owner of several
 * organisations was invited to create their first one, and because the
 * redirect replaced the history entry, the back button could not undo it.
 *
 * The missing question is not "has a query finished" but "does the state on
 * hand describe the user who is signed in now". Answering it needs the id the
 * state was loaded for, which is why the provider tracks one.
 */
export interface OrgLoadState {
  /** The auth session is still being restored. */
  authLoading: boolean;
  /** A memberships query is in flight. */
  queryLoading: boolean;
  /** Who is signed in now, or null. */
  userId: string | null;
  /** Who the loaded memberships and platform flag describe, or null. */
  loadedForUserId: string | null;
}

/**
 * True while the organisation context describes someone other than the current
 * user, or nobody yet. Consumers must show a loading state rather than draw
 * conclusions from `memberships`.
 *
 * Signed out is a resolved answer, not a pending one: once auth has settled on
 * no user, `loadedForUserId` is null too and there is nothing left to wait for.
 */
export function isOrgStateStale(state: OrgLoadState): boolean {
  if (state.authLoading || state.queryLoading) return true;
  return state.userId !== state.loadedForUserId;
}
