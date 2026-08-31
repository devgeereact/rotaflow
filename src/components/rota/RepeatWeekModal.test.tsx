/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepeatWeekModal } from '@/components/rota/RepeatWeekModal';

/**
 * Repeating a week (docs/SAAS.md CAP-006, CAP-100).
 *
 * ## Why this one is worth a component test
 *
 * It collects the only number in the feature, and the number decides how many
 * hundreds of rows get written. The database refuses anything outside 1–26,
 * so a UI that let the click through would produce an error message instead of
 * a rota — and one that let a non-integer through ("4.5 weeks") would send a
 * value the function rejects for a reason nobody would guess from the wording.
 *
 * The other half is why the modal exists at all: `window.prompt` blocks the
 * event loop and a Playwright run walks straight into it, which is why
 * `ConfirmContext` replaced the native dialog in the first place. A test that
 * renders and types is only possible because it is a real component.
 *
 * No `@testing-library/jest-dom` — this repository deliberately does without
 * it (see `FailedWritesNotice.test.tsx`), so the assertions read a value or
 * an attribute rather than using a matcher that would need a dependency.
 */

afterEach(cleanup);

describe('RepeatWeekModal', () => {
  it('offers a sensible default rather than an empty box', () => {
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy={false} />);
    const input = screen.getByLabelText<HTMLInputElement>('How many weeks');
    expect(input.value).toBe('4');
  });

  it('confirms with the number as a number, not a string', async () => {
    const onConfirm = vi.fn();
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={onConfirm} busy={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Repeat' }));
    expect(onConfirm).toHaveBeenCalledWith(4);
  });

  it('refuses more than the database will accept, and says the limit', async () => {
    // 26 weeks is half a year. Letting the click through would produce an
    // error message where a rota was expected.
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy={false} />);

    const input = screen.getByLabelText('How many weeks');
    await userEvent.clear(input);
    await userEvent.type(input, '200');

    expect(screen.getByRole('alert').textContent).toContain('between 1 and 26');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Repeat' }).disabled,
    ).toBe(true);
  });

  it('refuses a fraction of a week', async () => {
    // "4.5 weeks" would reach a function that rejects it for a reason nobody
    // could guess from the wording.
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy={false} />);

    const input = screen.getByLabelText('How many weeks');
    await userEvent.clear(input);
    await userEvent.type(input, '4.5');

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Repeat' }).disabled,
    ).toBe(true);
  });

  it('refuses zero', async () => {
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy={false} />);

    const input = screen.getByLabelText('How many weeks');
    await userEvent.clear(input);
    await userEvent.type(input, '0');

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Repeat' }).disabled,
    ).toBe(true);
  });

  it('says what will be left alone, before anything is written', () => {
    // The manager has to know this BEFORE clicking, not from a toast
    // afterwards: a week that was skipped is a week still uncovered.
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy={false} />);
    expect(
      screen.getByText(/already published, or whose draft somebody has started/i),
    ).toBeDefined();
  });

  it('cannot be double-submitted while it is working', () => {
    render(<RepeatWeekModal open onClose={vi.fn()} onConfirm={vi.fn()} busy />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Repeating…' }).disabled,
    ).toBe(true);
  });
});
