import { useState } from 'react';
import { Mail, Phone, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { PanelTabs, type PanelTabItem } from '@/components/ui/PanelTabs';
import { LocationThumb } from '@/components/locations/LocationThumb';
import { SiteActivityList } from '@/components/locations/SiteActivityList';
import { SiteMetricGrid } from '@/components/locations/SiteMetricGrid';
import { SiteStatusBadge } from '@/components/locations/SiteStatusBadge';
import { cn } from '@/lib/utils';
import type { LocationDetails, LocationPanelTab } from '@/lib/locationsDirectory';

interface LocationDetailsPanelProps {
  location: LocationDetails;
  onClose: () => void;
  onEditInfo: () => void;
  onFollowMetric: (id: string) => void;
  onViewActivity: () => void;
}

const TABS: PanelTabItem<LocationPanelTab>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'staff', label: 'Staff' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'settings', label: 'Settings' },
  { value: 'history', label: 'History' },
];

const SECTION = 'px-3.5 py-3.5';

/**
 * Right-hand summary for the selected site (design/Locations-Management.png):
 * identity, contact, an Overview tab of mini-stats, key information and the
 * activity feed, stacked in one card with hairline dividers.
 *
 * Only Overview has content — the reference shows the other four as labels
 * only, so they render an explicit "not built yet" note rather than a blank.
 */
export function LocationDetailsPanel({
  location,
  onClose,
  onEditInfo,
  onFollowMetric,
  onViewActivity,
}: LocationDetailsPanelProps): JSX.Element {
  const [tab, setTab] = useState<LocationPanelTab>('overview');

  return (
    <Card className="p-0">
      <section className={SECTION}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-card-heading font-semibold text-content dark:text-content-dark">
            {location.name}
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            <SiteStatusBadge status={location.status} />
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${location.name}`}
              className="rounded text-content-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-4">
          <LocationThumb name={location.name} photoUrl={location.photoUrl} size="panel" />
          <div className="min-w-0">
            {location.addressLines.map((line) => (
              <p
                key={line}
                className="truncate text-sm text-content dark:text-content-dark"
              >
                {line}
              </p>
            ))}
            <div className="mt-3 space-y-1.5">
              <p className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                <Phone
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 text-content-muted dark:text-content-muted-dark"
                />
                <span className="truncate">{location.phone}</span>
              </p>
              <p className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                <Mail
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 text-content-muted dark:text-content-muted-dark"
                />
                <span className="truncate">{location.email}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="px-3.5">
        <PanelTabs
          items={TABS}
          active={tab}
          onChange={setTab}
          label={`${location.name} sections`}
          gapClass="gap-4"
        />
      </div>

      {tab === 'overview' ? (
        <>
          <section className={SECTION}>
            <SiteMetricGrid metrics={location.metrics} onFollow={onFollowMetric} />
          </section>

          <section
            className={cn(
              SECTION,
              'border-t border-surface-border dark:border-surface-border-dark',
            )}
          >
            <StaffSectionHeader
              title="Key Information"
              action={<StaffLinkButton onClick={onEditInfo}>Edit</StaffLinkButton>}
            />
            <dl className="mt-4 space-y-3">
              {location.info.map((row) => (
                <div key={row.id} className="flex items-start gap-3">
                  <dt className="w-[46%] shrink-0 text-sm leading-5 text-content-muted dark:text-content-muted-dark">
                    {row.label}
                  </dt>
                  <dd className="flex min-w-0 flex-1 items-center gap-2 text-sm leading-5 text-content dark:text-content-dark">
                    {row.avatarName && (
                      <StaffAvatar
                        firstName={row.avatarName.split(' ')[0] ?? ''}
                        lastName={row.avatarName.split(' ')[1] ?? ''}
                        photoUrl={row.avatarUrl ?? null}
                        size="sm"
                      />
                    )}
                    <span className="min-w-0">{row.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* `audit_logs` records no location events yet (docs/audit01.md P1-5),
              so the real screen has nothing to show here and hides the section
              rather than drawing an empty heading. */}
          {location.activity.length > 0 && (
            <section
              className={cn(
                SECTION,
                'border-t border-surface-border dark:border-surface-border-dark',
              )}
            >
              <StaffSectionHeader
                title="Recent Activity"
                action={
                  <StaffLinkButton onClick={onViewActivity}>View all</StaffLinkButton>
                }
              />
              <div className="mt-4">
                <SiteActivityList entries={location.activity} />
              </div>
            </section>
          )}
        </>
      ) : (
        <section className={SECTION}>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            The {TABS.find((item) => item.value === tab)?.label} tab is not built yet.
          </p>
        </section>
      )}
    </Card>
  );
}
