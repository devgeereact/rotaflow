import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success';

interface CalloutProps {
  tone?: CalloutTone;
  /** Bold opening line. Omit for a single-paragraph note. */
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A toned note. The thing a console screen uses to say "this is not what you
 * think it is".
 *
 * ## Why this exists as a component
 *
 * These blocks were being written as `Card` with
 * `border-warning/30 bg-warning/5` inline, and then, when the console moved to
 * `Panel`, several of them quietly lost their tone and became plain grey
 * panels. That mattered more than it sounds: every one of them is a caveat,
 * "suspending does not lock anyone out", "this is not a delivery rate",
 * "revenue is not built", and a caveat that reads like body copy is a caveat
 * nobody notices.
 *
 * The washes are the opaque semantic tokens (docs/DESIGN.md §2), not an alpha
 * of the solid, so a callout is the same colour on a card as it is on the
 * canvas.
 */
const TONES: Record<CalloutTone, { wrap: string; icon: string; Icon: typeof Info }> = {
  info: {
    wrap: 'bg-info-wash border-info/30 dark:bg-info-wash-dark',
    icon: 'text-info',
    Icon: Info,
  },
  warning: {
    wrap: 'bg-warning-wash border-warning/34 dark:bg-warning-wash-dark',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  danger: {
    wrap: 'bg-danger-wash border-danger/34 dark:bg-danger-wash-dark',
    icon: 'text-danger',
    Icon: ShieldAlert,
  },
  success: {
    wrap: 'bg-success-wash border-success/34 dark:bg-success-wash-dark',
    icon: 'text-success',
    Icon: CheckCircle2,
  },
};

export function Callout({
  tone = 'info',
  title,
  children,
  className,
}: CalloutProps): JSX.Element {
  const { wrap, icon, Icon } = TONES[tone];
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-3.5', wrap, className)}>
      <Icon size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', icon)} />
      <div className="min-w-0 text-sm leading-relaxed text-content dark:text-content-dark">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div className="[&_p]:text-content-muted dark:[&_p]:text-content-muted-dark [&_p+p]:mt-2">
          {children}
        </div>
      </div>
    </div>
  );
}
