import { useContext } from 'react';
import { WorkModeContext, type WorkModeContextValue } from '@/context/WorkModeContext';

/**
 * Whether the signed-in person is looking at the organisation or at their own
 * work, and whether they have a staff profile to have "own work" at all.
 *
 * Outside a `<WorkModeProvider>` this returns the management default rather
 * than throwing. The marketing site, the auth screens and the platform
 * console all render components that consult it and none of them is inside a
 * tenant workspace; making it throw would turn a nav helper into a crash on
 * the sign-in page.
 */
export function useWorkMode(): WorkModeContextValue {
  const context = useContext(WorkModeContext);
  if (context === null) {
    return {
      mode: 'management',
      setMode: () => undefined,
      canSwitch: false,
      staffProfileId: null,
      loading: false,
    };
  }
  return context;
}
