import type { ChangeEvent } from 'react';
import { useOrg } from '@/hooks/useOrg';

/** Org picker in the header. Hidden when the user only belongs to one org. */
export function OrgSwitcher(): JSX.Element | null {
  const { orgId, memberships, switchOrg } = useOrg();

  if (memberships.length <= 1) return null;

  return (
    <select
      value={orgId ?? ''}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => switchOrg(e.target.value)}
      aria-label="Switch organisation"
      className="rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
    >
      {memberships.map((m) => (
        <option key={m.orgId} value={m.orgId}>
          {m.orgName}
        </option>
      ))}
    </select>
  );
}
