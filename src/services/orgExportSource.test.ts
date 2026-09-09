import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organisation export reads staff through the view, not the base table.
 *
 * `0150` revoked `select` on five columns of `staff_profiles` from
 * `authenticated`, which made `select('*')` on that table a 42501 for
 * everyone, owner included. `exportOrganisationData` catches a per-table
 * error and lists the table under `omitted`, so the export did not fail —
 * it shipped with an empty staff table and a footnote, which is the exact
 * failure the export's own doc comment argues against.
 *
 * What is pinned here is the read source, because that is the part a future
 * privilege change breaks silently: the moment somebody points this back at
 * `staff_profiles`, the export loses its workforce again and every gate in
 * the repository still passes. `check:export` counts tables in a list; it has
 * no opinion about which relation supplies the rows.
 */

/** Every relation the export asked for, in order. */
const relations: string[] = [];

vi.mock('@/lib/supabase', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const from = (relation: string) => {
    relations.push(relation);
    const rows: unknown[] =
      relation === 'staff_profiles_visible'
        ? [{ id: 'staff-1', org_id: 'org-1', first_name: 'Sam', payroll_id: 'PAY-001' }]
        : [];
    const builder = {
      select: () => builder,
      // `organisations` is read with .single(); every other relation is awaited.
      single: () => Promise.resolve({ data: { id: 'org-1', slug: 'org' }, error: null }),
      eq: () => builder,
      then: (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
      ): Promise<unknown> => Promise.resolve(resolve({ data: rows, error: null })),
    };
    return builder;
  };
  return { supabase: { from } };
});

describe('exportOrganisationData read sources', () => {
  beforeEach(() => {
    relations.length = 0;
  });

  it('reads staff through staff_profiles_visible and never the base table', async () => {
    const { exportOrganisationData } = await import('@/services/orgLifecycleService');
    const result = await exportOrganisationData('org-1');

    expect(relations).toContain('staff_profiles_visible');
    expect(relations).not.toContain('staff_profiles');

    // The customer's file keeps the table's own name, whatever supplied it.
    expect(result.tables.staff_profiles).toHaveLength(1);
    expect(result.omitted).toHaveLength(0);
  });

  it('keeps the personal columns the view is there to carry', async () => {
    const { exportOrganisationData } = await import('@/services/orgLifecycleService');
    const result = await exportOrganisationData('org-1');

    // An export whose staff rows have no payroll id is the pre-0150 bug in a
    // quieter form: the table is present, the data is not.
    const [staff] = result.tables.staff_profiles as { payroll_id?: string }[];
    expect(staff?.payroll_id).toBe('PAY-001');
  });
});
