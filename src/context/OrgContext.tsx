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
import { createOrganisation, listMyMemberships, type MyMembership } from '@/services/orgService';
import { reportError } from '@/lib/sentry';
import type { MembershipRole, Organisation } from '@/types';

export interface OrgContextValue {
  memberships: MyMembership[];
  currentOrg: Organisation | null;
  currentRole: MembershipRole | null;
  loading: boolean;
  createOrg: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// null = "not inside a provider"; the hook guards against this.
export const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSupabaseAuth();
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user) {
      setMemberships([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listMyMemberships(user.id);
      setMemberships(rows);
    } catch (error) {
      reportError(error, { area: 'org:refresh' });
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

  const value = useMemo<OrgContextValue>(() => {
    // V1: a manager operates in one org at a time — the first active
    // membership. Org switching UI lands when multi-org staff need it.
    const active = memberships[0] ?? null;
    return {
      memberships,
      currentOrg: active?.organisation ?? null,
      currentRole: (active?.role as MembershipRole | undefined) ?? null,
      loading,
      createOrg,
      refresh,
    };
  }, [memberships, loading, createOrg, refresh]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
