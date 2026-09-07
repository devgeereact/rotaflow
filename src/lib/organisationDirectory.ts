import {
  filterValue,
  filterValues,
  type FilterOption,
  type FilterState,
} from '@/lib/filters';
import type { OrganisationDirectoryQuery } from '@/services/platformDirectoryService';

/**
 * Turning the console's filter state into a directory query.
 *
 * Pure, and separate from the screen, for one reason: this is where a filter
 * silently stops being applied. A dimension the UI renders but the query
 * forgets looks exactly like a filter that matched everything, and no amount
 * of clicking through the console will show you the difference. It is asserted
 * in `organisationDirectory.test.ts` instead.
 */

/**
 * The creation windows the filter offers.
 *
 * A relative window rather than two date pickers, because the question a
 * platform administrator actually asks is "who signed up recently", and
 * because a relative value in a URL keeps meaning the same thing when the link
 * is opened next week — which two absolute dates would not.
 */
export const CREATED_WINDOWS: readonly FilterOption[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
] as const;

export interface CreatedBounds {
  /** Inclusive. */
  from: string | null;
  /** Exclusive, so a whole month is [1st, 1st of next). */
  to: string | null;
}

const DAY = 86_400_000;

/**
 * The instants a creation window covers.
 *
 * `to` is exclusive throughout. A half-open range is the only way to express
 * "the whole of last month" without either dropping the last millisecond of
 * the 31st or catching the first of this month, and both of those are the kind
 * of off-by-one that only shows up on a month boundary.
 *
 * Day arithmetic goes through `Date` component setters rather than adding
 * 86,400,000 milliseconds: this project runs its tests in Europe/London
 * precisely because a clock-change day is 23 or 25 hours long, and the fixed
 * addition is wrong twice a year.
 */
export function createdWindowBounds(window: string, now: Date): CreatedBounds {
  const startOfDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

  switch (window) {
    case '7d':
      return { from: new Date(now.getTime() - 7 * DAY).toISOString(), to: null };
    case '30d':
      return { from: new Date(now.getTime() - 30 * DAY).toISOString(), to: null };
    case '90d':
      return { from: new Date(now.getTime() - 90 * DAY).toISOString(), to: null };
    case 'this_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: null,
      };
    case 'last_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      };
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: null };
    default:
      // An unknown window is no window. A hand-edited or stale URL degrades to
      // the unfiltered view rather than to an empty table that reads as "this
      // deployment has no tenants".
      void startOfDay;
      return { from: null, to: null };
  }
}

export interface DirectoryViewState {
  sort: string;
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
  now?: Date;
}

/**
 * Every declared dimension, mapped to the argument the database expects.
 *
 * Dimension ids and RPC parameter names deliberately differ where the UI word
 * and the column word differ (`subscription` against `subscription_status`),
 * so this function is the single place the two vocabularies meet.
 */
export function organisationQueryFrom(
  filters: FilterState,
  view: DirectoryViewState,
): OrganisationDirectoryQuery {
  const many = (id: string): string[] | undefined => {
    const values = filterValues(filters, id);
    return values.length > 0 ? [...values] : undefined;
  };

  const created = createdWindowBounds(
    filterValue(filters, 'created'),
    view.now ?? new Date(),
  );

  return {
    search: filterValue(filters, 'q') || undefined,
    status: many('status'),
    plan: many('plan'),
    subscriptionStatus: many('subscription'),
    industry: many('industry'),
    health: many('health'),
    createdFrom: created.from,
    createdTo: created.to,
    sort: view.sort || 'created_at',
    direction: view.direction,
    page: view.page,
    pageSize: view.pageSize,
  };
}
