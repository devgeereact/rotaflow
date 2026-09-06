import type { PlatformRole } from '@/types';

/**
 * Display labels and scope for the platform administration roles
 * (0015_platform_roles.sql).
 *
 * In `lib` rather than beside a component for the same reason as `adminNav`:
 * `RequirePlatformRole`, the console's profile block and the administrators
 * roster all need them, and none of that should require importing a React tree.
 */
export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_owner: 'Platform Owner',
  platform_admin: 'Platform Administrator',
  platform_support: 'Platform Support',
  platform_finance: 'Platform Finance',
};

/** One line on what each role is for, shown on the administrators roster. */
export const PLATFORM_ROLE_SCOPES: Record<PlatformRole, string> = {
  platform_owner: 'Full platform access, including managing other administrators.',
  platform_admin:
    'Manage organisations, users, support and releases. Cannot change roles.',
  platform_support:
    'Find organisations and work support cases. Billing and releases are out of scope.',
  platform_finance: 'Subscriptions and billing state only. No operational tenant data.',
};

/**
 * Roles permitted to change platform configuration. Feature flags, incidents,
 * platform settings. Deliberately excludes support and finance: neither has any
 * business flipping a release for every tenant at once.
 *
 * Mirrors the `has_platform_role(...)` lists in the migrations. The database is
 * the enforcement; this keeps the UI from offering what it would refuse.
 */
export const PLATFORM_CONFIG_ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
];

/** Roles permitted to see subscription and billing state. */
export const PLATFORM_BILLING_ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
  'platform_finance',
];

/**
 * Roles that may read operational tenant data.
 *
 * The mirror of `is_platform_operational()` (0122), which is the platform-side
 * predicate on `audit_logs`, `support_cases`, `support_case_messages`,
 * `incidents`, `incident_updates`, `org_integrations`, `memberships` and
 * `profiles`. `platform_finance` is documented as "Subscriptions and billing
 * state only. No operational tenant data", and since 0122 the database
 * enforces that.
 *
 * The nav and the routes were not told. A finance administrator could open
 * Users, Support Centre, Incidents, Integrations and Audit Logs, and RLS
 * filters rather than raises — so each rendered as an empty table rather than
 * as a refusal, which is the failure `AdminNavItem.roles` exists to prevent:
 * "a screen full of empty tables and left to conclude the product is broken".
 *
 * `organisations` and `subscriptions` are deliberately absent. 0122 left both
 * readable by finance, because an organisation's name, plan and status are
 * billing state and the billing console it exists to use depends on them.
 */
export const PLATFORM_OPERATIONAL_ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
  'platform_support',
];

/** Only an owner may grant or revoke a platform role. Enforced in the RPC. */
export const PLATFORM_ROLE_ADMIN_ROLES: readonly PlatformRole[] = ['platform_owner'];

/**
 * Roles permitted to move a support case along or assign it. Mirrors
 * `set_support_case_status` and `assign_support_case` (0024_support_cases.sql),
 * which excludes finance, the same billing-only carve-out as elsewhere.
 * Replying is not on this list: `reply_to_support_case` only requires being
 * *any* platform administrator, so every role can answer a case even where it
 * cannot re-route one.
 */
export const PLATFORM_SUPPORT_ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
  'platform_support',
];
