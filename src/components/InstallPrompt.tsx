import { usePWAInstall } from '@/hooks/usePWAInstall';
import { Button } from '@/components/ui/Button';

/** Dismissible banner offering to install the PWA when eligible. */
export function InstallPrompt(): JSX.Element | null {
  const { isInstallable, promptInstall } = usePWAInstall();
  if (!isInstallable) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md animate-fade-up items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark">
      <div>
        <p className="font-semibold text-content dark:text-content-dark">
          Install this app
        </p>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loads faster and works offline. It installs from the browser.
        </p>
      </div>
      <Button size="sm" onClick={() => void promptInstall()}>
        Install
      </Button>
    </div>
  );
}
