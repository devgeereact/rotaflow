import { createContext, useContext, useEffect } from 'react';

/**
 * How the platform console's topbar Refresh button reaches the screen under it.
 *
 * The console reference (`docs/PLATFORM_CONSOLE.html`) puts Refresh in the
 * shell, above the page, because every platform screen is a live read of
 * cross-tenant state and "is this still true?" is the question an administrator
 * asks most. But a shell cannot know how to refetch a page it does not own, and
 * a button wired to `location.reload()` throws away the filters, the open tab
 * and the scroll position the administrator just set up — the console's tables
 * are long, and reloading to re-read six numbers is a bad trade.
 *
 * So the direction is inverted: a screen *registers* its refetch, and the shell
 * renders the button only while something is registered. A screen that has not
 * adopted this yet shows no button rather than a dead one.
 */
export interface ConsoleRefreshValue {
  /** Registered refetch, or null while no screen has offered one. */
  refresh: (() => void) | null;
  /** Called by `useRegisterConsoleRefresh`; not for direct use. */
  register: (fn: (() => void) | null) => void;
}

export const ConsoleRefreshContext = createContext<ConsoleRefreshValue>({
  refresh: null,
  register: () => {},
});

/** Read by the shell to decide whether to render Refresh at all. */
export function useConsoleRefresh(): ConsoleRefreshValue {
  return useContext(ConsoleRefreshContext);
}

/**
 * Offer this screen's refetch to the console topbar.
 *
 * Pass a stable callback — wrap it in `useCallback`, as the data hooks already
 * return their `refetch`. Registration is cleared on unmount, so navigating to
 * a screen that has not adopted this removes the button rather than leaving the
 * previous screen's refetch behind it.
 */
export function useRegisterConsoleRefresh(fn: () => void): void {
  const { register } = useConsoleRefresh();
  useEffect(() => {
    register(fn);
    return () => register(null);
  }, [register, fn]);
}
