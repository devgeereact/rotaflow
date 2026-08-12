import { CalendarDays, Clock, HeartPulse, Star, Umbrella } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LeaveStatusPill } from '@/components/leave/LeaveStatusPill';
import { LeaveTypeChip } from '@/components/leave/LeaveTypeChip';
import { DocumentList } from '@/components/staff/DocumentList';
import { PersonalInformationCard } from '@/components/staff/PersonalInformationCard';
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
  onUploadDocument: () => void;
  onAddEmergencyContact: () => void;
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
 * One person's profile (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.staffDetail`): identity header, six tabs, each showing real
 * content for once — the tab strip used to be cosmetic, every tab past
 * Overview rendered the same dashboard regardless of which was clicked.
 * `Activity` stays honestly empty: no per-person activity feed exists in the
 * schema to back one.
 */
export function StaffProfileView({
  profile,
  tab,
  onTabChange,
  backTo,
  onAction,
  onUploadDocument,
  onAddEmergencyContact,
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

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <PersonalInformationCard
                firstName={profile.firstName}
                lastName={profile.lastName}
                photoUrl={profile.photoUrl}
                info={profile.personal}
                onEdit={() => onAction('edit-personal')}
              />
              <WorkInformationCard
                rows={profile.work}
                onEdit={() => onAction('edit-work')}
              />
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
              {profile.skills.length > 0 && (
                <SkillsCompetenciesCard
                  skills={profile.skills}
                  onViewAll={() => onAction('view-skills')}
                />
              )}
            </div>
          </div>
        )}

        {tab === 'shifts' && (
          <div className="grid gap-3 lg:grid-cols-2">
            <UpcomingShiftsCard
              shifts={profile.upcoming}
              onViewSchedule={() => onAction('view-schedule')}
              onShiftActions={(id) => onAction(`shift:${id}`)}
            />
            {profile.summary.length > 0 && (
              <ShiftSummaryCard
                month={profile.summaryMonth}
                columns={profile.summary}
                hint={profile.summaryHint}
                onViewTimesheet={() => onAction('view-timesheet')}
              />
            )}
          </div>
        )}

        {tab === 'documents' && (
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-surface-border p-4 dark:border-surface-border-dark">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Documents
              </h2>
              <Button size="sm" onClick={onUploadDocument}>
                Upload
              </Button>
            </div>
            <div className="p-4">
              {profile.documents.length === 0 ? (
                <p className="py-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No documents on file.
                </p>
              ) : (
                <DocumentList documents={profile.documents} />
              )}
            </div>
          </Card>
        )}

        {tab === 'emergency_contacts' && (
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-surface-border p-4 dark:border-surface-border-dark">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Emergency contacts
              </h2>
              <Button size="sm" onClick={onAddEmergencyContact}>
                Add
              </Button>
            </div>
            {profile.emergencyContacts.length === 0 ? (
              <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
                No emergency contacts on file.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {profile.emergencyContacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="flex flex-wrap items-center gap-2 px-4 py-3"
                  >
                    <span className="font-medium text-content dark:text-content-dark">
                      {contact.name}
                    </span>
                    <span className="text-sm text-content-muted dark:text-content-muted-dark">
                      {contact.relationship}
                    </span>
                    <span className="ml-auto font-mono text-sm text-content dark:text-content-dark">
                      {contact.phone}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-surface-border p-4 text-xs text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              Visible to managers only, and never included in an export.
            </p>
          </Card>
        )}

        {tab === 'leave' && (
          <Card className="p-0">
            <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
              <h2 className="font-semibold text-content dark:text-content-dark">Leave</h2>
            </div>
            {profile.leave.length === 0 ? (
              <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
                No leave recorded for this person.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Dates</th>
                      <th className="px-4 py-2.5 text-right">Days</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
                    {profile.leave.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2.5">
                          <LeaveTypeChip type={row.type} />
                        </td>
                        <td className="px-4 py-2.5 text-content dark:text-content-dark">
                          {row.dateLabel}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-content dark:text-content-dark">
                          {row.days}
                        </td>
                        <td className="px-4 py-2.5">
                          <LeaveStatusPill status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === 'activity' && (
          <RecentActivityCard
            entries={profile.activity}
            onViewAll={() => onAction('view-activity')}
          />
        )}
      </div>
    </div>
  );
}
