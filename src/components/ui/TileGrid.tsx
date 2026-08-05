import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The row of metric tiles a console screen opens with.
 *
 * ## Why this is not per-page grid classes
 *
 * Every screen was declaring its own `sm:grid-cols-2 lg:grid-cols-3
 * xl:grid-cols-5`, chosen to suit however many tiles it had on the day it was
 * written. Add a tile later and the count no longer divides: six tiles in a
 * five-column grid leaves one stranded on a row of its own, which is exactly
 * what happened to the overview when a seventh tile was added to a grid built
 * for six.
 *
 * `auto-fit` with a minimum track removes the arithmetic. The browser fits as
 * many tiles as will hold their minimum width and stretches them to fill, so a
 * row is always full and a screen can gain or lose a tile without anyone
 * revisiting a breakpoint. It is the same rule the console reference uses.
 */
export function TileGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
