import {
  CakeSlice,
  CalendarDays,
  Mail,
  MapPin,
  Pencil,
  Phone,
  VenusAndMars,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { StaffPersonalInfo } from '@/lib/staffProfile';

interface PersonalInformationCardProps {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  info: StaffPersonalInfo;
  onEdit: () => void;
}

/** Photo plus contact facts, top-left of the profile (docs/design/Staff-Profile.png). */
export function PersonalInformationCard({
  firstName,
  lastName,
  photoUrl,
  info,
  onEdit,
}: PersonalInformationCardProps): JSX.Element {
  // Empty values are dropped, not rendered as em-dashes: several of these
  // (date of birth, gender) have no column in docs/SCHEMA.md yet.
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Mail, label: 'Email', value: info.email },
    { icon: Phone, label: 'Phone', value: info.phone },
    { icon: CalendarDays, label: 'Joined', value: info.joinedLabel },
    { icon: CakeSlice, label: 'Date of birth', value: info.birthLabel },
    { icon: VenusAndMars, label: 'Gender', value: info.gender },
    { icon: MapPin, label: 'Location', value: info.location },
  ].filter((row) => row.value.length > 0);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-content dark:text-content-dark">
          Personal Information
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-surface-border px-2 text-xs font-medium text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
        >
          <Pencil size={12} aria-hidden="true" />
          Edit
        </button>
      </div>

      <StaffAvatar
        firstName={firstName}
        lastName={lastName}
        photoUrl={photoUrl}
        size="xl"
        className="mt-4"
      />

      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <dt className="sr-only">{row.label}</dt>
            <row.icon
              size={16}
              aria-hidden="true"
              className="shrink-0 text-content-muted dark:text-content-muted-dark"
            />
            <dd className="min-w-0 truncate text-sm text-content dark:text-content-dark">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
