import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import {
  AddExceptionModal,
  type AddExceptionInput,
} from '@/components/availability/AddExceptionModal';
import type { ExceptionRow, WeeklyPatternDay } from '@/lib/availabilityRows';

export interface TeamAvailabilityDisplayRow {
  staffId: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  available: boolean;
}

export interface AvailabilityViewProps {
  weekPattern: WeeklyPatternDay[];
  onToggleDay: (day: WeeklyPatternDay) => void;
  togglingWeekday: number | null;
  exceptions: ExceptionRow[];
  onAddException: (input: AddExceptionInput) => Promise<void>;
  removingExceptionId: string | null;
  onRemoveException: (id: string) => void;
  /** null for a non-manager, who never sees this card. */
  team: { todayLabel: string; rows: TeamAvailabilityDisplayRow[] } | null;
}

/**
 * `/app/availability` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.availability`): one screen for everyone, not a role split — a
 * manager just gets the extra "Team availability" card alongside their own
 * pattern, same as the reference.
 */
export function AvailabilityView({
  weekPattern,
  onToggleDay,
  togglingWeekday,
  exceptions,
  onAddException,
  removingExceptionId,
  onRemoveException,
  team,
}: AvailabilityViewProps): JSX.Element {
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  return (
    <div>
      <WorkspaceHeader
        title="Availability"
        subtitle="Your standing weekly pattern. The rota builder reads this before it suggests anyone for a shift, so keeping it current is the cheapest way to avoid a rota you cannot work."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Add exception
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Your weekly pattern
            </h2>
          </div>
          <div className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {weekPattern.map((day) => (
              <div key={day.weekday} className="flex items-center gap-3 px-4 py-3">
                <span className="w-10 shrink-0 font-semibold text-content dark:text-content-dark">
                  {day.label}
                </span>
                <Badge tone={day.available ? 'success' : 'neutral'} dot>
                  {day.available ? 'Available' : 'Unavailable'}
                </Badge>
                {day.note && (
                  <span className="text-xs text-content-muted dark:text-content-muted-dark">
                    {day.note}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  disabled={togglingWeekday === day.weekday}
                  onClick={() => onToggleDay(day)}
                >
                  Change
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6 content-start">
          <Card className="p-0">
            <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Exceptions
              </h2>
            </div>
            {exceptions.length === 0 ? (
              <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
                No exceptions on file.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Availability</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
                    {exceptions.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2.5 text-content dark:text-content-dark">
                          {row.dateLabel}
                        </td>
                        <td className="px-4 py-2.5 text-content dark:text-content-dark">
                          {row.availabilityLabel}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onRemoveException(row.id)}
                            disabled={removingExceptionId === row.id}
                            aria-label={`Remove exception for ${row.dateLabel}`}
                            className="rounded p-1 text-content-muted hover:text-danger disabled:opacity-40 dark:text-content-muted-dark"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {team && (
            <Card className="p-0">
              <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
                <h2 className="font-semibold text-content dark:text-content-dark">
                  Team availability, {team.todayLabel}
                </h2>
              </div>
              {team.rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No other staff to show.
                </p>
              ) : (
                <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                  {team.rows.map((row) => (
                    <li
                      key={row.staffId}
                      className="flex items-center gap-2.5 px-4 py-2.5"
                    >
                      <StaffAvatar
                        firstName={row.firstName}
                        lastName={row.lastName}
                        photoUrl={row.photoUrl}
                        size="sm"
                      />
                      <span className="text-content dark:text-content-dark">
                        {row.firstName} {row.lastName}
                      </span>
                      <Badge
                        tone={row.available ? 'success' : 'neutral'}
                        dot
                        className="ml-auto"
                      >
                        {row.available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      <AddExceptionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        busy={addBusy}
        onConfirm={(input) => {
          setAddBusy(true);
          void onAddException(input).finally(() => {
            setAddBusy(false);
            setAddOpen(false);
          });
        }}
      />
    </div>
  );
}
