/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import {
  createOrganisation,
  listMyMemberships,
  type MyMembership,
} from '@/services/orgService';
import { getProfile } from '@/services/profileService';
import { getMyPlatformRole } from '@/services/platformRoleService';
import { reportError } from '@/lib/sentry';
import { ACTIVE_ORG_STORAGE_KEY } from '@/lib/session';
import type { MembershipRole, PlatformRole } from '@/types';

export interface OrgMembershipSummary {
  orgId: string;
  orgName: string;
  role: MembershipRole;
}

export interface OrgContextValue {
  orgId: string | null;
  orgName: string | null;
  role: MembershipRole | null;
  memberships: OrgMembershipSummary[];
  isPlatformAdmin: boolean;
  /**
   * Which kind of platform administrator, or `null` for none.
   *
   * `isPlatformAdmin` answers "may act at platform level" — it is the flag
   * every RLS helper in 0002 folds in, and it gates the `/admin` area as a
   * whole. This answers "as what", and gates individual screens and actions
   * inside it. Both are needed: a support administrator belongs in the console
   * but not in billing.
   */
  platformRole: PlatformRole | null;
  switchOrg: (orgId: string) => void;
  loading: boolean;
  /**
   * True when the memberships query failed. Consumers MUST check this before
   * treating `memberships: []` as "this user has no organisation" — otherwise
   * a dropped connection reads as a brand-new user and pushes an existing
   * owner into onboarding, where they can create a duplicate organisation.
   */
  loadFailed: boolean;
  // Additive beyond docs/HOOKS.md §6 — needed by /onboarding and by any
  // future "refresh after invite accepted" flow.
  createOrg: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// null = "not inside a provider"; the hook guards against this.
export const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSupabaseAuth();
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user) {
      setMemberships([]);
      setIsPlatformAdmin(false);
      setPlatformRole(null);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [rows, profile, role] = await Promise.all([
        listMyMemberships(user.id),
        getProfile(user.id),
        // Deliberately cannot reject. `my_platform_role()` arrives in 0015,
        // and until that migration is applied the RPC does not exist — a
        // rejection here would land in the shared catch, set `loadFailed`,
        // and blank the tenant session for every user in the product over a
        // detail only the platform console needs. The role is additive UI
        // granularity: failing to read it degrades to "no granular role",
        // never to "your session failed".
        getMyPlatformRole().catch((error: unknown) => {
          reportError(error, { area: 'org:platformRole' });
          return null;
        }),
      ]);
      setMemberships(rows);
      setIsPlatformAdmin(profile?.is_platform_admin ?? false);
      setPlatformRole(role);
      setLoadFailed(false);
    } catch (error) {
      reportError(error, { area: 'org:refresh' });
      // Deliberately leaves any previously loaded memberships in place — a
      // failed refresh must not blank out a session that was working.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createOrg = useCallback(
    async (name: string): Promise<void> => {
      if (!user) return;
      await createOrganisation(name, user.id);
      await refresh();
    },
    [user, refresh],
  );

  const switchOrg = useCallback((orgId: string): void => {
    setActiveOrgId(orgId);
    window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
  }, []);

  const value = useMemo<OrgContextValue>(() => {
    const summaries: OrgMembershipSummary[] = memberships.map((m) => ({
      orgId: m.org_id,
      orgName: m.organisation.name,
      role: m.role as MembershipRole,
    }));

    const active = summaries.find((m) => m.orgId === activeOrgId) ?? summaries[0] ?? null;

    return {
      orgId: active?.orgId ?? null,
      orgName: active?.orgName ?? null,
      role: active?.role ?? null,
      memberships: summaries,
      isPlatformAdmin,
      platformRole,
      switchOrg,
      loading,
      loadFailed,
      createOrg,
      refresh,
    };
  }, [
    memberships,
    activeOrgId,
    isPlatformAdmin,
    platformRole,
    switchOrg,
    loading,
    loadFailed,
    createOrg,
    refresh,
  ]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
