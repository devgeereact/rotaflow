/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverOverview, CoverShift } from '@/services/coverService';

// The Cover page (S12): dark while `cover_tools` is off; on, the manager's board turns a
// "cannot work" report into a cover request for that shift.
const flags = new Set<string>();
const getCoverOverview = vi.fn<() => Promise<CoverOverview>>();
const createCoverRequest = vi.fn<(b: Record<string, string>) => Promise<unknown>>();

vi.mock('@/hooks/useOrg', () => ({
  useOrg: () => ({ orgId: 'org-1', role: 'manager' }),
}));
vi.mock('@/hooks/useWorkMode', () => ({
  useWorkMode: () => ({
    mode: 'management',
    setMode: vi.fn(),
    canSwitch: false,
    staffProfileId: null,
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
vi.mock('@/services/coverService', () => ({
  COVER_FEATURE: 'cover_tools',
  getCoverOverview: () => getCoverOverview(),
  getCoverMine: vi.fn(),
  getCoverOpen: vi.fn(),
  getCandidates: vi.fn(),
  createCoverRequest: (b: Record<string, string>) => createCoverRequest(b),
  closeAbsence: vi.fn(),
  decideApplication: vi.fn(),
  cancelCoverRequest: vi.fn(),
  applyForCover: vi.fn(),
  assignCover: vi.fn(),
  reportAbsence: vi.fn(),
}));

const shift: CoverShift = {
  id: 'shift-1',
  rota_id: 'r1',
  location_id: 'l1',
  location_name: 'Ward A',
  shift_type: null,
  staff_profile_id: 'sam',
  starts_at: '2029-09-12T08:00:00Z',
  ends_at: '2029-09-12T16:00:00Z',
  break_minutes: 0,
  status: 'assigned',
  timezone: 'Europe/London',
  notes: null,
};
const board: CoverOverview = {
  counts: {
    open_requests: 0,
    unfilled_72h: 0,
    pending_applications: 0,
    open_absences: 1,
  },
  requests: [],
  applications: [],
  absences: [
    {
      id: 'abs-1',
      shift_id: 'shift-1',
      staff_profile_id: 'sam',
      reason: 'Childcare',
      status: 'open',
      created_at: '2029-09-01T08:00:00Z',
      name: 'Sam Ray',
      shift,
    },
  ],
  unfilled: [],
  history: [],
};

beforeAll(async () => {
  await import('./CoverPage');
}, 60_000);
beforeEach(() => {
  flags.clear();
  getCoverOverview.mockResolvedValue(board);
  createCoverRequest.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(): Promise<void> {
  const { CoverPage } = await import('./CoverPage');
  render(
    <MemoryRouter>
      <CoverPage />
    </MemoryRouter>,
  );
}

describe('the Cover page', () => {
  it('stays dark while the flag is off and asks the API nothing', async () => {
    await renderPage();
    expect(await screen.findByText('Cover is not switched on')).toBeTruthy();
    expect(getCoverOverview).not.toHaveBeenCalled();
  });

  it('turns a manager’s "cannot work" report into a cover request for that shift', async () => {
    flags.add('cover_tools');
    await renderPage();
    expect(await screen.findByText('Childcare')).toBeTruthy();
    expect(screen.getByText(/Sam Ray · Ward A, Wed 12 Sept? 09:00–17:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Find cover' }));
    await waitFor(() => {
      expect(createCoverRequest).toHaveBeenCalledWith({
        shift_id: 'shift-1',
        absence_id: 'abs-1',
      });
    });
  });
});
