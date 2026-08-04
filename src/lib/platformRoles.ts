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
  platform_support: 'Find organisations and work support cases. No billing, no releases.',
  platform_finance: 'Subscriptions and billing state only. No operational tenant data.',
};

/**
 * Roles permitted to change platform configuration — feature flags, incidents,
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

/** Only an owner may grant or revoke a platform role — enforced in the RPC. */
export const PLATFORM_ROLE_ADMIN_ROLES: readonly PlatformRole[] = ['platform_owner'];
