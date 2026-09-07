import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

interface MobileDisclosureProps {
  /** The summary line on a phone. Also the section heading on desktop. */
  title: string;
  /** A short count or status shown beside the title, e.g. "4 entries". */
  hint?: string;
  children: ReactNode;
  /** Start expanded on a phone too. For a section that is usually wanted. */
  defaultOpen?: boolean;
  /**
   * The width at which the content stops being collapsible and is simply on
   * the page. `md` (768px) by default — the width at which the app stops being
   * a phone.
   *
   * `xl` is for content inside the workspace column rather than the viewport:
   * `AppShell`'s 256px rail means a 1,280px window is a ~950px column, and the
   * rota toolbar needs about that much before its filters, Auto-assign and
   * Actions fit on one line.
   */
  breakpoint?: 'md' | 'lg' | 'xl';
  /**
   * `panel` is the default: a full-width summary bar over stacked content.
   * `inline` is a compact chip that sits in a toolbar row beside other
   * controls, with the content revealed on the line below.
   */
  variant?: 'panel' | 'inline';
  className?: string;
}

const MAX_WIDTH: Record<'md' | 'lg' | 'xl', string> = {
  md: '(max-width: 767px)',
  lg: '(max-width: 1023px)',
  xl: '(max-width: 1279px)',
};

/**
 * Secondary content: collapsed behind a summary on a phone, always open on a
 * desktop.
 *
 * ## Why this exists
 *
 * The clock-in screen was 4,134px tall on a 390px viewport, and `Clock In Now`
 * sat 1,370px down it — past three full phone screens of shift detail,
 * weekly summary, attendance trend, recent activity and help links. Every one
 * of those panels is genuinely useful and none of them is what somebody
 * arriving for a shift opened the screen to do.
 *
 * The alternative to disclosure is deleting the panels, which loses real
 * capability, or reordering them, which only moves the problem down the page.
 *
 * ## Why `<details>` rather than a button and some state
 *
 * `<details>`/`<summary>` is keyboard-operable, announced with its expanded
 * state and findable by in-page search with no JavaScript and no ARIA to keep
 * correct. The only thing it needs help with is not existing at all on a
 * desktop, where the content should simply be on the page.
 */
export function MobileDisclosure({
  title,
  hint,
  children,
  defaultOpen = false,
  breakpoint = 'md',
  variant = 'panel',
  className,
}: MobileDisclosureProps): JSX.Element {
  const narrow = useMediaQuery(MAX_WIDTH[breakpoint]);

  if (!narrow) return <div className={className}>{children}</div>;

  return (
    <details open={defaultOpen} className={cn('group', className)}>
      <summary
        className={cn(
          'flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-lg border border-surface-border bg-surface text-sm font-semibold text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark',
          variant === 'inline' ? 'w-auto px-3 py-2' : 'px-4 py-3',
        )}
      >
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="shrink-0 transition-transform duration-control group-open:rotate-180 motion-reduce:transition-none"
        />
        <span className={cn('text-left', variant === 'panel' && 'flex-1')}>{title}</span>
        {hint && (
          <span className="text-xs font-normal text-content-muted dark:text-content-muted-dark">
            {hint}
          </span>
        )}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
