/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from '@/components/ui/DataTable';

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

const columns = [{ key: 'name' as const, label: 'Name', cell: (r: Row) => r.name }];
const rows: Row[] = [
  { id: '1', name: 'Ada' },
  { id: '2', name: 'Grace' },
];

/**
 * The horizontal scroll container must be reachable by keyboard (WCAG 2.2
 * Level A, 2.1.1) and must say what it is once it becomes a tab stop.
 *
 * Every admin table scrolls sideways and none of them could be scrolled
 * without a pointer until 5 September 2026 (docs/SAAS.md GAP-070) — on a
 * narrow viewport that put whole columns out of reach, with no error and
 * nothing on screen to suggest anything was missing.
 *
 * Asserted here rather than in Playwright because the e2e suite's routes do
 * not render a `DataTable`: the admin overview's two tables are hand-rolled,
 * which is exactly how a browser check can pass while the component it was
 * meant to cover goes untested.
 */
describe('DataTable scroll region', () => {
  it('is focusable so a keyboard can scroll it', () => {
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Staff" />,
    );

    const region = screen.getByRole('region', { name: 'Staff' });
    expect(region.getAttribute('tabindex')).toBe('0');
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('takes its accessible name from the caption, so the tab stop is not a mystery', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Organisations on the platform"
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Organisations on the platform' }),
    ).toBeTruthy();
  });
});
