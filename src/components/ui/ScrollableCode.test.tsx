/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollableCode } from '@/components/ui/ScrollableCode';

afterEach(cleanup);

/**
 * The invitation link is the one string on these screens a keyboard user
 * genuinely cannot read otherwise. It is ~90 characters in a one-line mono box
 * beside a Copy button, so the token — the half that matters — is always off
 * the right edge, and a bare `<code>` cannot be scrolled without a pointer
 * (WCAG 2.2 Level A, 2.1.1; docs/SAAS.md GAP-070).
 *
 * Asserted on the component rather than on the four screens that use it: the
 * two platform console ones need a signed-in Super Admin and the other two sit
 * behind a modal, so a test at that level would cost four fixtures to check one
 * attribute set.
 */
describe('ScrollableCode', () => {
  it('is focusable so a keyboard can scroll to the end of the link', () => {
    render(
      <ScrollableCode label="Invitation link">https://example.test/x</ScrollableCode>,
    );

    const region = screen.getByRole('region', { name: 'Invitation link' });
    expect(region.getAttribute('tabindex')).toBe('0');
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('names the tab stop, so it is not an unlabelled mystery stop', () => {
    render(
      <ScrollableCode label="Invitation link for Northgate Care">
        https://example.test/x
      </ScrollableCode>,
    );

    expect(
      screen.getByRole('region', { name: 'Invitation link for Northgate Care' }),
    ).toBeTruthy();
  });
});
