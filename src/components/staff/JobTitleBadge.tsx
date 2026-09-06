import { cn } from '@/lib/utils';
import { jobTitleBadgeClass, jobTitleCode } from '@/lib/jobTitlePalette';

/**
 * A person's occupation, as a colour-plus-code chip.
 *
 * The short code is not decoration. It is what makes the chip readable when
 * the colour is not: in greyscale, for a reader with a colour-vision
 * deficiency, and against the other colour system on the same screen (a rota
 * chip is already coloured by shift type). The palette is spaced for
 * separation under simulated protanopia, deuteranopia and tritanopia, but no
 * twelve-colour set is reliably separable for everybody, so the code stays.
 *
 * A title with no colour, or one whose colour is not in the palette any more,
 * renders in the neutral fallback with its name intact — never in a swatch
 * borrowed from a different occupation.
 */
export function JobTitleBadge({
  name,
  colour,
  className,
  showCode = true,
}: {
  name: string | null;
  colour: string | null;
  className?: string;
  /** Off in dense contexts where the full name is already beside it. */
  showCode?: boolean;
}): JSX.Element {
  if (!name) {
    return (
      <span className="text-sm text-content-muted dark:text-content-muted-dark">
        No job title
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        jobTitleBadgeClass(colour),
        className,
      )}
    >
      {/* No `opacity-80` on the code. It read as a subtle de-emphasis and it
          was a contrast failure: on the neutral fallback badge the muted ink
          at 80% measures 3.2:1, under the 4.5:1 text this size needs. The
          token pairs already carry the intended weight — docs/DESIGN.md §2b. */}
      {showCode && (
        <span aria-hidden="true" className="font-mono text-[10px] font-bold">
          {jobTitleCode(name)}
        </span>
      )}
      {name}
    </span>
  );
}
