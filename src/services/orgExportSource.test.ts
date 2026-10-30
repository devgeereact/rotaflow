import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organisation export reads staff through the staff route, which nulls
 * the sensitive columns for anyone but an owner, a manager or the person.
 *
 * `exportOrganisationData` catches a per-table error and lists the table under
 * `omitted`, so an export pointed at the wrong source does not fail: it ships
 * with an empty staff table and a footnote, the exact failure the export's own
 * doc comment argues against. What is pinned here is the read source and that
 * the personal columns survive the trip.
 */

/** Every API path the export read, in order. */
const paths: string[] = [];

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  const get = (path: string): Promise<unknown> => {
    paths.push(path);
    if (path === '/orgs/org-1')
      return Promise.resolve({
        org: { id: 'org-1', name: 'Org', slug: 'org', settings: {} },
      });
    if (path === '/orgs/org-1/staff') {
      return Promise.resolve({
        staff: [
          { id: 'staff-1', org_id: 'org-1', first_name: 'Sam', payroll_id: 'PAY-001' },
        ],
      });
    }
    // Every other list route answers an empty list under whatever key it uses.
    return Promise.resolve(new Proxy({}, { get: () => [] }));
  };
  return { ...actual, api: { get, post: () => Promise.resolve({}) } };
});

describe('exportOrganisationData read sources', () => {
  beforeEach(() => {
    paths.length = 0;
  });

  it('reads staff through the staff route, which applies the visibility rule', async () => {
    const { exportOrganisationData } = await import('@/services/orgLifecycleService');
    const result = await exportOrganisationData('org-1');

    expect(paths).toContain('/orgs/org-1/staff');

    // The customer's file keeps the table's own name, whatever supplied it.
    expect(result.tables.staff_profiles).toHaveLength(1);
    // A table the API has no route for is named under omitted, never dropped silently.
    expect(result.omitted.map((o) => o.table)).toContain('notification_templates');
    expect(result.omitted.map((o) => o.table)).not.toContain('staff_profiles');
  });

  it('keeps the personal columns the view is there to carry', async () => {
    const { exportOrganisationData } = await import('@/services/orgLifecycleService');
    const result = await exportOrganisationData('org-1');

    // An export whose staff rows have no payroll id is the old visibility bug in a
    // quieter form: the table is present, the data is not.
    const [staff] = result.tables.staff_profiles as { payroll_id?: string }[];
    expect(staff?.payroll_id).toBe('PAY-001');
  });
});
