import { useEffect, useState } from 'react';

/** Reactive online/offline status driven by window connectivity events. */
export function useOnlineStatus(): boolean {
  // Online unless the browser says otherwise. Node 21+ has a global `navigator` with no `onLine`, so the build's
  // prerender read `undefined` as offline and baked "You're offline" into every public page (found 2 Nov 2026).
  const [online, setOnline] = useState<boolean>(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
