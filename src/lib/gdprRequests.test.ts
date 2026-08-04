import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysUntil,
  deadlineState,
  effectiveDueDate,
  extendedDueDate,
  formatDeadline,
  isClosed,
  statutoryDueDate,
  todayIso,
  type GdprRequestStatus,
} from '@/lib/gdprRequests';

describe('addMonths — calendar arithmetic, not 30 days', () => {
  it('adds a plain month', () => {
    expect(addMonths('2026-03-10', 1)).toBe('2026-04-10');
  });

  it('clamps 31 January to the end of February', () => {
    // The case that makes "+30 days" wrong: 31 Jan + 30 days is 2 March, which
    // would silently grant two extra days of statutory deadline.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps to 29 February in a leap year', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('clamps a 31-day month onto a 30-day one', () => {
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('rolls the year over', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('adds two months for the extension path', () => {
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(addMonths('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('statutory deadlines', () => {
  it('is one month from receipt', () => {
    expect(statutoryDueDate('2026-08-04')).toBe('2026-09-04');
  });

  it('extends by two further months from the original due date', () => {
    expect(extendedDueDate('2026-09-04')).toBe('2026-11-04');
  });

  it('uses the extension once granted, and the original before that', () => {
    expect(effectiveDueDate({ dueOn: '2026-09-04', extendedTo: null })).toBe(
      '2026-09-04',
    );
    expect(effectiveDueDate({ dueOn: '2026-09-04', extendedTo: '2026-11-04' })).toBe(
      '2026-11-04',
    );
  });
});

describe('daysUntil', () => {
  it('counts forward', () => {
    expect(daysUntil('2026-08-11', '2026-08-04')).toBe(7);
  });

  it('goes negative once past', () => {
    expect(daysUntil('2026-08-01', '2026-08-04')).toBe(-3);
  });

  it('is zero on the day itself', () => {
    expect(daysUntil('2026-08-04', '2026-08-04')).toBe(0);
  });

  it('crosses a British Summer Time boundary without drifting', () => {
    // BST ends 25 October 2026. Millisecond arithmetic on local dates loses or
    // gains an hour here, which rounds to a whole day at the wrong moment.
    expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2);
    expect(daysUntil('2026-11-01', '2026-10-25')).toBe(7);
  });

  it('crosses a leap day correctly', () => {
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
  });
});

describe('deadlineState', () => {
  const open = { dueOn: '2026-08-20', extendedTo: null, status: 'received' as const };

  it('is closed for a completed or refused request, whatever the date', () => {
    for (const status of ['completed', 'refused'] as GdprRequestStatus[]) {
      expect(deadlineState({ ...open, status, dueOn: '2020-01-01' }, '2026-08-04')).toBe(
        'closed',
      );
    }
  });

  it('is overdue past the deadline', () => {
    expect(deadlineState(open, '2026-08-21')).toBe('overdue');
  });

  it('is due_soon within seven days, inclusive', () => {
    expect(deadlineState(open, '2026-08-13')).toBe('due_soon');
    expect(deadlineState(open, '2026-08-20')).toBe('due_soon');
  });

  it('is on_track with more than seven days', () => {
    expect(deadlineState(open, '2026-08-12')).toBe('on_track');
  });

  it('respects a granted extension', () => {
    const extended = { ...open, extendedTo: '2026-10-20' };
    expect(deadlineState(open, '2026-08-25')).toBe('overdue');
    expect(deadlineState(extended, '2026-08-25')).toBe('on_track');
  });
});

describe('formatDeadline', () => {
  const open = { dueOn: '2026-08-20', extendedTo: null, status: 'received' as const };

  it('says closed for a closed request', () => {
    expect(formatDeadline({ ...open, status: 'completed' }, '2026-08-04')).toBe('Closed');
  });

  it('counts down, singular and plural', () => {
    expect(formatDeadline(open, '2026-08-19')).toBe('1 day left');
    expect(formatDeadline(open, '2026-08-13')).toBe('7 days left');
  });

  it('calls out the day itself', () => {
    expect(formatDeadline(open, '2026-08-20')).toBe('Due today');
  });

  it('states how far past, singular and plural', () => {
    expect(formatDeadline(open, '2026-08-21')).toBe('Overdue by 1 day');
    expect(formatDeadline(open, '2026-08-24')).toBe('Overdue by 4 days');
  });
});

describe('isClosed', () => {
  it('treats only completed and refused as closed', () => {
    expect(isClosed('completed')).toBe(true);
    expect(isClosed('refused')).toBe(true);
    expect(isClosed('received')).toBe(false);
    expect(isClosed('in_progress')).toBe(false);
    expect(isClosed('awaiting_information')).toBe(false);
  });
});

describe('todayIso', () => {
  it('formats a local date without shifting it through UTC', () => {
    // 23:30 local on 4 August is still 4 August. toISOString() would report
    // the 5th for anywhere east of UTC, which is a whole day of deadline.
    expect(todayIso(new Date(2026, 7, 4, 23, 30))).toBe('2026-08-04');
    expect(todayIso(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01');
  });
});
