/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The update toast is the one piece of UI that competes with unsaved work.
 *
 * It appears unprompted, on top of whatever the person is doing, and its
 * primary action throws away the page. Two properties therefore matter more
 * than anything visual, and neither is visible in review:
 *
 *   1. It has to announce itself. Until 2026-09-04 the container carried no
 *      `role` at all, so it entered the DOM in silence — a screen-reader user
 *      building a rota was never told a new version existed, and the only
 *      "update" they would ever experience is the app changing under them on
 *      some later reload. WCAG 2.2 AA 4.1.3.
 *
 *   2. Declining has to be possible, and has to mean "not now". Its only exits
 *      were Reload and navigating away, which for someone mid-form are the
 *      same exit. But a dismissal must not call `updateSW` and must not stop
 *      the hourly poll, or "not now" quietly becomes "never" — which is the
 *      failure this whole component exists to prevent.
 *
 * `virtual:pwa-register` is a build-time virtual module with no Node
 * implementation, so it is mocked here. That mock is also what lets the test
 * drive `onNeedRefresh` directly, which is otherwise only reachable by
 * installing a second service worker.
 */

const registerSW = vi.hoisted(() => vi.fn());

vi.mock('virtual:pwa-register', () => ({ registerSW }));

describe('UpdatePrompt', () => {
  beforeEach(() => {
    registerSW.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it('renders nothing until a new version is waiting', async () => {
    registerSW.mockReturnValue(vi.fn());
    const { UpdatePrompt } = await import('@/components/UpdatePrompt');

    const { container } = render(<UpdatePrompt />);

    expect(container.innerHTML).toBe('');
  });

  it('announces the new version as a polite status message', async () => {
    let notify: (() => void) | undefined;
    registerSW.mockImplementation((opts: { onNeedRefresh?: () => void }) => {
      notify = opts.onNeedRefresh;
      return vi.fn();
    });
    const { UpdatePrompt } = await import('@/components/UpdatePrompt');

    const { rerender } = render(<UpdatePrompt />);
    notify?.();
    rerender(<UpdatePrompt />);

    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('A new version is available.');
  });

  it('applies the update when Reload is pressed', async () => {
    const updateSW = vi.fn();
    let notify: (() => void) | undefined;
    registerSW.mockImplementation((opts: { onNeedRefresh?: () => void }) => {
      notify = opts.onNeedRefresh;
      return updateSW;
    });
    const { UpdatePrompt } = await import('@/components/UpdatePrompt');

    const { rerender } = render(<UpdatePrompt />);
    notify?.();
    rerender(<UpdatePrompt />);

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('hides on dismiss without applying the update', async () => {
    const updateSW = vi.fn();
    let notify: (() => void) | undefined;
    registerSW.mockImplementation((opts: { onNeedRefresh?: () => void }) => {
      notify = opts.onNeedRefresh;
      return updateSW;
    });
    const { UpdatePrompt } = await import('@/components/UpdatePrompt');

    const { rerender } = render(<UpdatePrompt />);
    notify?.();
    rerender(<UpdatePrompt />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the update notice' }),
    );

    expect(screen.queryByRole('status')).toBeNull();
    // The waiting worker stays waiting. Dismissing is "not now", not "never":
    // the next reload still lands on the new build.
    expect(updateSW).not.toHaveBeenCalled();
  });
});
