import { describe, expect, it } from 'vitest';
import {
  averageCsat,
  awaitingFirstResponse,
  csatResponses,
  formatMinutes,
  isOpen,
  medianFirstResponseMinutes,
  medianResolutionMinutes,
  openByPriority,
  openCases,
  urgentOpenCases,
  type CaseLike,
} from '@/lib/supportMetrics';

function kase(over: Partial<CaseLike> = {}): CaseLike {
  return {
    status: 'open',
    priority: 'normal',
    created_at: '2026-08-04T09:00:00Z',
    first_response_at: '2026-08-04T09:30:00Z',
    resolved_at: null,
    csat: null,
    ...over,
  };
}

describe('isOpen', () => {
  it('treats resolved and closed as not open', () => {
    expect(isOpen('open')).toBe(true);
    expect(isOpen('pending')).toBe(true);
    expect(isOpen('on_hold')).toBe(true);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('closed')).toBe(false);
  });
});

describe('queue counts', () => {
  const rows = [
    kase({ priority: 'urgent', first_response_at: null }),
    kase({ priority: 'high' }),
    kase({ status: 'resolved', priority: 'urgent', resolved_at: '2026-08-04T12:00:00Z' }),
  ];

  it('counts open cases', () => {
    expect(openCases(rows)).toBe(2);
  });

  it('counts urgent cases that are still open', () => {
    expect(urgentOpenCases(rows)).toBe(1);
  });

  it('counts open cases nobody has replied to', () => {
    expect(awaitingFirstResponse(rows)).toBe(1);
  });

  it('reports the queue by priority in severity order', () => {
    expect(openByPriority(rows)).toEqual([
      { priority: 'urgent', count: 1 },
      { priority: 'high', count: 1 },
      { priority: 'normal', count: 0 },
      { priority: 'low', count: 0 },
    ]);
  });
});

describe('medianFirstResponseMinutes', () => {
  it('is the middle value, not the mean', () => {
    const rows = [
      kase({ first_response_at: '2026-08-04T09:10:00Z' }),
      kase({ first_response_at: '2026-08-04T09:20:00Z' }),
      // One case that sat over a weekend. A mean would report over five hours.
      kase({ first_response_at: '2026-08-04T24:00:00Z' }),
    ];
    expect(medianFirstResponseMinutes(rows)).toBe(20);
  });

  it('ignores cases nobody has answered', () => {
    expect(
      medianFirstResponseMinutes([
        kase({ first_response_at: '2026-08-04T09:15:00Z' }),
        kase({ first_response_at: null }),
      ]),
    ).toBe(15);
  });

  it('is null when nothing has been answered', () => {
    expect(medianFirstResponseMinutes([kase({ first_response_at: null })])).toBeNull();
  });
});

describe('medianResolutionMinutes', () => {
  it('measures from arrival to resolution', () => {
    expect(
      medianResolutionMinutes([
        kase({ status: 'resolved', resolved_at: '2026-08-04T11:00:00Z' }),
      ]),
    ).toBe(120);
  });
});

describe('csat', () => {
  it('averages the ratings to one decimal', () => {
    expect(averageCsat([kase({ csat: 5 }), kase({ csat: 4 }), kase({ csat: 5 })])).toBe(
      4.7,
    );
  });

  it('counts how many people answered', () => {
    expect(csatResponses([kase({ csat: 5 }), kase({ csat: null })])).toBe(1);
  });

  it('is null when nobody rated anything', () => {
    expect(averageCsat([kase()])).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('uses minutes under an hour', () => {
    expect(formatMinutes(35)).toBe('35m');
  });

  it('uses hours and minutes under a day', () => {
    expect(formatMinutes(134)).toBe('2h 14m');
  });

  it('switches to days above 24 hours', () => {
    expect(formatMinutes(2280)).toBe('1d 14h');
  });

  it('drops a zero remainder', () => {
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(2880)).toBe('2d');
  });

  it('is an em dash when there is nothing to measure', () => {
    expect(formatMinutes(null)).toBe('—');
  });
});
