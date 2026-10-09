/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffDashboard } from '@/components/dashboard/StaffDashboard';
import type { DashboardOverview } from '@/services/dashboardService';

/**
 * The one property worth pinning here is that this component reads the clock it
 * is given and nothing else.
 *
 * It used to open with `overview.locations[0]?.timezone`, which was wrong twice.
 * It is neither the organisation's reporting zone nor the shift's, so an
 * organisation whose first site sits in another one read every shift an hour or
 * five out — and because it was the first line in the component, a `null`
 * `overview` became a crash before anything rendered at all (BUG-104: the whole
 * screen went to the error boundary on three of three loads, for every staff
 * member).
 *
 * `DashboardPage` had already resolved the reporting zone. Passing it in is what
 * makes both problems go away, so the assertion is that an overview carrying no
 * locations renders perfectly well.
 */
const EMPTY_OVERVIEW: DashboardOverview = {
  staff: [],
  locations: [],
  shiftTypes: [],
  announcements: [],
  compliancePercent: 0,
  monthShiftsByDate: new Map(),
  upcomingGroups: [],
};

function renderDashboard(timezone: string): void {
  render(
    <MemoryRouter>
      <StaffDashboard
        firstName="Sasha"
        overview={EMPTY_OVERVIEW}
        myWeek={{ hours: 0, shiftsBooked: 0 }}
        myUpcoming={[]}
        leaveRemaining={28}
        holidayAllowance={28}
        openSwaps={0}
        timezone={timezone}
      />
    </MemoryRouter>,
  );
}

describe('StaffDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 22:00 in London, which is 09:00 the next morning in Auckland. One
    // instant, two different greetings, so the assertions below can only pass
    // if the component reads the zone it was handed.
    vi.setSystemTime(new Date('2026-09-11T21:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders for an organisation with no locations at all', () => {
    renderDashboard('Europe/London');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Sasha');
  });

  it('greets on the organisation clock, not the browser one', () => {
    renderDashboard('Europe/London');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Good evening, Sasha',
    );
    cleanup();

    // Same instant, a different organisation clock, a different greeting. This
    // is what fails if anyone reintroduces a timezone derived inside the
    // component instead of the one the page resolved.
    renderDashboard('Pacific/Auckland');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Good morning, Sasha',
    );
  });
});
