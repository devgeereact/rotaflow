/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMyCases = vi.fn();
const listCaseMessages = vi.fn();
const replyToCase = vi.fn();
const openSupportCase = vi.fn();
const rateCase = vi.fn();

vi.mock('@/services/supportCaseService', () => ({
  listMyCases: (...a: unknown[]): unknown => listMyCases(...a) as unknown,
  listCaseMessages: (...a: unknown[]): unknown => listCaseMessages(...a) as unknown,
  replyToCase: (...a: unknown[]): unknown => replyToCase(...a) as unknown,
  openSupportCase: (...a: unknown[]): unknown => openSupportCase(...a) as unknown,
  rateCase: (...a: unknown[]): unknown => rateCase(...a) as unknown,
}));
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('@/hooks/useOrg', () => ({
  useOrg: (): unknown => ({ orgId: 'org-1', orgName: 'Sunnyvale Care' }),
}));
vi.mock('@/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: (): unknown => ({ user: { id: 'user-1', email: 'sam@example.com' } }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: (): unknown => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

import { HelpPage } from '@/pages/app/HelpPage';

/**
 * The requester's half of a support case (docs/SAAS.md CAP-080, GAP-012).
 *
 * ## Why this screen earns a test
 *
 * Both things asserted here were wrong in a way nothing else could see.
 *
 * The first is BUG-066. This screen decided whether a message came from
 * support by testing `author_side === 'agent'`, and `0024`'s CHECK allows
 * `'customer'` and `'platform'` and nothing else — so the branch never fired
 * and every reply from the team was labelled with **that person's own full
 * name**, pulled from `profiles.full_name`. TypeScript cannot catch it:
 * `author_side` is `string` in the generated types, so comparing it to a value
 * the column can never hold is a legal comparison that is simply always false.
 * A test that reads the rendered label is the only thing that does.
 *
 * The second is the reply box's one gate. `reply_to_support_case` would accept
 * a reply on a closed case; the product must not offer one, because a closed
 * case is the single state where nobody is watching the queue and the message
 * would be taken and stranded. Resolved is deliberately different — "this is
 * not fixed" is the reply that matters most and has to arrive before the case
 * closes for good. That distinction lives nowhere but this component.
 *
 * No `@testing-library/jest-dom`: this repository does without it on purpose.
 */

afterEach(() => {
  cleanup();
  listMyCases.mockReset();
  listCaseMessages.mockReset();
  replyToCase.mockReset();
});

const supportCase = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'case-1',
  reference: 'SC-0001',
  subject: 'Rota will not publish',
  status: 'open',
  resolved_at: null,
  csat: null,
  ...over,
});

async function openTheCase(): Promise<void> {
  render(<HelpPage />);
  const row = await screen.findByText('Rota will not publish');
  fireEvent.click(row);
  await waitFor(() => expect(listCaseMessages).toHaveBeenCalledWith('case-1'));
}

describe('HelpPage — the requester’s view of their own case', () => {
  it('labels a platform reply "Support", never the agent’s own name', async () => {
    listMyCases.mockResolvedValue([supportCase()]);
    listCaseMessages.mockResolvedValue([
      {
        id: 'm-1',
        author_side: 'platform',
        author_name: 'Priya Raman',
        body: 'We have reproduced this.',
        created_at: '2026-08-31T09:00:00.000Z',
      },
    ]);

    await openTheCase();

    // Anchored: "Contact support" and the page heading both contain the word,
    // and a loose match would pass on either of them without the label being
    // rendered at all.
    expect(await screen.findByText(/^Support · /)).toBeTruthy();
    // The agent is a real person who did not consent to being named at a
    // customer. This is the assertion BUG-066 would have failed.
    expect(screen.queryByText(/Priya Raman/)).toBeNull();
  });

  it('offers a reply box on an open case and sends the reply', async () => {
    listMyCases.mockResolvedValue([supportCase()]);
    listCaseMessages.mockResolvedValue([]);
    replyToCase.mockResolvedValue(undefined);

    await openTheCase();

    const box = screen.getByLabelText('Reply to support');
    fireEvent.change(box, { target: { value: 'Still happening this morning.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() =>
      expect(replyToCase).toHaveBeenCalledWith('case-1', 'Still happening this morning.'),
    );
    // Re-read rather than appended: the row is stamped and named by the
    // database, so a locally-built one would be the only message in the
    // thread whose author and time this screen guessed.
    await waitFor(() => expect(listCaseMessages).toHaveBeenCalledTimes(2));
  });

  it('still offers a reply on a resolved case, because "this is not fixed" is the one that matters', async () => {
    listMyCases.mockResolvedValue([
      supportCase({ status: 'resolved', resolved_at: '2026-08-31T10:00:00.000Z' }),
    ]);
    listCaseMessages.mockResolvedValue([]);

    await openTheCase();

    expect(screen.getByLabelText('Reply to support')).toBeTruthy();
  });

  it('offers no reply box on a closed case, where nobody is watching the queue', async () => {
    listMyCases.mockResolvedValue([
      supportCase({ status: 'closed', resolved_at: '2026-08-30T10:00:00.000Z' }),
    ]);
    listCaseMessages.mockResolvedValue([]);

    await openTheCase();

    expect(screen.queryByLabelText('Reply to support')).toBeNull();
  });
});
