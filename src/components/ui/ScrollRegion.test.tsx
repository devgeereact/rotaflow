/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

afterEach(cleanup);

/**
 * jsdom has no layout engine, so `ResizeObserver` is undefined and every
 * element reports `scrollWidth === clientWidth === 0`. Both are stubbed rather
 * than mocked away: the observer so the effect does not throw, and the two
 * widths so the overflow branch can be exercised at all. Without the second
 * stub `overflowing` is permanently false and the cue could be deleted without
 * a test noticing.
 */
class StubResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function setWidths(scroll: number, client: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => client,
  });
}

beforeAll(() => {
  globalThis.ResizeObserver = StubResizeObserver;
});

afterEach(() => {
  setWidths(0, 0);
});

/**
 * A horizontally scrolling area must be reachable by keyboard (WCAG 2.2 Level
 * A, 2.1.1) and must say what it is once it has become a tab stop.
 *
 * `DataTable` carries the same two assertions for its own container. They are
 * repeated here because `ScrollRegion` is the wrapper the rest of the app uses
 * — the charts' figures tables, the onboarding invite list, the platform
 * announcements register — and the two components do not share an
 * implementation, only a technique.
 */
describe('ScrollRegion', () => {
  it('is focusable so a keyboard can scroll it', () => {
    render(
      <ScrollRegion label="Attendance table">
        <p>rows</p>
      </ScrollRegion>,
    );

    const region = screen.getByRole('region', { name: 'Attendance table' });
    expect(region.getAttribute('tabindex')).toBe('0');
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('names the tab stop from the label, so it is not a mystery', () => {
    render(
      <ScrollRegion label="Report results">
        <p>rows</p>
      </ScrollRegion>,
    );

    expect(screen.getByRole('region', { name: 'Report results' })).toBeTruthy();
  });

  it('shows the overflow cue only when the content actually overflows', () => {
    setWidths(400, 400);
    const { unmount } = render(
      <ScrollRegion label="Timesheets">
        <p>rows</p>
      </ScrollRegion>,
    );
    expect(screen.queryByText(/scrolls sideways/i)).toBeNull();
    unmount();

    setWidths(900, 400);
    render(
      <ScrollRegion label="Timesheets">
        <p>rows</p>
      </ScrollRegion>,
    );
    expect(
      screen.getByText('Timesheets scrolls sideways for more columns.'),
    ).toBeTruthy();
  });

  it('puts an id on the outer element, so a disclosure can point aria-controls at it', () => {
    // `BarChart` and `TrendChart` toggle their figures table with a button
    // carrying `aria-controls`. That target has to be the whole region, cue
    // included, or the button claims to control something it does not.
    render(
      <ScrollRegion id="figures-1" label="Shifts per week">
        <p>rows</p>
      </ScrollRegion>,
    );

    const outer = document.getElementById('figures-1');
    expect(outer).not.toBeNull();
    expect(outer?.contains(screen.getByRole('region', { name: 'Shifts per week' }))).toBe(
      true,
    );
  });
});
