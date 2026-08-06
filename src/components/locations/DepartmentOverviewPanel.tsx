import { Card } from '@/components/ui/Card';
import { IconTile } from '@/components/ui/IconTile';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { DEPARTMENT_ICONS } from '@/components/locations/departmentIcons';
import { SiteActivityList } from '@/components/locations/SiteActivityList';
import { SiteMetricGrid } from '@/components/locations/SiteMetricGrid';
import { SiteStatusBadge } from '@/components/locations/SiteStatusBadge';
import { SiteTypePill } from '@/components/locations/SiteTypePill';
import type { DepartmentDetails } from '@/lib/locationsDirectory';

interface DepartmentOverviewPanelProps {
  department: DepartmentDetails;
  onFollowMetric: (id: string) => void;
  onViewActivity: () => void;
}

/**
 * Right-hand summary for the selected department
 * (design/Location-department.png): identity card with mini-stats, then a
 * separate activity card, two cards, unlike the locations panel's single one.
 */
export function DepartmentOverviewPanel({
  department,
  onFollowMetric,
  onViewActivity,
}: DepartmentOverviewPanelProps): JSX.Element {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <StaffSectionHeader title="Department Overview" />

        <div className="mt-4 flex items-start gap-3.5">
          <IconTile
            icon={DEPARTMENT_ICONS[department.icon]}
            tone={department.iconTone}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-card-heading font-semibold text-content dark:text-content-dark">
                {department.name}
              </p>
              <SiteStatusBadge status={department.status} className="shrink-0" />
            </div>
            {department.type && (
              <SiteTypePill
                label={department.type}
                tone={department.typeTone}
                className="mt-1.5"
              />
            )}
          </div>
        </div>

        {department.description && (
          <p className="mt-3.5 text-sm text-content-muted dark:text-content-muted-dark">
            {department.description}
          </p>
        )}

        <SiteMetricGrid
          metrics={department.metrics}
          onFollow={onFollowMetric}
          className="mt-4"
        />
      </Card>

      {/* Hidden until `audit_logs` carries department events. See
          docs/audit01.md P1-5. */}
      {department.activity.length > 0 && (
        <Card className="p-4">
          <StaffSectionHeader
            title="Recent Activity"
            action={<StaffLinkButton onClick={onViewActivity}>View all</StaffLinkButton>}
          />
          <div className="mt-4">
            <SiteActivityList entries={department.activity} />
          </div>
        </Card>
      )}
    </div>
  );
}
