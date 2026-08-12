import { useState } from 'react';
import { StaffProfileView } from '@/components/staff/StaffProfileView';
import { DEMO_PROFILE } from '@/lib/staffDemo';
import type { StaffProfileTab } from '@/lib/staffProfile';

/**
 * Design-loop preview only. The real profile route needs a Supabase session
 * and a seeded staff record. Reproduces
 * `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.staffDetail` against the
 * fixtures in `src/lib/staffDemo.ts`.
 */
const VALID_TABS: StaffProfileTab[] = [
  'overview',
  'shifts',
  'documents',
  'emergency_contacts',
  'leave',
  'activity',
];

export function StaffProfilePreviewPage(): JSX.Element {
  const requested = new URLSearchParams(window.location.search).get(
    'tab',
  ) as StaffProfileTab | null;
  const initial = requested && VALID_TABS.includes(requested) ? requested : 'overview';
  const [tab, setTab] = useState<StaffProfileTab>(initial);

  return (
    <div className="min-h-screen bg-background px-8 py-6 dark:bg-background-dark">
      <StaffProfileView
        profile={DEMO_PROFILE}
        tab={tab}
        onTabChange={setTab}
        backTo="/staff-preview"
        onAction={() => undefined}
        onUploadDocument={() => undefined}
        onAddEmergencyContact={() => undefined}
      />
    </div>
  );
}
