/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssignShiftModal } from '@/components/rota/AssignShiftModal';
import { PublishCheckModal } from '@/components/rota/PublishCheckModal';
import type { PublishPreview } from '@/services/schedulingService';
import type { Rota } from '@/types';

/**
 * Scheduling tools (slice S11) on the screen. Two things are worth a component test:
 *
 * 1. With the module off the assign dialog is exactly what it was. `warningsFor` is absent and
 *    no panel appears; with it, the warnings show and Save stays available (warnings never block).
 * 2. The publish preview stops at a double-booking and lets warnings through.
 */

const getPublishPreview = vi.fn<(id: string) => Promise<PublishPreview>>();
vi.mock('@/services/schedulingService', () => ({
  getPublishPreview: (id: string) => getPublishPreview(id),
}));

afterEach(() => {
  cleanup();
  getPublishPreview.mockReset();
});

const base = {
  open: true,
  onClose: vi.fn(),
  staff: [],
  shiftTypes: [],
  locations: [],
  dates: ['2026-11-02'],
  timezone: 'Europe/London',
  context: { staffProfileId: null, date: '2026-11-02', locationId: 'l1' },
  onSave: vi.fn(() => Promise.resolve()),
};

describe('assign dialog warnings', () => {
  it('shows nothing extra while the module is off', () => {
    render(<AssignShiftModal {...base} />);
    expect(screen.queryByText(/to check/)).toBeNull();
  });

  it('lists the warnings and still lets the manager save', () => {
    render(
      <AssignShiftModal
        {...base}
        warningsFor={() => [
          {
            code: 'rest',
            message: 'Only 7h rest before this shift (minimum 11h in any 24 hours)',
          },
        ]}
      />,
    );
    expect(screen.getByText('One thing to check')).toBeTruthy();
    expect(screen.getByText(/Only 7h rest/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Add shift' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});

const rota = {
  id: 'r1',
  name: 'Week of 2 Nov',
  period_start: '2026-11-02',
  period_end: '2026-11-08',
  location_id: 'l1',
} as Rota;

const shift = {
  id: 's1',
  staff_profile_id: 'p1',
  location_id: 'l1',
  starts_at: '2026-11-03T06:00:00Z',
  ends_at: '2026-11-03T14:00:00Z',
  break_minutes: 0,
  status: 'assigned',
};

function preview(o: Partial<PublishPreview> = {}): PublishPreview {
  return {
    rota: { ...rota, supersedes_rota_id: null },
    limits: { min_rest_hours: 11, max_weekly_hours: 48 },
    shifts: [
      {
        ...shift,
        change: 'new',
        warnings: [{ code: 'rest', message: 'Only 7h rest before this shift' }],
      },
    ],
    removed: [],
    total: 1,
    truncated: false,
    counts: { new: 1, unchanged: 0, cancelled: 0, removed: 0 },
    with_warnings: 1,
    warnings_by_code: { rest: 1 },
    overlaps: [],
    can_publish: true,
    ...o,
  };
}

function renderPreview(onPublish = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <PublishCheckModal
      open
      onClose={vi.fn()}
      rotas={[rota]}
      staffName={() => 'Sam Smith'}
      timezoneOf={() => 'Europe/London'}
      publishing={false}
      onPublish={onPublish}
    />,
  );
  return onPublish;
}

describe('publish preview', () => {
  it('lets warnings through: "Publish anyway"', async () => {
    getPublishPreview.mockResolvedValue(preview());
    renderPreview();
    const button = await screen.findByRole('button', { name: 'Publish anyway' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/1 short rest/)).toBeTruthy();
    expect(screen.getByText(/Tue 3 Nov 06:00–14:00/)).toBeTruthy();
    expect(getPublishPreview).toHaveBeenCalledWith('r1');
  });

  it('stops at a double-booking', async () => {
    getPublishPreview.mockResolvedValue(
      preview({
        can_publish: false,
        overlaps: [
          {
            staff_profile_id: 'p1',
            shift,
            other: {
              ...shift,
              id: 's2',
              starts_at: '2026-11-03T12:00:00Z',
              ends_at: '2026-11-03T16:00:00Z',
              rota_id: 'r1',
            },
          },
        ],
      }),
    );
    renderPreview();
    await screen.findByText(/booked in two places at once/);
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Publish anyway' });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
