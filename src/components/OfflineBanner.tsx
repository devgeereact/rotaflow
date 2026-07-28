import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** Fixed bottom banner shown only while the device is offline. */
export function OfflineBanner(): JSX.Element | null {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 animate-fade-up bg-surface px-4 py-3 text-center text-sm text-content-muted border-t border-surface-border"
    >
      You're offline — showing cached content.
    </div>
  );
}
