import { useMemo } from 'react';
import { useOrg } from '@/hooks/useOrg';

export interface Permissions {
  canBuildRota: boolean; // owner | manager
  canApprove: boolean; // leave/overtime/swaps
  canManageStaff: boolean; // owner | manager
  canManageOrg: boolean; // owner
  canManagePlatform: boolean; // super admin
}

/**
 * Derives UI capabilities from the active role. Client-side gating only —
 * RLS (SCHEMA.md) is the real enforcement; never rely on this for security.
 */
export function usePermissions(): Permissions {
  const { role, isPlatformAdmin } = useOrg();

  return useMemo<Permissions>(() => {
    const isOwnerOrManager = role === 'owner' || role === 'manager';
    return {
      canBuildRota: isOwnerOrManager,
      canApprove: isOwnerOrManager,
      canManageStaff: isOwnerOrManager,
      canManageOrg: role === 'owner',
      canManagePlatform: isPlatformAdmin,
    };
  }, [role, isPlatformAdmin]);
}
