import { Award, FileText, Plus } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import type { QualificationStatus, StaffQualification } from '@/lib/staffProfile';

interface QualificationsCardProps {
  qualifications: StaffQualification[];
  /** Count behind the "+ N more qualifications" affordance. */
  more: number;
  onViewAll: () => void;
  onShowMore: () => void;
}

const TONES: Record<QualificationStatus, BadgeTone> = {
  Active: 'success',
  Completed: 'success',
  Expiring: 'warning',
};

/** Registrations, degrees and certificates in the profile rail. */
export function QualificationsCard({
  qualifications,
  more,
  onViewAll,
  onShowMore,
}: QualificationsCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title="Qualifications"
        action={<StaffLinkButton onClick={onViewAll}>View all</StaffLinkButton>}
      />
      <ul className="mt-3.5 space-y-3.5">
        {qualifications.map((qualification) => {
          const Icon = qualification.icon === 'award' ? Award : FileText;
          return (
            <li key={qualification.id} className="flex items-start gap-2.5">
              <Icon
                size={16}
                aria-hidden="true"
                className={
                  qualification.icon === 'award'
                    ? 'mt-0.5 shrink-0 text-primary'
                    : 'mt-0.5 shrink-0 text-content-muted dark:text-content-muted-dark'
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                  {qualification.name}
                </p>
                <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                  {qualification.issuer}
                </p>
              </div>
              {qualification.status ? (
                <Badge tone={TONES[qualification.status]} className="shrink-0">
                  {qualification.status}
                </Badge>
              ) : (
                <span className="shrink-0 whitespace-nowrap text-xs text-content-muted dark:text-content-muted-dark">
                  {qualification.validLabel}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <StaffLinkButton onClick={onShowMore} className="mt-3.5 font-medium">
          <Plus size={14} aria-hidden="true" />
          {more} more qualifications
        </StaffLinkButton>
      )}
    </Card>
  );
}
