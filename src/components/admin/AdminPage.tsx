import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * Shared frame for every `/admin/*` screen: title, one-line purpose, and the
 * three states each of them needs. Written once here so seven screens cannot
 * drift into seven different spellings of "Loading…".
 */
export function AdminPage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="max-w-[1400px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            {title}
          </h1>
          <p className="text-content-muted dark:text-content-muted-dark">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function AdminLoading(): JSX.Element {
  return (
    <Card>
      <p className="text-sm text-content-muted dark:text-content-muted-dark">Loading…</p>
    </Card>
  );
}

export function AdminError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <Card>
      <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
        Could not load this data. That is usually a connection problem — if it persists,
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
    <Card>
      <p className="text-sm text-content-muted dark:text-content-muted-dark">{message}</p>
    </Card>
  );
}

/** Metric tile. Kept here so the admin area's numbers all read the same. */
export function AdminStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return (
    <Card>
      <p className="text-sm text-content-muted dark:text-content-muted-dark">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-content dark:text-content-dark">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
          {hint}
        </p>
      )}
    </Card>
  );
}
