import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Local-live walk (31 Oct 2026): staff opening Announcements caused one 403 per announcement, because the service asked the
 * owner-and-manager `GET announcements/{a}/reads` first and fell back to the person's own receipts on the refusal. A caller
 * that knows the person is not a manager says so, and nothing is asked that the API will refuse.
 */
const get = vi.fn((path: string): Promise<unknown> => {
  if (path === '/orgs/org-1/announcements') {
    return Promise.resolve({
      announcements: [
        { id: 'a1', title: 'One', created_at: '2026-10-30 10:00:00', read_by_me: 1 },
        { id: 'a2', title: 'Two', created_at: '2026-10-29 10:00:00', read_by_me: 0 },
      ],
    });
  }
  if (path === '/me') return Promise.resolve({ user: { id: 'u-sam' } });
  if (path === '/orgs/org-1/staff') {
    return Promise.resolve({ staff: [{ id: 'sp-sam', user_id: 'u-sam' }] });
  }
  if (path.endsWith('/reads')) {
    return Promise.resolve({
      reads: [{ staff_profile_id: 'sp-x', read_at: '2026-10-30 11:00:00' }],
    });
  }
  return Promise.reject(new Error(`unexpected ${path}`));
});

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { get, post: vi.fn() } };
});

const { listAnnouncementReads } = await import('@/services/announcementService');

beforeEach(() => {
  get.mockClear();
});

describe('listAnnouncementReads', () => {
  it("for a person who is not a manager, reads only their own receipts and never asks for everyone's", async () => {
    const rows = await listAnnouncementReads('org-1', { everyone: false });
    expect(get.mock.calls.map((c) => c[0]).filter((p) => p.endsWith('/reads'))).toEqual(
      [],
    );
    expect(rows.map((r) => r.announcement_id)).toEqual(['a1']);
    expect(rows[0]?.staff_profile_id).toBe('sp-sam');
  });

  it('for a manager, reads every receipt', async () => {
    const rows = await listAnnouncementReads('org-1', { everyone: true });
    expect(rows).toHaveLength(2);
    expect(get.mock.calls.map((c) => c[0])).not.toContain('/me');
  });
});
