/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  API_BASE_URL: '/api',
  api: { get, post },
  orgPath: (orgId: string, p: string) => `/orgs/${orgId}${p}`,
}));

import {
  getMyCalendarFeed,
  issueMyCalendarFeedToken,
} from '@/services/calendarFeedService';

/**
 * Security audit 1 Nov 2026: the kept link was keyed by organisation only, so on a shared device the next person
 * to open the page was shown the previous person's private feed link. It is now tied to the feed's created_at.
 */
describe('calendar feed link kept on this device', () => {
  afterEach(() => {
    window.localStorage.clear();
    get.mockReset();
    post.mockReset();
  });

  it('shows the kept link for the feed it was issued for', async () => {
    post.mockResolvedValue({ token: 'tok-amara', created_at: '2026-11-01T10:00:00Z' });
    await issueMyCalendarFeedToken('org-1');
    get.mockResolvedValue({
      active: true,
      created_at: '2026-11-01T10:00:00Z',
      last_used_at: null,
    });
    expect((await getMyCalendarFeed('org-1'))?.token).toBe('tok-amara');
  });

  it("never shows another person's kept link for this organisation", async () => {
    post.mockResolvedValue({ token: 'tok-amara', created_at: '2026-11-01T10:00:00Z' });
    await issueMyCalendarFeedToken('org-1');
    // A different person signs in on the same device; their own feed was issued elsewhere.
    get.mockResolvedValue({
      active: true,
      created_at: '2026-10-20T08:30:00Z',
      last_used_at: null,
    });
    expect((await getMyCalendarFeed('org-1'))?.token).toBe('');
  });

  it('ignores a link kept in the old plain-text form', async () => {
    window.localStorage.setItem('rotaflow:calendarFeed:org-1', 'tok-old');
    get.mockResolvedValue({
      active: true,
      created_at: '2026-10-20T08:30:00Z',
      last_used_at: null,
    });
    expect((await getMyCalendarFeed('org-1'))?.token).toBe('');
  });
});
