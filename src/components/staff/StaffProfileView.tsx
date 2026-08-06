import { CalendarDays, Clock, HeartPulse, Star, Umbrella } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DocumentsCard } from '@/components/staff/DocumentsCard';
import { PersonalInformationCard } from '@/components/staff/PersonalInformationCard';
import { QualificationsCard } from '@/components/staff/QualificationsCard';
import { RecentActivityCard } from '@/components/staff/RecentActivityCard';
import { ShiftSummaryCard } from '@/components/staff/ShiftSummaryCard';
import { SkillsCompetenciesCard } from '@/components/staff/SkillsCompetenciesCard';
import { StaffMetricCard } from '@/components/staff/StaffMetricCard';
import { StaffProfileHeader } from '@/components/staff/StaffProfileHeader';
import { StaffProfileTabs } from '@/components/staff/StaffProfileTabs';
import { UpcomingShiftsCard } from '@/components/staff/UpcomingShiftsCard';
import { WorkInformationCard } from '@/components/staff/WorkInformationCard';
import type { IconTileTone } from '@/components/ui/IconTile';
import type { StaffProfileData, StaffProfileTab } from '@/lib/staffProfile';

interface StaffProfileViewProps {
  profile: StaffProfileData;
  tab: StaffProfileTab;
  onTabChange: (tab: StaffProfileTab) => void;
  backTo: string;
  onAction: (action: string) => void;
}

/** Icon + tint per metric tile, in the order design/Staff-Profile.png shows them. */
const METRIC_STYLES: { icon: LucideIcon; tone: IconTileTone }[] = [
  { icon: CalendarDays, tone: 'primary' },
  { icon: Clock, tone: 'primary' },
  { icon: HeartPulse, tone: 'warning' },
  { icon: Umbrella, tone: 'success' },
  { icon: Star, tone: 'primary' },
];

/**
 * The Staff Profile overview (design/Staff-Profile.png): identity header, tab
 * strip, then a three-column body. Personal/work facts, the shift record, and
 * a skills/qualifications/documents rail. Presentational; the caller supplies
 * the data and handles the actions.
 */
export function StaffProfileView({
  profile,
  tab,
  onTabChange,
  backTo,
  onAction,
}: StaffProfileViewProps): JSX.Element {
  const name = `${profile.firstName} ${profile.lastName}`;

  return (
    <div>
      <StaffProfileHeader
        name={name}
        active={profile.active}
        meta={[profile.role, profile.department, profile.location]}
        backTo={backTo}
        onMoreActions={() => onAction('more')}
        onEditProfile={() => onAction('edit')}
        onMessage={() => onAction('message')}
      />

      <div className="mt-11">
        <StaffProfileTabs active={tab} onChange={onTabChange} />
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[20rem_minmax(0,1fr)_22.5rem]">
        <div className="space-y-3">
          <PersonalInformationCard
            firstName={profile.firstName}
            lastName={profile.lastName}
            photoUrl={profile.photoUrl}
            info={profile.personal}
            onEdit={() => onAction('edit-personal')}
          />
          <WorkInformationCard rows={profile.work} onEdit={() => onAction('edit-work')} />
        </div>

        <div className="min-w-0 space-y-3">
          {profile.metrics.length > 0 && (
            <div className="rounded-2xl border border-surface-border bg-surface p-3 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {profile.metrics.map((metric, index) => {
                  const style = METRIC_STYLES[index] ?? METRIC_STYLES[0]!;
                  return (
                    <StaffMetricCard
                      key={metric.label}
                      icon={style.icon}
                      tone={style.tone}
                      label={metric.label}
                      value={metric.value}
                      suffix={metric.suffix}
                      hint={metric.hint}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <UpcomingShiftsCard
            shifts={profile.upcoming}
            onViewSchedule={() => onAction('view-schedule')}
            onShiftActions={(id) => onAction(`shift:${id}`)}
          />

          {(profile.summary.length > 0 || profile.activity.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {profile.summary.length > 0 && (
                <ShiftSummaryCard
                  month={profile.summaryMonth}
                  columns={profile.summary}
                  hint={profile.summaryHint}
                  onViewTimesheet={() => onAction('view-timesheet')}
                />
              )}
              {profile.activity.length > 0 && (
                <RecentActivityCard
                  entries={profile.activity}
                  onViewAll={() => onAction('view-activity')}
                />
              )}
            </div>
          )}
        </div>

        <aside className="space-y-3">
          {profile.skills.length > 0 && (
            <SkillsCompetenciesCard
              skills={profile.skills}
              onViewAll={() => onAction('view-skills')}
            />
          )}
          {profile.qualifications.length > 0 && (
            <QualificationsCard
              qualifications={profile.qualifications}
              more={profile.moreQualifications}
              onViewAll={() => onAction('view-qualifications')}
              onShowMore={() => onAction('more-qualifications')}
            />
          )}
          {profile.documents.length > 0 && (
            <DocumentsCard
              documents={profile.documents}
              onViewAll={() => onAction('view-documents')}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
