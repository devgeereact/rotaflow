/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Tabs } from '@/components/ui/Tabs';

afterEach(cleanup);

const items = [
  { to: '/app/settings/organisation', label: 'Organisation' },
  { to: '/app/settings/billing', label: 'Billing' },
  { to: '/app/settings/roles', label: 'Roles', hidden: true },
];

/**
 * The tab strip is the one `overflow-x-auto` container in the sweep that gets
 * no tab stop, and that is a decision rather than an omission.
 *
 * Everything inside it is a link. A keyboard user reaches every tab by tabbing,
 * and the browser scrolls a focused element into view on its own, so the
 * off-screen tabs are already reachable — which is the condition axe's
 * `scrollable-region-focusable` and WCAG 2.1.1 actually test. Adding
 * `tabIndex={0}` to the `<ul>` would insert a stop in front of the links that
 * does nothing a user can perceive.
 *
 * This is here so that a later sweep for bare `overflow-x-auto` does not
 * "finish the job" by wrapping it.
 */
describe('Tabs overflow strip', () => {
  it('adds no scroll region of its own', () => {
    render(
      <MemoryRouter>
        <Tabs items={items} label="Settings sections" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelector('ul[tabindex]')).toBeNull();
  });

  it('reaches every visible tab through its own focusable content', () => {
    render(
      <MemoryRouter>
        <Tabs items={items} label="Settings sections" />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Organisation', 'Billing']);
    links[1]?.focus();
    expect(document.activeElement).toBe(links[1]);
  });
});
