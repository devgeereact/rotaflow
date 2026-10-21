import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { getOrgBillingState } from '@/services/subscriptionService';
import type { OrgBillingSnapshot } from '@/lib/billingState';

export interface OrgBillingStateResult {
  /** Null while loading, for a non-member, or when the read failed. */
  snapshot: OrgBillingSnapshot | null;
  refresh: () => void;
}

/**
 * The active organisation's trial and read-only state (0154), for any member.
 *
 * Re-read every ten minutes as well as on an organisation switch, so a trial
 * that ends while the app is open turns the banner on without a reload.
 *
 * ## Failing open, on purpose
 *
 * A failed read leaves the snapshot null, and nothing renders. That is safe
 * because nothing here is the control: the database refuses a read-only
 * organisation's writes whatever this hook says (`enforce_org_not_read_only`).
 * A banner claiming the organisation is read-only because a request timed out
 * would be a false alarm in front of a paying customer.
 */
export function useOrgBillingState(): OrgBillingStateResult {
  const { orgId } = useOrg();
  const [snapshot, setSnapshot] = useState<OrgBillingSnapshot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!orgId) {
      setSnapshot(null);
      return;
    }
    const load = (): void => {
      getOrgBillingState(orgId)
        .then((next) => {
          if (active) setSnapshot(next);
        })
        .catch(() => {
          if (active) setSnapshot(null);
        });
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orgId, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  return { snapshot, refresh };
}
