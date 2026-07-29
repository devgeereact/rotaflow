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
import { reportError } from '@/lib/sentry';
import { ACTIVE_ORG_STORAGE_KEY } from '@/lib/session';
import type { MembershipRole } from '@/types';

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
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [rows, profile] = await Promise.all([
        listMyMemberships(user.id),
        getProfile(user.id),
      ]);
      setMemberships(rows);
      setIsPlatformAdmin(profile?.is_platform_admin ?? false);
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
    switchOrg,
    loading,
    loadFailed,
    createOrg,
    refresh,
  ]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
