import { useContext, type ReactNode } from 'react';
import { InAppShellContext } from '@/components/ui/inAppShell';
import { cn } from '@/lib/utils';

interface PreviewCanvasProps {
  children: ReactNode;
  /**
   * The standalone page chrome, applied only outside `AppShell`. Defaults to
   * the shell's own `px-6 py-8 md:px-10`. A few previews were built against a
   * reference PNG with slightly different margins and pass their own.
   */
  standaloneClassName?: string;
  className?: string;
}

const DEFAULT_STANDALONE =
  'min-h-screen bg-background px-6 py-8 md:px-10 dark:bg-background-dark';

/**
 * The page padding a `*PreviewPage` needs when it is rendered on its own, and
 * must not add when it is rendered inside `AppShell`.
 *
 * ## Why this exists
 *
 * Each design-loop preview page carried `min-h-screen bg-background px-6 py-8`
 * so `/clockin-preview` looked like a page rather than content jammed against
 * the window edge. `AppShellPreviewPage` then routed those same components
 * *inside* the real shell, which already supplies `px-6 md:px-10` — so every
 * screen in `/app-preview/*` rendered with double the horizontal inset and
 * overflowed its own scroll container by exactly 2 × 24px at 390px.
 *
 * That is a measurement problem, not only a cosmetic one. The whole point of
 * the shell harness is to check responsive behaviour against the real chrome,
 * and it was reporting a 20px overflow that the product does not have while
 * hiding 48px of width that the product does. A design review run against it
 * reads both the wrong way round.
 *
 * Fixed here rather than by deleting the padding, because the standalone
 * routes are still how five of the reference PNGs are matched.
 */
export function PreviewCanvas({
  children,
  standaloneClassName = DEFAULT_STANDALONE,
  className,
}: PreviewCanvasProps): JSX.Element {
  const insideShell = useContext(InAppShellContext);
  return (
    <div className={cn(!insideShell && standaloneClassName, className)}>{children}</div>
  );
}
