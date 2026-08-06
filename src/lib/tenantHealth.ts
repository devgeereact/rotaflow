/**
 * Tenant activity and account health, from columns that exist.
 *
 * Both of these were placeholder constants — "12,489 active users today" beside
 * a real total of four, and an organisation-health split summing to 1,284 for
 * eight tenants. Neither could be computed at the time. Two of them can now:
 * 0023 added `organisations.last_activity_at`, maintained by
 * `touch_org_activity()`, and account status and subscription state were always
 * real.
 *
 * What is still not measurable is *user* activity. Nothing records a per-person
 * session, so "active users today" is not derivable at all — the tile it fed
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

export type HealthBand = 'healthy' | 'attention' | 'at_risk' | 'suspended';

export const HEALTH_LABEL: Record<HealthBand, string> = {
  healthy: 'Healthy',
  attention: 'Needs attention',
  at_risk: 'At risk',
  suspended: 'Suspended',
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
  };
  for (const organisation of organisations) {
    counts[healthBand(organisation, byOrg.get(organisation.id), now)] += 1;
  }
  return (['healthy', 'attention', 'at_risk', 'suspended'] as const).map((band) => ({
    band,
    label: HEALTH_LABEL[band],
    count: counts[band],
  }));
}
