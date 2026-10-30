import { describe, expect, it } from 'vitest';
import {
  addDays,
  allowedActions,
  displayStatus,
  eligibilityOn,
  expiryState,
  localToday,
  requirementMetOn,
  statusTone,
  type Requirement,
} from '@/lib/compliance';

// The same cases as the PHP suite (backend/tests/suites/230-compliance.php), so the browser and the
// API cannot disagree about whether a document counts.

describe('expiryState', () => {
  it('is valid through the expiry date and expired the next day', () => {
    expect(expiryState(null, '2026-11-01')).toBe('none');
    expect(expiryState('2026-11-01', '2026-11-01')).toBe('expiring');
    expect(expiryState('2026-10-31', '2026-11-01')).toBe('expired');
  });

  it('calls anything within 30 days expiring', () => {
    expect(expiryState('2026-12-01', '2026-11-01')).toBe('expiring');
    expect(expiryState('2026-12-02', '2026-11-01')).toBe('valid');
  });
});

describe('displayStatus', () => {
  it('shows a live row past its date as expired, and leaves the rest alone', () => {
    expect(displayStatus('approved', '2026-11-10', '2026-11-10')).toBe('approved');
    expect(displayStatus('approved', '2026-11-10', '2026-11-11')).toBe('expired');
    expect(displayStatus('awaiting_review', '2026-11-10', '2026-11-11')).toBe('expired');
    expect(displayStatus('rejected', '2026-11-10', '2026-12-01')).toBe('rejected');
    expect(displayStatus('superseded', '2026-11-10', '2026-12-01')).toBe('superseded');
    expect(displayStatus('approved', null, '2099-01-01')).toBe('approved');
  });
});

describe('dates', () => {
  it('adds calendar days across the clock change and month ends', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('reads today in the organisation timezone, not the browser', () => {
    // 23:30 UTC on 24 October 2026 is already the 25th in London (BST); after the change it is not.
    expect(localToday('Europe/London', Date.UTC(2026, 9, 24, 23, 30))).toBe('2026-10-25');
    expect(localToday('Europe/London', Date.UTC(2026, 9, 25, 23, 30))).toBe('2026-10-25');
    expect(localToday('Pacific/Auckland', Date.UTC(2027, 2, 10, 11, 0))).toBe(
      '2027-03-11',
    );
  });

  it('falls back to UTC for a zone that does not exist', () => {
    expect(localToday('Not/AZone', Date.UTC(2026, 0, 1, 12))).toBe('2026-01-01');
  });
});

describe('eligibility', () => {
  const reqs: Requirement[] = [
    { type_id: 'a', name: 'Right to work check', state: 'approved', expires_at: null },
    { type_id: 'b', name: 'DBS check', state: 'expiring', expires_at: '2026-11-20' },
  ];

  it('is met by an approved or expiring requirement until its date', () => {
    expect(eligibilityOn(reqs, '2026-11-20')).toEqual({ ok: true, missing: [] });
    expect(eligibilityOn(reqs, '2026-11-21')).toEqual({
      ok: false,
      missing: ['DBS check'],
    });
  });

  it('never counts anything awaiting review, rejected, expired or missing', () => {
    for (const state of [
      'awaiting_review',
      'uploaded',
      'rejected',
      'expired',
      'missing',
    ] as const) {
      expect(
        requirementMetOn(
          { type_id: 'x', name: 'X', state, expires_at: null },
          '2026-11-01',
        ),
      ).toBe(false);
    }
  });

  it('is eligible with nothing required', () => {
    expect(eligibilityOn([], '2026-11-01')).toEqual({ ok: true, missing: [] });
  });
});

describe('actions and tones', () => {
  it('lets the person withdraw what has not been approved, and a manager an approved one', () => {
    expect(allowedActions({ stored_status: 'uploaded' }, false)).toEqual({
      submit: true,
      withdraw: true,
    });
    expect(allowedActions({ stored_status: 'approved' }, false)).toEqual({
      submit: false,
      withdraw: false,
    });
    expect(allowedActions({ stored_status: 'approved' }, true).withdraw).toBe(true);
    expect(allowedActions({ stored_status: 'superseded' }, true)).toEqual({
      submit: false,
      withdraw: false,
    });
  });

  it('colours by meaning', () => {
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('awaiting_review')).toBe('warning');
    expect(statusTone('expired')).toBe('danger');
    expect(statusTone('withdrawn')).toBe('neutral');
  });
});
