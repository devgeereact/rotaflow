import { CalendarDays, Mail, Phone } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { AvailabilityWeekList } from '@/components/staff/AvailabilityWeekList';
import { DocumentList } from '@/components/staff/DocumentList';
import { SkillChipList } from '@/components/staff/SkillChipList';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { cn } from '@/lib/utils';
import { STAFF_STATUS_LABELS, type StaffDetails } from '@/lib/staffDirectory';

interface StaffDetailsPanelProps {
  staff: StaffDetails;
  onEdit: () => void;
  onViewSkills: () => void;
  onViewCalendar: () => void;
  onViewDocuments: () => void;
}

const SECTION = 'px-4 py-4';

/**
 * Right-hand summary for the selected person in the staff directory
 * (design/staff.png): identity and contact, skills, this week's availability
 * and document expiry, stacked in one card with hairline dividers.
 */
export function StaffDetailsPanel({
  staff,
  onEdit,
  onViewSkills,
  onViewCalendar,
  onViewDocuments,
}: StaffDetailsPanelProps): JSX.Element {
  return (
    <Card className="p-0">
      <section className={SECTION}>
        <StaffSectionHeader
          title="Staff Details"
          action={<StaffLinkButton onClick={onEdit}>Edit</StaffLinkButton>}
        />

        <div className="mt-4 flex items-center gap-3.5">
          <StaffAvatar
            firstName={staff.firstName}
            lastName={staff.lastName}
            photoUrl={staff.photoUrl}
            size="xl"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
              {staff.firstName} {staff.lastName}
            </p>
            <p className="truncate text-sm text-content-muted dark:text-content-muted-dark">
              {staff.role}
            </p>
            <p className="truncate text-sm text-content-muted dark:text-content-muted-dark">
              {staff.location}
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-3">
          <ContactRow icon={Mail} label="Email">
            {staff.email}
          </ContactRow>
          <ContactRow icon={Phone} label="Phone">
            {staff.phone}
          </ContactRow>
          <ContactRow icon={CalendarDays} label="Joined">
            {staff.joinedLabel}
          </ContactRow>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'ml-1 h-2.5 w-2.5 shrink-0 rounded-full',
                staff.status === 'active' ? 'bg-success' : 'bg-warning',
              )}
            />
            <span className="text-sm text-content dark:text-content-dark">
              {STAFF_STATUS_LABELS[staff.status]}
            </span>
          </div>
        </dl>
      </section>

      <section
        className={cn(
          SECTION,
          'border-t border-surface-border dark:border-surface-border-dark',
        )}
      >
        <StaffSectionHeader
          title="Skills & Qualifications"
          action={<StaffLinkButton onClick={onViewSkills}>View all</StaffLinkButton>}
        />
        <SkillChipList skills={staff.skills} tone="neutral" className="mt-3" />
      </section>

      <section
        className={cn(
          SECTION,
          'border-t border-surface-border dark:border-surface-border-dark',
        )}
      >
        <StaffSectionHeader
          title="Availability This Week"
          action={
            <StaffLinkButton onClick={onViewCalendar}>View calendar</StaffLinkButton>
          }
        />
        <div className="mt-3">
          <AvailabilityWeekList days={staff.week} />
        </div>
      </section>

      <section
        className={cn(
          SECTION,
          'border-t border-surface-border dark:border-surface-border-dark',
        )}
      >
        <StaffSectionHeader
          title="Documents"
          action={<StaffLinkButton onClick={onViewDocuments}>View all</StaffLinkButton>}
        />
        <div className="mt-3.5">
          <DocumentList documents={staff.documents} />
        </div>
      </section>
    </Card>
  );
}

function ContactRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <dt className="sr-only">{label}</dt>
      <Icon
        size={16}
        aria-hidden="true"
        className="shrink-0 text-content-muted dark:text-content-muted-dark"
      />
      <dd className="min-w-0 truncate text-sm text-content dark:text-content-dark">
        {children}
      </dd>
    </div>
  );
}
