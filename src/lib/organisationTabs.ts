/**
 * Which sections of `/admin/organisations/:id` a platform role may open.
 *
 * ## Why the gate is here and not on the route
 *
 * Every other operational console route carries a `RequirePlatformRole` in
 * `src/App.tsx`. This one deliberately does not, and should not:
 * `platform_finance` legitimately needs the Subscription and Usage tabs, which
 * are billing state and the reason that role exists. Gating the whole route
 * would take away what it is entitled to; gating nothing gave it everything.
 *
 * ## The defect this closes
 *
 * `0122` put `memberships`, `profiles`, `audit_logs`, `support_case*`,
 * `incidents` and `org_integrations` behind `is_platform_operational()`, which
 * excludes finance. RLS **filters rather than raises**, so a finance
 * administrator opening this page read "This organisation has no members", an
 * empty audit tab, and a Users tile of 0 sitting beside a Locations tile with a
 * real number. Verified against a local stack: finance saw 0 memberships and 0
 * audit rows while the organisation itself still resolved.
 *
 * A boundary that renders as an empty table is indistinguishable from a broken
 * product, which is the failure `src/lib/platformRoles.ts` says these gates
 * exist to prevent.
 *
 * ## In `lib` rather than beside the page
 *
 * Two reasons. The project keeps pure logic in `src/lib` so it runs under Node
 * without dragging in a Supabase client. And the preview harness signs in as a
 * Platform Owner with no role switch, so the finance path is not reachable in a
 * browser at all — left inline, the one case that matters would have been the
 * one case nothing could cover.
 */

export type OrganisationTab =
  | 'overview'
  | 'users'
  | 'locations'
  | 'subscription'
  | 'usage'
  | 'support'
  | 'integrations'
  | 'audit'
  | 'data';

/**
 * The console reference lists ten tabs. Nine are here; the tenth, Activity, is
 * not — a tenant activity timeline would have to come from `audit_logs`, which
 * still has essentially one writer, so it would show a couple of rows and imply
 * nothing else had happened. Stated on the Data tab rather than shown empty.
 */
export const ORGANISATION_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'users', label: 'Users' },
  { value: 'locations', label: 'Locations' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'usage', label: 'Usage' },
  { value: 'support', label: 'Support' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'audit', label: 'Audit' },
  { value: 'data', label: 'Data' },
] as const satisfies readonly { value: OrganisationTab; label: string }[];

/**
 * Tabs that read operational tenant data, mirroring `is_platform_operational()`.
 *
 * `subscription` and `usage` are deliberately absent: a plan, a status and a
 * seat count are billing state, and `0122` made the same call about
 * `organisations` for the same reason.
 */
const OPERATIONAL_TABS = new Set<OrganisationTab>([
  'users',
  'support',
  'integrations',
  'audit',
  'data',
]);

export interface ResolvedTabs {
  visible: readonly OrganisationTab[];
  active: OrganisationTab;
  /** A real tab this role may not read. Null for an unknown value. */
  refused: OrganisationTab | null;
}

export function resolveOrganisationTabs(input: {
  requested: string | null;
  canReadTenantOperations: boolean;
}): ResolvedTabs {
  const visible = ORGANISATION_TABS.filter(
    (t) => input.canReadTenantOperations || !OPERATIONAL_TABS.has(t.value),
  ).map((t) => t.value);
  const isKnown = ORGANISATION_TABS.some((t) => t.value === input.requested);
  const isVisible = visible.some((v) => v === input.requested);
  return {
    visible,
    active: isVisible ? (input.requested as OrganisationTab) : 'overview',
    // An unknown value falls back silently; a real tab this role may not read is
    // refused out loud. Telling somebody their role forbids "?tab=nonsense"
    // would be a lie, and hiding a genuine refusal is the original bug.
    refused: isKnown && !isVisible ? (input.requested as OrganisationTab) : null,
  };
}
