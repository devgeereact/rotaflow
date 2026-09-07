import { describe, expect, it } from 'vitest';
import { resolveOrganisationTabs } from '@/lib/organisationTabs';

/**
 * The organisation-detail route carries no `RequirePlatformRole`, deliberately:
 * `platform_finance` legitimately needs the Subscription and Usage tabs, which
 * are billing state. The gate is on the tabs instead, and this is what asserts
 * it.
 *
 * The defect being guarded: `0122` put memberships, profiles, audit logs,
 * support cases and integrations behind `is_platform_operational()`, and RLS
 * FILTERS rather than raises. So a finance administrator opening this page read
 * "This organisation has no members", an empty audit tab, and a Users tile of 0
 * beside a Locations tile with a real number — a boundary rendered as a broken
 * product. Verified live against the local stack before this was written:
 * finance saw 0 memberships and 0 audit rows while the organisation itself and
 * `platform_tenant_counts` still resolved.
 *
 * The preview harness signs in as a Platform Owner and has no role switch, so
 * none of this is reachable in the browser. That is exactly why the logic is a
 * pure function.
 */
describe('resolveOrganisationTabs', () => {
  const OPERATIONAL = ['users', 'support', 'integrations', 'audit', 'data'];
  const ALWAYS = ['overview', 'locations', 'subscription', 'usage'];

  it('offers an operational role every tab', () => {
    const result = resolveOrganisationTabs({
      requested: null,
      canReadTenantOperations: true,
    });
    expect(result.visible).toHaveLength(9);
    for (const tab of [...ALWAYS, ...OPERATIONAL]) {
      expect(result.visible).toContain(tab);
    }
  });

  it('offers finance only the tabs that are billing state', () => {
    const result = resolveOrganisationTabs({
      requested: null,
      canReadTenantOperations: false,
    });
    expect([...result.visible]).toEqual(ALWAYS);
    for (const tab of OPERATIONAL) {
      expect(result.visible).not.toContain(tab);
    }
  });

  it('refuses an operational tab reached by URL, rather than showing it empty', () => {
    for (const tab of OPERATIONAL) {
      const result = resolveOrganisationTabs({
        requested: tab,
        canReadTenantOperations: false,
      });
      expect(result.refused).toBe(tab);
      // And it does not silently strand the reader on the refused tab.
      expect(result.active).toBe('overview');
    }
  });

  it('does not refuse a tab the role can actually read', () => {
    for (const tab of [...ALWAYS, ...OPERATIONAL]) {
      const result = resolveOrganisationTabs({
        requested: tab,
        canReadTenantOperations: true,
      });
      expect(result.refused).toBeNull();
      expect(result.active).toBe(tab);
    }
  });

  it('a billing tab still works for finance', () => {
    const result = resolveOrganisationTabs({
      requested: 'subscription',
      canReadTenantOperations: false,
    });
    expect(result.active).toBe('subscription');
    expect(result.refused).toBeNull();
  });

  it('an unknown tab falls back silently, and is not reported as a refusal', () => {
    // The two cases must stay apart: a typo is not a permission problem, and
    // telling somebody their role forbids "?tab=nonsense" would be a lie.
    for (const canRead of [true, false]) {
      const result = resolveOrganisationTabs({
        requested: 'nonsense',
        canReadTenantOperations: canRead,
      });
      expect(result.active).toBe('overview');
      expect(result.refused).toBeNull();
    }
  });

  it('no tab requested is not a refusal either', () => {
    const result = resolveOrganisationTabs({
      requested: null,
      canReadTenantOperations: false,
    });
    expect(result.active).toBe('overview');
    expect(result.refused).toBeNull();
  });
});
