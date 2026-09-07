/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { getMyStaffProfile } from '@/services/staffService';
import { reportError } from '@/lib/sentry';
import {
  canSwitchWorkMode,
  resolveWorkMode,
  workModeStorageKey,
  type WorkMode,
} from '@/lib/workMode';

export interface WorkModeContextValue {
  mode: WorkMode;
  setMode: (mode: WorkMode) => void;
  /** Whether the switch should be offered. See `canSwitchWorkMode`. */
  canSwitch: boolean;
  /** This user's staff profile id in the active organisation, or `null`. */
  staffProfileId: string | null;
  /** True until the staff lookup has answered. */
  loading: boolean;
}

export const WorkModeContext = createContext<WorkModeContextValue | null>(null);

/**
 * Whether the signed-in person also works shifts here, and which of the two
 * faces of the product they are looking at.
 *
 * ## Why this is a provider and not a hook per screen
 *
 * "Do I have a staff profile in this organisation" is asked by the sidebar,
 * the mobile tab bar, the dashboard, the schedule, the clock-in screen and
 * every route guard. Four of those already ran `getMyStaffProfile`
 * separately, so the same query was issued four times on one page load and
 * each caller cached the answer differently. One query, one answer.
 *
 * ## Why the answer is cleared before the next one arrives
 *
 * `staffProfileId` is reset the instant the user or the organisation changes,
 * not when the new query resolves. Leaving the old id in place for the
 * duration of a round trip would mean a screen briefly rendering one
 * organisation's staff record under another organisation's name — the
 * previous-tenant leak `clearTenantState` exists to prevent, arrived at from
 * the other direction.
 */
export function WorkModeProvider({ children }: { children: ReactNode }): JSX.Element {
  const { orgId, role } = useOrg();
  const { user } = useSupabaseAuth();

  const [staffProfileId, setStaffProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stored, setStored] = useState<string | null>(null);

  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    // Cleared synchronously, before the await. See the header.
    setStaffProfileId(null);
    setStored(
      userId && orgId
        ? window.localStorage.getItem(workModeStorageKey(userId, orgId))
        : null,
    );

    if (!orgId || !userId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void getMyStaffProfile(orgId, userId)
      .then((profile) => {
        if (cancelled) return;
        setStaffProfileId(profile?.id ?? null);
      })
      .catch((error: unknown) => {
        reportError(error, { area: 'workMode:staffProfile' });
        // A failed lookup must degrade to "no staff profile", which is the
        // management default. The alternative — assuming they do work shifts
        // — would show a clock-in screen that cannot function.
        if (!cancelled) setStaffProfileId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const canWorkShifts = staffProfileId !== null;

  const setMode = useCallback(
    (next: WorkMode): void => {
      setStored(next);
      if (userId && orgId) {
        window.localStorage.setItem(workModeStorageKey(userId, orgId), next);
      }
    },
    [userId, orgId],
  );

  const value = useMemo<WorkModeContextValue>(
    () => ({
      mode: resolveWorkMode({ role, canWorkShifts, stored }),
      setMode,
      canSwitch: canSwitchWorkMode({ role, canWorkShifts }),
      staffProfileId,
      loading,
    }),
    [role, canWorkShifts, stored, setMode, staffProfileId, loading],
  );

  return <WorkModeContext.Provider value={value}>{children}</WorkModeContext.Provider>;
}
