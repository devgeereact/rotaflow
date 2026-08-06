import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';

/**
 * Shared frame for every `/admin/*` screen: title, one-line purpose, and the
 * three states each of them needs. Written once here so the console's screens
 * cannot drift into several different spellings of "Loading…".
 *
 * Since the console's expansion these delegate to the shared primitives in
 * `components/ui` rather than reimplementing them. The admin area had grown its
 * own private loading, empty and metric states, which is how it ended up with
 * no skeletons, no pagination and a heading that bypassed `PageHeader` while
 * the tenant app had all three. The frame stays. The console genuinely has a
 * different page shape, but nothing inside it is admin-specific any more.
 */
export function AdminPage({
  title,
  description,
  action,
  avatar,
  meta,
  children,
}: {
  title: string;
  /** Optional on a detail screen, which carries `meta` instead. */
  description?: string;
  action?: ReactNode;
  /** Identity mark for a detail screen. See {@link PageHeader}. */
  avatar?: ReactNode;
  /** Identifier, plan, status and dates for a detail screen. */
  meta?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  // No width cap here any more: `AdminShell`'s `<main>` carries the console's
  // 1440px measure, and two caps meant the outer one silently won while the
  // inner one looked authoritative.
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={action}
        avatar={avatar}
        meta={meta}
      />
      {children}
    </div>
  );
}

/**
 * Whole-panel wait.
 *
 * A skeleton rather than the word "Loading…": these screens resolve into
 * tables of a known shape, and a one-line placeholder that becomes a
 * forty-row table makes the page jump every time (audit01 P2-2).
 */
export function AdminLoading({
  variant = 'table',
  rows = 6,
}: {
  variant?: 'table' | 'tiles' | 'card' | 'text';
  rows?: number;
} = {}): JSX.Element {
  return (
    <Card className="p-4">
      <LoadingState variant={variant} rows={rows} label="Loading platform data…" />
    </Card>
  );
}

export function AdminError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <Card>
      <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
        Could not load this data. That is usually a connection problem, if it persists,
        check that your account still holds platform administrator access.
      </p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </Card>
  );
}

export function AdminEmpty({ message }: { message: string }): JSX.Element {
  return (
    <Card className="p-0">
      <EmptyState title={message} />
    </Card>
  );
}

/**
 * Metric tile.
 *
 * A thin alias over the shared `StatTile`, kept as a named export because every
 * admin screen already imports it, and because the console's tiles are
 * deliberately icon-less where the tenant app's carry one. Cross-tenant totals
 * do not need decoration.
 */
export function AdminStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return <StatTile label={label} value={value} hint={hint} />;
}
