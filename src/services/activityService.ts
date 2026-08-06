import { supabase } from '@/lib/supabase';

/**
 * Record that a human did something in this organisation.
 *
 * `organisations.last_activity_at` drives the console's account-health bands
 * and its "tenants active today" figure. Until this existed the column was
 * written only by the seed, so both reported a number that could not change
 * and would decay to zero as the seeded timestamps aged out.
 *
 * ## Why it is fire and forget
 *
 * The write is rate limited inside `touch_org_activity` to one row per
 * organisation per five minutes, so the cost is small, but it is still a round
 * trip on a path the user is waiting on. Nothing awaits it and a failure is
 * swallowed: a clock-in must not fail because a bookkeeping update did.
 *
 * ## Why it is not a trigger
 *
 * A trigger on every tenant table would fire for imports, migrations and the
 * nightly retention job, and "last activity" would then mean "last time
 * anything touched this row". The point is that a person was present, so it is
 * called from the handful of actions that only a person performs.
 */
export function touchOrgActivity(orgId: string | null | undefined): void {
  if (!orgId) return;
  void supabase.rpc('touch_org_activity', { p_org: orgId }).then(
    () => undefined,
    () => undefined,
  );
}
