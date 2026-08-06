import { describe, expect, it } from 'vitest';
import { isOrgStateStale, type OrgLoadState } from '@/lib/orgLoading';

const state = (patch: Partial<OrgLoadState>): OrgLoadState => ({
  authLoading: false,
  queryLoading: false,
  userId: null,
  loadedForUserId: null,
  ...patch,
});

describe('isOrgStateStale', () => {
  it('waits while the auth session is being restored', () => {
    expect(isOrgStateStale(state({ authLoading: true }))).toBe(true);
  });

  it('waits while a memberships query is in flight', () => {
    expect(
      isOrgStateStale(state({ queryLoading: true, userId: 'u1', loadedForUserId: 'u1' })),
    ).toBe(true);
  });

  it('is resolved once a signed-in user has their own state loaded', () => {
    expect(isOrgStateStale(state({ userId: 'u1', loadedForUserId: 'u1' }))).toBe(false);
  });

  it('treats signed out as resolved rather than pending', () => {
    expect(isOrgStateStale(state({}))).toBe(false);
  });

  /**
   * The bug this module exists for. The provider mounts above the auth gate,
   * finishes its "no user" pass, and reports a settled empty state. Auth then
   * resolves and the tenant shell renders in the same pass. If that moment
   * reads as resolved, an empty membership list is taken at face value and the
   * user is redirected into onboarding.
   */
  it('is stale in the window between auth resolving and the query re-running', () => {
    expect(isOrgStateStale(state({ userId: 'u1', loadedForUserId: null }))).toBe(true);
  });

  /** The same hazard on the way out: signing in as somebody else. */
  it('is stale while the state still describes the previous user', () => {
    expect(isOrgStateStale(state({ userId: 'u2', loadedForUserId: 'u1' }))).toBe(true);
  });

  /**
   * A failed query must still resolve. Holding the app on the boot screen for
   * ever would hide the "Couldn't load your organisations" card and its Retry
   * button, so the provider records the id in `finally` and this stays false.
   */
  it('is resolved after a failed load, so the retry card can be shown', () => {
    expect(isOrgStateStale(state({ userId: 'u1', loadedForUserId: 'u1' }))).toBe(false);
  });
});
