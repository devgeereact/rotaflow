import { usePWAInstall } from '@/hooks/usePWAInstall';
import { Button } from '@/components/ui/Button';

/** Dismissible banner offering to install the PWA when eligible. */
export function InstallPrompt(): JSX.Element | null {
  const { isInstallable, promptInstall } = usePWAInstall();
  if (!isInstallable) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md animate-fade-up items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg">
      <div>
        <p className="font-semibold text-content">Install this app</p>
        <p className="text-sm text-content-muted">Faster, offline-ready, no store.</p>
      </div>
      <Button size="sm" onClick={() => void promptInstall()}>
        Install
      </Button>
    </div>
  );
}
