/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenShift } from '@/services/openShiftService';
import type { CoverOpenShift } from '@/services/coverService';

/**
 * Cover (S12) on the open-shifts board. With the `cover_tools` flag off the board is exactly as
 * before: no cover call, "Take it" as it was. On, the board reads the same eligibility the API
 * enforces on the claim, so a shift someone cannot take says why, and a shift a manager opened a
 * cover request for points to the Cover page instead of offering a claim the API would refuse.
 */
const listOpenShifts = vi.fn<() => Promise<OpenShift[]>>();
const getCoverOpen = vi.fn<() => Promise<CoverOpenShift[]>>();
const flags = new Set<string>();

vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useWorkMode', () => ({
  useWorkMode: () => ({
    mode: 'my-work',
    setMode: vi.fn(),
    canSwitch: true,
    staffProfileId: 'staff-1',
    loading: false,
  }),
}));
vi.mock('@/hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({ has: (k: string) => flags.has(k) }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }));
vi.mock('@/services/locationService', () => ({
  listLocations: () => Promise.resolve([]),
}));
vi.mock('@/services/orgService', () => ({
  getOrganisation: () => Promise.resolve({ timezone: 'Europe/London' }),
}));
vi.mock('@/services/openShiftService', () => ({
  listOpenShifts: () => listOpenShifts(),
  claimOpenShift: vi.fn(),
}));
vi.mock('@/services/coverService', () => ({
  COVER_FEATURE: 'cover_tools',
  getCoverOpen: () => getCoverOpen(),
}));

const shift: OpenShift = {
  shiftId: 'shift-1',
  startsAt: '2029-09-12T09:00:00.000Z',
  endsAt: '2029-09-12T17:00:00.000Z',
  breakMinutes: 0,
  locationName: 'Ward A',
  shiftType: 'Early',
  notes: null,
  clashesWithMine: false,
};
const coverRow = (o: Partial<CoverOpenShift>): CoverOpenShift => ({
  id: 'shift-1',
  rota_id: 'r1',
  location_id: 'l1',
  location_name: 'Ward A',
  shift_type: 'Early',
  staff_profile_id: null,
  starts_at: shift.startsAt,
  ends_at: shift.endsAt,
  break_minutes: 0,
  status: 'open',
  timezone: 'Europe/London',
  notes: null,
  cover_request: null,
  eligible: true,
  reasons: [],
  warnings: [],
  application: null,
  ...o,
});

beforeAll(async () => {
  await import('./OpenShiftsPage');
}, 60_000);
beforeEach(() => {
  flags.clear();
  listOpenShifts.mockResolvedValue([shift]);
  getCoverOpen.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(): Promise<void> {
  const { OpenShiftsPage } = await import('./OpenShiftsPage');
  render(
    <MemoryRouter>
      <OpenShiftsPage />
    </MemoryRouter>,
  );
  await screen.findByText('Ward A');
}

describe('the open shifts board with cover', () => {
  it('is unchanged while the flag is off', async () => {
    await renderPage();
    const take = screen.getByRole<HTMLButtonElement>('button', { name: 'Take it' });
    expect(take.disabled).toBe(false);
    expect(getCoverOpen).not.toHaveBeenCalled();
    expect(screen.queryByText('Manager choosing cover')).toBeNull();
  });

  it('points a shift with a cover request at the Cover page instead of a claim', async () => {
    flags.add('cover_tools');
    getCoverOpen.mockResolvedValue([
      coverRow({ cover_request: { id: 'req-1', note: null, respond_by: null } }),
    ]);
    await renderPage();
    await screen.findByText('Manager choosing cover');
    expect(screen.getByRole('button', { name: 'Offer to cover' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take it' })).toBeNull();
  });

  it('says why a reader cannot take a shift, and does not offer the claim', async () => {
    flags.add('cover_tools');
    getCoverOpen.mockResolvedValue([
      coverRow({
        eligible: false,
        reasons: [{ code: 'leave', message: 'On approved holiday (Wed 12 Sep)' }],
      }),
    ]);
    await renderPage();
    await screen.findByText('On approved holiday (Wed 12 Sep)');
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Take it' }).disabled,
      ).toBe(true);
    });
    expect(screen.getByText('You cannot take this')).toBeTruthy();
  });
});
