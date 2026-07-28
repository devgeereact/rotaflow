import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Button } from '@/components/ui/Button';

/**
 * Registers the service worker and surfaces a non-destructive
 * "new version available" prompt. With skipWaiting:false the new SW
 * waits until the user opts in, so we never interrupt their work.
 */
export function UpdatePrompt(): JSX.Element | null {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true));
        setNeedRefresh(true);
      },
    });
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md animate-fade-up items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg">
      <p className="text-sm text-content">A new version is available.</p>
      <Button size="sm" onClick={() => void update?.()}>
        Reload
      </Button>
    </div>
  );
}
