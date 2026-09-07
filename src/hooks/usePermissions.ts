import { useMemo } from 'react';
import { useOrg } from '@/hooks/useOrg';
import {
  PLATFORM_BILLING_ROLES,
  PLATFORM_CONFIG_ROLES,
  PLATFORM_ROLE_ADMIN_ROLES,
  PLATFORM_SUPPORT_ROLES,
  PLATFORM_OPERATIONAL_ROLES,
} from '@/lib/platformRoles';

export interface Permissions {
  canBuildRota: boolean; // owner | manager
  canApprove: boolean; // leave/overtime/swaps
  canManageStaff: boolean; // owner | manager
  canManageOrg: boolean; // owner
  canManagePlatform: boolean; // any platform administrator
  /** Subscriptions and billing state. Owner, admin, finance. */
  canManagePlatformBilling: boolean;
  /** Feature flags, incidents, platform settings. Owner and admin only. */
  canManagePlatformConfig: boolean;
  /** Grant and revoke platform roles. Owner only. */
  canManagePlatformAdmins: boolean;
  /** Change a support case's status or assignee. Owner, admin, support. */
  canManageSupportCases: boolean;
  /**
   * Read operational tenant data: memberships, profiles, the audit log,
   * support cases, incidents, integrations and tenant counts. Owner, admin,
   * support.
   *
   * Mirrors `is_platform_operational()` (0122, extended by 0138), which is the
   * database-side predicate on all of it. `platform_finance` is excluded, and
   * the policies FILTER rather than raise — so a screen that offers a finance
   * administrator one of these views renders an empty table, which reads as a
   * broken product rather than as a boundary. This flag exists so the UI can
   * refuse instead.
   */
  canReadTenantOperations: boolean;
}

/**
 * Derives UI capabilities from the active role. Client-side gating only,
 * RLS (SCHEMA.md) is the real enforcement; never rely on this for security.
 *
 * The platform capabilities read `platformRole` rather than the
 * `isPlatformAdmin` boolean: the flag says whether someone may act at platform
 * level at all, the role says as what. The role lists mirror the
 * `has_platform_role(...)` predicates in the migrations, so the UI offers
 * exactly what the database would accept.
 */
export function usePermissions(): Permissions {
  const { role, isPlatformAdmin, platformRole } = useOrg();

  return useMemo<Permissions>(() => {
    const isOwnerOrManager = role === 'owner' || role === 'manager';
    // Null covers both "holds no platform role" and "the grant could not be
    // read". For a permission check, unknown must mean no.
    const holds = (allowed: readonly (typeof platformRole)[]): boolean =>
      platformRole !== null && allowed.includes(platformRole);

    return {
      canBuildRota: isOwnerOrManager,
      canApprove: isOwnerOrManager,
      canManageStaff: isOwnerOrManager,
      canManageOrg: role === 'owner',
      canManagePlatform: isPlatformAdmin,
      canManagePlatformBilling: holds(PLATFORM_BILLING_ROLES),
      canManagePlatformConfig: holds(PLATFORM_CONFIG_ROLES),
      canManagePlatformAdmins: holds(PLATFORM_ROLE_ADMIN_ROLES),
      canManageSupportCases: holds(PLATFORM_SUPPORT_ROLES),
      canReadTenantOperations: holds(PLATFORM_OPERATIONAL_ROLES),
    };
  }, [role, isPlatformAdmin, platformRole]);
}
