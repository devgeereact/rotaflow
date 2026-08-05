import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_GAPS,
  summariseNotifications,
  type NotificationRow,
} from '@/lib/platformNotifications';

const NOW = new Date('2026-08-05T09:00:00Z');

const row = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  org_id: 'org-1',
  channel: 'in_app',
  type: 'rota_published',
  read_at: null,
  created_at: '2026-08-04T09:00:00Z',
  ...overrides,
});

describe('summariseNotifications', () => {
  it('returns zeroes for an empty window rather than throwing', () => {
    expect(summariseNotifications([], NOW)).toEqual({
      total: 0,
      read: 0,
      unread: 0,
      recent: 0,
      organisations: 0,
      byChannel: [],
      byType: [],
    });
  });

  it('splits read from unread', () => {
    const summary = summariseNotifications(
      [row({ read_at: '2026-08-04T10:00:00Z' }), row(), row()],
      NOW,
    );
    expect(summary).toMatchObject({ total: 3, read: 1, unread: 2 });
  });

  it('counts distinct organisations, not rows', () => {
    const summary = summariseNotifications(
      [row({ org_id: 'a' }), row({ org_id: 'a' }), row({ org_id: 'b' })],
      NOW,
    );
    expect(summary.organisations).toBe(2);
  });

  it('counts the last seven calendar days as recent', () => {
    const summary = summariseNotifications(
      [
        row({ created_at: '2026-08-05T08:00:00Z' }),
        row({ created_at: '2026-07-29T08:00:00Z' }),
        row({ created_at: '2026-07-28T08:00:00Z' }),
      ],
      NOW,
    );
    expect(summary.recent).toBe(2);
  });

  it('ranks channels and types by volume', () => {
    const summary = summariseNotifications(
      [
        row({ channel: 'push', type: 'leave_decision' }),
        row({ channel: 'push', type: 'rota_published' }),
        row({ channel: 'in_app', type: 'rota_published' }),
        row({ channel: 'in_app', type: 'rota_published' }),
        row({ channel: 'in_app', type: 'rota_published' }),
      ],
      NOW,
    );
    expect(summary.byChannel).toEqual([
      { label: 'in_app', value: 3 },
      { label: 'push', value: 2 },
    ]);
    expect(summary.byType[0]).toEqual({ label: 'rota_published', value: 4 });
  });

  it('breaks a tie alphabetically so the order is stable between reads', () => {
    const summary = summariseNotifications(
      [row({ channel: 'zeta' }), row({ channel: 'alpha' })],
      NOW,
    );
    expect(summary.byChannel.map((c) => c.label)).toEqual(['alpha', 'zeta']);
  });

  it('folds a blank channel into Unknown rather than an empty label', () => {
    const summary = summariseNotifications([row({ channel: '  ' })], NOW);
    expect(summary.byChannel).toEqual([{ label: 'Unknown', value: 1 }]);
  });

  it('ignores an unparseable timestamp when counting recent', () => {
    const summary = summariseNotifications([row({ created_at: 'not-a-date' })], NOW);
    expect(summary.total).toBe(1);
    expect(summary.recent).toBe(0);
  });
});

describe('NOTIFICATION_GAPS', () => {
  it('explains every gap rather than only naming it', () => {
    expect(NOTIFICATION_GAPS.length).toBeGreaterThan(0);
    for (const gap of NOTIFICATION_GAPS) {
      expect(gap.title.length).toBeGreaterThan(0);
      expect(gap.detail.length).toBeGreaterThan(40);
    }
  });
});
