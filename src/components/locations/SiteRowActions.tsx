import { Eye, MoreVertical, Pencil } from 'lucide-react';

interface SiteRowActionsProps {
  /** Names the row in each button's accessible label. */
  name: string;
  onView: () => void;
  onEdit: () => void;
  onOpenActions: () => void;
}

const BUTTON =
  'grid h-8 w-8 place-items-center rounded-lg border border-surface-border bg-surface text-content ' +
  'transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/** View / edit / overflow trio in the Actions column of both tables. */
export function SiteRowActions({
  name,
  onView,
  onEdit,
  onOpenActions,
}: SiteRowActionsProps): JSX.Element {
  const stop =
    (handler: () => void) =>
    (event: React.MouseEvent): void => {
      event.stopPropagation();
      handler();
    };

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label={`View ${name}`}
        onClick={stop(onView)}
        className={BUTTON}
      >
        <Eye size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Edit ${name}`}
        onClick={stop(onEdit)}
        className={BUTTON}
      >
        <Pencil size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`More actions for ${name}`}
        onClick={stop(onOpenActions)}
        className={BUTTON}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
