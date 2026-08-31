/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailedWritesNotice } from '@/components/FailedWritesNotice';
import type { DeadLetterRecord } from '@/lib/offlineOutbox';

/**
 * The first component test in this repository (docs/SAAS.md CAP-100).
 *
 * ## Why this component, first
 *
 * It is the one whose *wording* is load-bearing. Everything else in the
 * offline stack can be tested as pure logic — what got queued, what got
 * retried, what got set aside — but the thing that decides whether a carer
 * understands they are not actually clocked in is a sentence on a screen, and
 * which sentence they get depends on a branch (`actionFailed`).
 *
 * Getting that branch wrong is not cosmetic. Telling a manager "these did not
 * happen, do them again" about a *notification* failure sends them off to
 * republish a rota that is already live. Telling a carer their clock-in is
 * merely "unsynced" leaves them believing they are clocked in when no row
 * exists. Those are the two mistakes, and they point in opposite directions,
 * so a test that only asserted "an alert rendered" would catch neither.
 *
 * ## Why jsdom is per-file
 *
 * `vitest.config.ts` stays on the node environment. Making 700 pure tests
 * construct a DOM they never touch would slow the suite for the sake of the
 * handful that need one, so the docblock above opts this file in alone.
 */

const record = (over: Partial<DeadLetterRecord> = {}): DeadLetterRecord => ({
  id: 'dl-1',
  kind: 'clock',
  payload: {},
  queuedAt: '2027-03-04T09:00:00.000Z',
  attempts: 5,
  failedAt: '2027-03-04T09:05:00.000Z',
  reason: 'exhausted',
  ...over,
});

// Explicit, because this suite does not run with `globals: true` — without
// it React Testing Library's automatic cleanup never registers, every render
// accumulates in the same document, and `getByText` starts finding the
// previous test's markup. The failures look like assertion bugs and are not.
afterEach(cleanup);

describe('FailedWritesNotice', () => {
  it('renders nothing when there is nothing to say', () => {
    // An empty alert region is not neutral: screen readers announce the
    // landmark, and a permanently-present "problems" box is one people learn
    // to stop reading.
    const { container } = render(<FailedWritesNotice items={[]} onDiscard={vi.fn()} />);
    // `innerHTML`, not jest-dom's `toBeEmptyDOMElement`: that matcher needs
    // `@testing-library/jest-dom`, and one assertion is not worth another
    // dependency in the bundle's dev tree.
    expect(container.innerHTML).toBe('');
  });

  it('tells someone plainly that a clock-in did NOT happen', () => {
    render(<FailedWritesNotice items={[record()]} onDiscard={vi.fn()} />);

    // The wording that matters. "Sync error" would be true and useless; the
    // person tapped Clock in and believes they are clocked in.
    // The sentence is split across a <strong>, so the match is on the
    // paragraph's whole text rather than on a text node.
    expect(screen.getByRole('heading', { name: /didn't save/i })).toBeDefined();
    expect(
      screen.getByText(/they did not happen/i, { selector: 'strong' }),
    ).toBeDefined();
  });

  it('says the opposite for a notification, because the write DID land', () => {
    render(
      <FailedWritesNotice items={[record({ kind: 'notify' })]} onDiscard={vi.fn()} />,
    );

    // A rota cannot be published offline, so a dead-lettered `notify` means
    // the publish landed and only the announcement failed. "Do it again" here
    // would send a manager to republish a live rota.
    expect(
      screen.getByText(/your change was saved/i, { selector: 'strong' }),
    ).toBeDefined();
    expect(screen.queryByText(/they did not happen/i, { selector: 'strong' })).toBeNull();
  });

  it('separates the two kinds rather than lumping them together', () => {
    render(
      <FailedWritesNotice
        items={[record(), record({ id: 'dl-2', kind: 'notify' })]}
        onDiscard={vi.fn()}
      />,
    );

    // Both messages, in their own regions. The whole reason the component is
    // split is that one sentence cannot serve both.
    expect(
      screen.getByText(/they did not happen/i, { selector: 'strong' }),
    ).toBeDefined();
    expect(
      screen.getByText(/your change was saved/i, { selector: 'strong' }),
    ).toBeDefined();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('offers Try again only when a retry handler is given', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <FailedWritesNotice items={[record()]} onDiscard={vi.fn()} />,
    );
    // No handler, no button — better than one that does nothing.
    expect(screen.queryByRole('button', { name: /try the/i })).toBeNull();

    rerender(
      <FailedWritesNotice items={[record()]} onDiscard={vi.fn()} onRetry={onRetry} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /try the/i }));
    expect(onRetry).toHaveBeenCalledWith('dl-1');
  });

  it('discards the item it was asked to, not merely something', async () => {
    const onDiscard = vi.fn();
    render(
      <FailedWritesNotice
        items={[record(), record({ id: 'dl-2', queuedAt: '2027-03-04T11:00:00.000Z' })]}
        onDiscard={onDiscard}
      />,
    );

    const rows = within(screen.getAllByRole('alert')[0] as HTMLElement).getAllByRole(
      'listitem',
    );
    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: /dismiss/i }),
    );
    expect(onDiscard).toHaveBeenCalledWith('dl-2');
  });

  it('labels its buttons with the item they act on', () => {
    // Two identical "Dismiss" buttons are indistinguishable to a screen
    // reader, and dismissing the wrong failed clock-in loses the one that
    // mattered.
    render(
      <FailedWritesNotice
        items={[record(), record({ id: 'dl-2', queuedAt: '2027-03-04T11:00:00.000Z' })]}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
