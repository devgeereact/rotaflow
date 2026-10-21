import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_IDLE_DAYS, calendarFeedState } from './calendarFeed';

/**
 * GAP-052. The account screen must agree with the feed reader about which
 * tokens still work, or it offers to copy a link that returns an empty
 * calendar. The reader is `calendar_feed_shifts` in `0158`.
 */
describe('calendarFeedState', () => {
  const now = new Date('2027-03-31T12:00:00Z');

  it('is none without a live row', () => {
    expect(calendarFeedState(null, now)).toEqual({ kind: 'none' });
  });

  it('is live while a calendar keeps reading it', () => {
    expect(
      calendarFeedState(
        {
          token: 't',
          created_at: '2026-01-01T00:00:00Z',
          last_used_at: '2027-03-30T08:00:00Z',
        },
        now,
      ),
    ).toEqual({ kind: 'live', token: 't', lastUsedAt: '2027-03-30T08:00:00Z' });
  });

  it('counts from issue when no calendar has read it yet', () => {
    const fresh = { token: 't', created_at: '2027-03-01T00:00:00Z', last_used_at: null };
    expect(calendarFeedState(fresh, now).kind).toBe('live');

    const forgotten = {
      token: 't',
      created_at: '2026-12-01T00:00:00Z',
      last_used_at: null,
    };
    expect(calendarFeedState(forgotten, now).kind).toBe('idle');
  });

  it('turns idle just past 90 days of elapsed time, not before', () => {
    const at = (ms: number): string => new Date(now.getTime() - ms).toISOString();
    const day = 24 * 60 * 60 * 1000;
    const within = {
      token: 't',
      created_at: at(400 * day),
      last_used_at: at(90 * day - 1000),
    };
    const beyond = {
      token: 't',
      created_at: at(400 * day),
      last_used_at: at(90 * day + 1000),
    };
    expect(calendarFeedState(within, now).kind).toBe('live');
    expect(calendarFeedState(beyond, now).kind).toBe('idle');
  });

  it('treats an unreadable timestamp as idle rather than live', () => {
    expect(
      calendarFeedState({ token: 't', created_at: 'not a date', last_used_at: null }, now)
        .kind,
    ).toBe('idle');
  });

  it('uses the same 90 days as the feed reader in 0158', () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        '../../supabase/migrations/0158_a_calendar_feed_is_bounded.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(`interval '${FEED_IDLE_DAYS} days'`);
  });
});
