/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The open-shifts board reads two ways, and the reader's staff profile is
 * what decides which.
 *
 * An uncovered shift is a coverage problem for whoever runs the rota and an
 * opportunity for whoever could work it. Until 7 September 2026 the board
 * only knew the second reading: it offered "Take it" to everybody, including
 * an owner with no staff record, for whom the control could only ever fail —
 * `claim_open_shift` writes a `staff_profile_id` and they have none.
 *
 * ## Why this is a component test and not a browser one
 *
 * `0121` gives the founder of an organisation a staff record, so the owner in
 * `e2e/owner-workforce.spec.ts` — who creates their own organisation — always
 * has one. The case this guards is an owner who was invited into an existing
 * organisation, or whose staff record was archived, and reaching that state
 * through the UI would mean seeding a second account and deactivating it. The
 * decision under test is one boolean read from `useWorkMode`, so it is
 * asserted where it is made.
 */
import type { WorkModeContextValue } from '@/context/WorkModeContext';
import type { OpenShift } from '@/services/openShiftService';

const listOpenShifts = vi.fn<() => Promise<OpenShift[]>>();
const useWorkMode = vi.fn<() => WorkModeContextValue>();

vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useWorkMode', () => ({ useWorkMode: () => useWorkMode() }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }));
vi.mock('@/services/openShiftService', () => ({
  listOpenShifts: () => listOpenShifts(),
  claimOpenShift: vi.fn(),
}));

const shift: OpenShift = {
  shiftId: 'shift-1',
  startsAt: '2026-09-12T09:00:00.000Z',
  endsAt: '2026-09-12T17:00:00.000Z',
  breakMinutes: 30,
  locationName: 'Ward A',
  shiftType: 'Early',
  notes: null,
  clashesWithMine: false,
};

beforeEach(() => {
  listOpenShifts.mockResolvedValue([shift]);
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

describe('the open shifts board', () => {
  it('offers no claim to a reader with no staff profile', async () => {
    useWorkMode.mockReturnValue({
      mode: 'management',
      setMode: vi.fn(),
      canSwitch: false,
      staffProfileId: null,
      loading: false,
    });

    await renderPage();

    // Not a disabled "Take it". Claiming does not apply to this reader at all,
    // and a greyed-out primary action reads as "not yet" rather than "not you".
    expect(screen.queryByRole('button', { name: 'Take it' })).toBeNull();
    expect(screen.getByText('Needs cover')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the rota builder' })).toBeTruthy();
  });

  it('offers the claim to a reader who has one', async () => {
    useWorkMode.mockReturnValue({
      mode: 'my-work',
      setMode: vi.fn(),
      canSwitch: true,
      staffProfileId: 'staff-1',
      loading: false,
    });

    await renderPage();

    expect(screen.getByRole('button', { name: 'Take it' })).toBeTruthy();
    expect(screen.queryByText('Needs cover')).toBeNull();
  });
});
