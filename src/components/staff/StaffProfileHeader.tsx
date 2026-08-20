import { ChevronDown, ChevronLeft, CircleCheck, Mail, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface StaffProfileHeaderProps {
  name: string;
  active: boolean;
  /** "Senior Nurse • Nursing • Sunshine Care Home". Joined by the component. */
  meta: string[];
  backTo: string;
  onMoreActions: () => void;
  onEditProfile: () => void;
  onMessage: () => void;
}

const ACTION =
  'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-sm font-semibold ' +
  'transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark';

/** Breadcrumb, name, status and the three profile actions (docs/design/Staff-Profile.png). */
export function StaffProfileHeader({
  name,
  active,
  meta,
  backTo,
  onMoreActions,
  onEditProfile,
  onMessage,
}: StaffProfileHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-sm text-content-muted dark:text-content-muted-dark">
          <ChevronLeft size={14} aria-hidden="true" />
          <Link
            to={backTo}
            className="rounded font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Staff
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate">{name}</span>
        </p>

        <h1 className="mt-1.5 flex flex-wrap items-center gap-3 font-display text-page-title font-semibold text-content dark:text-content-dark">
          {name}
          <Badge tone={active ? 'success' : 'neutral'} className="px-2.5 py-1">
            <CircleCheck size={13} aria-hidden="true" />
            {active ? 'Active' : 'Inactive'}
          </Badge>
        </h1>

        <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
          {meta.join(' • ')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onMoreActions}
          className={cn(ACTION, 'text-content dark:text-content-dark')}
        >
          More Actions
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onEditProfile}
          className={cn(ACTION, 'text-primary')}
        >
          <Pencil size={16} aria-hidden="true" />
          Edit Profile
        </button>
        <button
          type="button"
          onClick={onMessage}
          className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Mail size={16} aria-hidden="true" />
          Message Staff
        </button>
      </div>
    </div>
  );
}
