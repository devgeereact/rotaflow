import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import type { ProfileEmergencyContact } from '@/lib/staffProfile';

interface EmergencyContactsCardProps {
  contacts: ProfileEmergencyContact[];
  onAdd: () => void;
}

/**
 * Lives on Overview, not its own tab — the person a manager needs to reach
 * in an actual emergency should be one glance away, not behind a tab
 * nobody thinks to open until the day they need it.
 */
export function EmergencyContactsCard({
  contacts,
  onAdd,
}: EmergencyContactsCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title="Emergency Contacts"
        action={<StaffLinkButton onClick={onAdd}>Add</StaffLinkButton>}
      />
      {contacts.length === 0 ? (
        <p className="mt-4 text-sm text-content-muted dark:text-content-muted-dark">
          None on file.
        </p>
      ) : (
        <ul className="mt-3.5 space-y-3">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-content dark:text-content-dark">
                {contact.name}
              </span>
              <span className="text-content-muted dark:text-content-muted-dark">
                {contact.relationship}
              </span>
              <span className="ml-auto font-mono text-content dark:text-content-dark">
                {contact.phone}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3.5 text-xs text-content-muted dark:text-content-muted-dark">
        Visible to managers only, and never included in an export.
      </p>
    </Card>
  );
}
