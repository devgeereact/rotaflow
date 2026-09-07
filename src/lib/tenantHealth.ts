/**
 * Tenant activity and account health, from columns that exist.
 *
 * Both of these were placeholder constants, "12,489 active users today" beside
 * a real total of four, and an organisation-health split summing to 1,284 for
 * eight tenants. Neither could be computed at the time. Two of them can now:
 * 0023 added `organisations.last_activity_at`, maintained by
 * `touch_org_activity()`, and account status and subscription state were always
 * real.
 *
 * What is still not measurable is *user* activity. Nothing records a per-person
 * session, so "active users today" is not derivable at all. The tile it fed
 * now reports tenants rather than people, which is a different and true thing.
 */

export interface TenantLike {
  id: string;
  status: string | null;
  last_activity_at: string | null;
}

export interface TenantSubscriptionLike {
  org_id: string;
  status: string;
}

/** Organisations that did something in the last `hours`. */
export function tenantsActiveWithin(
  organisations: readonly TenantLike[],
  now: Date,
  hours = 24,
): number {
  const cutoff = now.getTime() - hours * 3_600_000;
  return organisations.filter((o) => {
    if (!o.last_activity_at) return false;
    const at = Date.parse(o.last_activity_at);
    return Number.isFinite(at) && at >= cutoff;
  }).length;
}

export type HealthBand = 'healthy' | 'attention' | 'at_risk' | 'suspended' | 'archived';

export const HEALTH_LABEL: Record<HealthBand, string> = {
  healthy: 'Healthy',
  attention: 'Needs attention',
  at_risk: 'At risk',
  suspended: 'Suspended',
  archived: 'Archived',
};

/**
 * The badge tone for each band, in one place.
 *
 * It was in two places and they disagreed: the organisations list drew
 * `at_risk` as a warning and `suspended` as danger; the organisation detail
 * page drew `at_risk` as danger and `suspended` as neutral. The same tenant
 * therefore changed colour on the way to its own page, which is worse than
 * either choice — a console teaches its colours by repetition, and one that
 * contradicts itself teaches nothing.
 *
 * The rule, from `docs/DESIGN.md` §5: danger is failure or a stopped account,
 * warning is review, neutral is inactive with no failure implied. So
 * suspension — the state that actually stops a customer using the product —
 * is the only danger; `attention` and `at_risk` are both review and are told
 * apart by their labels, never by colour alone.
 */
export const HEALTH_TONE: Record<
  HealthBand,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  healthy: 'success',
  attention: 'warning',
  at_risk: 'warning',
  suspended: 'danger',
  archived: 'neutral',
};

/**
 * Which band one tenant falls in.
 *
 * The order matters and is deliberate: a suspended account is suspended
 * whatever else is true of it, and a failed payment outranks a quiet month
 * because it is the one a human has to act on today.
 *
 * "Never active" is treated as at risk rather than healthy. A tenant that has
 * never touched the product is the single most likely one to churn, and
 * counting a null as fine is how a dashboard reports health it has not
 * observed.
 */
export function healthBand(
  organisation: TenantLike,
  subscriptionStatus: string | undefined,
  now: Date,
): HealthBand {
  // Archived and suspended were one band until the console showed an archived
  // tenant a red "Suspended" pill. They are not the same event: suspension is
  // something the platform did to an account that is still a customer, usually
  // over payment or abuse, and it is the one an administrator has to act on.
  // Archiving is a closed account. Colouring the second as a failure puts a
  // danger tone on a row nobody needs to do anything about, and buries the
  // rows that do.
  if (organisation.status === 'archived') return 'archived';
  if (organisation.status && organisation.status !== 'active') return 'suspended';
  if (subscriptionStatus === 'past_due') return 'attention';

  if (!organisation.last_activity_at) return 'at_risk';
  const at = Date.parse(organisation.last_activity_at);
  if (!Number.isFinite(at)) return 'at_risk';

  const days = (now.getTime() - at) / 86_400_000;
  if (days > 30) return 'at_risk';
  if (days > 14) return 'attention';
  return 'healthy';
}

/** The four bands with their counts, in severity order, for the health meter. */
export function healthBreakdown(
  organisations: readonly TenantLike[],
  subscriptions: readonly TenantSubscriptionLike[],
  now: Date,
): { band: HealthBand; label: string; count: number }[] {
  const byOrg = new Map(subscriptions.map((s) => [s.org_id, s.status]));
  const counts: Record<HealthBand, number> = {
    healthy: 0,
    attention: 0,
    at_risk: 0,
    suspended: 0,
    archived: 0,
  };
  for (const organisation of organisations) {
    counts[healthBand(organisation, byOrg.get(organisation.id), now)] += 1;
  }
  return (['healthy', 'attention', 'at_risk', 'suspended', 'archived'] as const).map(
    (band) => ({
      band,
      label: HEALTH_LABEL[band],
      count: counts[band],
    }),
  );
}
