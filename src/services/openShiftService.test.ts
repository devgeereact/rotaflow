import { describe, expect, it, vi } from 'vitest';

/** The list's own eligibility field (owner decision, 31 Oct 2026) is read defensively. */
const get = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('@/lib/api', () => ({
  api: { get: (p: string) => get(p), post: vi.fn() },
  orgPath: (o: string, rest: string) => `/orgs/${o}${rest}`,
  currentOrgId: () => 'org-1',
  seg: (s: string) => s,
}));

const { listOpenShifts } = await import('./openShiftService');

const row = (my: unknown): Record<string, unknown> => ({
  shift_id: 's1',
  starts_at: '2030-04-01T09:00:00Z',
  ends_at: '2030-04-01T17:00:00Z',
  break_minutes: '30',
  notes: null,
  shift_type: null,
  location_name: 'Ward A',
  clashes_with_mine: false,
  ...(my === undefined ? {} : { my_eligibility: my }),
});

describe('listOpenShifts: my_eligibility', () => {
  it("maps the reader's own eligibility and reasons", async () => {
    get.mockResolvedValue({
      open_shifts: [
        row({
          eligible: false,
          reasons: [{ code: 'leave', message: 'On approved holiday' }],
        }),
      ],
    });
    const [s] = await listOpenShifts('org-1');
    expect(get).toHaveBeenCalledWith('/orgs/org-1/open-shifts');
    expect(s?.myEligibility).toEqual({
      eligible: false,
      reasons: [{ code: 'leave', message: 'On approved holiday' }],
    });
    expect(s?.breakMinutes).toBe(30);
  });

  it('reads null, a missing field or a malformed one as no eligibility, and drops bad reasons', async () => {
    get.mockResolvedValue({
      open_shifts: [
        row(null),
        row(undefined),
        row({ eligible: 'no', reasons: [] }),
        row({
          eligible: false,
          reasons: [{ code: 'leave' }, 'x', { code: 'documents', message: 'Missing' }],
        }),
      ],
    });
    const list = await listOpenShifts('org-1');
    expect(list.map((s) => s.myEligibility)).toEqual([
      null,
      null,
      null,
      { eligible: false, reasons: [{ code: 'documents', message: 'Missing' }] },
    ]);
  });
});
