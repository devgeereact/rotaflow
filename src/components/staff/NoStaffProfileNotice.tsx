import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { usePermissions } from '@/hooks/usePermissions';

interface NoStaffProfileNoticeProps {
  /** What the absent staff record prevents, e.g. "clock in" or "set a pattern". */
  activity: string;
}

/**
 * Shown when the signed-in user has a membership but no `staff_profiles` row.
 *
 * `handle_new_org` (`0002`) creates a membership and stops, and no function in
 * `public` ever inserts into `staff_profiles` — the HR record is made by hand
 * through `/app/team` → Add staff, and `0053`'s trigger links it to the account
 * by email. So the very first person in a new organisation always lands here,
 * and so does anyone who accepts an invite before their record exists.
 *
 * Until 5 September 2026 both screens said "Ask your manager to add you to the
 * staff directory" to everybody (docs/SAAS.md GAP-068). For the owner setting
 * the organisation up that is advice to ask themselves, with no route to the
 * screen that would fix it — the dead end a new customer hits first, on the
 * strength of screens the register marks complete. Anyone who can manage staff
 * now gets the action instead of the instruction.
 */
export function NoStaffProfileNotice({
  activity,
}: NoStaffProfileNoticeProps): JSX.Element {
  const { canManageStaff } = usePermissions();

  return (
    <Card>
      <EmptyState
        icon={UserPlus}
        title="You don't have a staff profile here"
        description={
          canManageStaff
            ? `A staff record is what shifts, leave and attendance attach to, so there is no way to ${activity} without one. Add yourself to the staff directory using the email address you signed in with, and it will link to this account automatically.`
            : `A staff record is what shifts, leave and attendance attach to, so there is no way to ${activity} without one. Ask your manager to add you to the staff directory.`
        }
        action={
          canManageStaff ? (
            <Link to="/app/team">
              <Button>Go to the staff directory</Button>
            </Link>
          ) : undefined
        }
      />
    </Card>
  );
}
