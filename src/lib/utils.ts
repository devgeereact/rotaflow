import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge` only knows Tailwind's stock scale names, so a project token
 * it has never heard of is treated as unrelated to the stock class it
 * replaces: `cn('rounded-control', 'rounded-lg')` kept both, and which one won
 * came down to stylesheet order. Registering the project's own radius and
 * easing names (`src/index.css`) lets a caller's `className` override a
 * primitive's default the way it does for every stock class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'card'],
      ease: ['control'],
    },
  },
});

/**
 * Merge conditional Tailwind classes, resolving conflicts
 * (e.g. `cn('p-2', condition && 'p-4')` → `p-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
