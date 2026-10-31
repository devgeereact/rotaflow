/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfferShiftModal } from '@/components/swaps/OfferShiftModal';
import { toSwapRow, type SwapMappingContext } from '@/lib/swapMapping';
import type { ShiftSwapWithShift } from '@/services/swapService';
import type { Shift, StaffProfile } from '@/types';

// S12d two-way swaps: the dialog and the rows change only when the page passes the options
// (the `two_way_swaps` and `cover_tools` flags); otherwise both are exactly as before.
afterEach(cleanup);

const myShift = {
  id: 'S1',
  org_id: 'O',
  starts_at: '2029-03-20T09:00:00Z',
  ends_at: '2029-03-20T17:00:00Z',
  location_id: null,
  staff_profile_id: 'me',
} as Shift;
const pat = { id: 'pat', first_name: 'Pat', last_name: 'Patel' } as StaffProfile;

function renderModal(onSubmit: (d: unknown) => void, exchange?: boolean): void {
  render(
    <OfferShiftModal
      open
      onClose={() => undefined}
      myShifts={[myShift]}
      colleagues={[pat]}
      submitting={false}
      offline={false}
      onSubmit={onSubmit}
      {...(exchange
        ? {
            exchangeShifts: [
              {
                id: 'T1',
                staff_profile_id: 'pat',
                starts_at: '2029-03-21T09:00:00Z',
                ends_at: '2029-03-21T17:00:00Z',
              },
            ],
          }
        : {})}
    />,
  );
}

describe('OfferShiftModal two-way', () => {
  it('has no "In return" field and submits the old draft without the options', () => {
    const onSubmit = vi.fn();
    renderModal(onSubmit);
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'S1' } });
    fireEvent.change(screen.getByLabelText('Offer to (optional)'), {
      target: { value: 'pat' },
    });
    expect(screen.queryByLabelText('In return (optional)')).toBeNull();
    fireEvent.click(screen.getByText('Post to the swap board'));
    expect(onSubmit).toHaveBeenCalledWith({ shiftId: 'S1', targetId: 'pat', note: '' });
  });

  it("asks for one of the named colleague's shifts in return", () => {
    const onSubmit = vi.fn();
    renderModal(onSubmit, true);
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'S1' } });
    expect(screen.queryByLabelText('In return (optional)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Offer to (optional)'), {
      target: { value: 'pat' },
    });
    fireEvent.change(screen.getByLabelText('In return (optional)'), {
      target: { value: 'T1' },
    });
    fireEvent.click(screen.getByText('Post to the swap board'));
    expect(onSubmit).toHaveBeenCalledWith({
      shiftId: 'S1',
      targetId: 'pat',
      note: '',
      takeShiftId: 'T1',
    });
  });
});

describe('toSwapRow two-way', () => {
  const ctx = {
    staffById: new Map(),
    locationsById: new Map(),
    userId: null,
    viewerStaffId: null,
    canApprove: true,
    swapApprovalRequired: true,
  } as unknown as SwapMappingContext;
  const base = {
    id: 'W',
    org_id: 'O',
    shift_id: 'S1',
    requested_by: 'me',
    target_staff_profile_id: 'pat',
    status: 'pending',
    note: null,
    created_at: '2029-03-19T09:00:00Z',
    shift: myShift,
  } as unknown as ShiftSwapWithShift;

  it('a one-way swap row has no takeShift key at all', () => {
    expect('takeShift' in toSwapRow(base, ctx)).toBe(false);
  });

  it('a two-way swap row carries the shift taken in return', () => {
    const row = toSwapRow(
      {
        ...base,
        take_shift: { ...myShift, id: 'T1', starts_at: '2029-03-21T09:00:00Z' },
      },
      ctx,
    );
    expect(row.takeShift?.dateLabel).toMatch(/21 Mar 2029/);
  });
});
