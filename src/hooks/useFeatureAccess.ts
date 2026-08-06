import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/hooks/useOrg';

/**
 * What this organisation may use, and why.
 *
 * Two different questions share one answer here, and the `source` says which
 * is which. A **plan** entitlement is commercial: it changes when someone
 * upgrades, and taking it away is a billing decision. A **flag** is a release
 * decision: it changes when engineering says so, and it can move backwards.
 *
 * `my_feature_access` returns both in one call, per organisation load. Asking
 * per gate would be six round trips to render one screen, which is how a
 * feature check becomes the thing everyone disables.
 *
 * ## Failing closed
 *
 * If the call fails the set is empty and every gate reads false. A gated
 * feature that renders when the check errored is worse than one that stays
 * hidden: the second is a support ticket, the first is a customer using
 * something they have not bought.
 */
export interface FeatureAccess {
  /** True while the answer is still being fetched. Gates read false meanwhile. */
  loading: boolean;
  has: (feature: string) => boolean;
  /** Why the feature is available, for copy that has to explain an upgrade. */
  sourceOf: (feature: string) => 'plan' | 'flag' | null;
  refresh: () => void;
}

export function useFeatureAccess(): FeatureAccess {
  const { orgId } = useOrg();
  const [granted, setGranted] = useState<Map<string, 'plan' | 'flag'>>(new Map());
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!orgId) {
      setGranted(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase.rpc('my_feature_access', { p_org: orgId });
      if (!active) return;
      if (error) {
        // Deliberately silent and closed. This is not an error a user can act
        // on, and reporting it on every page load would bury real ones.
        setGranted(new Map());
      } else {
        setGranted(
          new Map(
            (data ?? []).map((row) => [row.feature, row.source as 'plan' | 'flag']),
          ),
        );
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const has = useCallback((feature: string) => granted.has(feature), [granted]);
  const sourceOf = useCallback(
    (feature: string) => granted.get(feature) ?? null,
    [granted],
  );
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { loading, has, sourceOf, refresh };
}
