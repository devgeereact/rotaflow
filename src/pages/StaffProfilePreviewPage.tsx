import { useState } from 'react';
import { StaffProfileView } from '@/components/staff/StaffProfileView';
import { DEMO_PROFILE } from '@/lib/staffDemo';
import type { StaffProfileTab } from '@/lib/staffProfile';

/**
 * Design-loop preview only. The real profile route needs a Supabase session
 * and a seeded staff record. Reproduces design/Staff-Profile.png against the
 * fixtures in `src/lib/staffDemo.ts`; see design/.loop/staff-log.md.
 */
export function StaffProfilePreviewPage(): JSX.Element {
  const [tab, setTab] = useState<StaffProfileTab>('overview');

  return (
    <div className="min-h-screen bg-background px-8 py-6 dark:bg-background-dark">
      <StaffProfileView
        profile={DEMO_PROFILE}
        tab={tab}
        onTabChange={setTab}
        backTo="/staff-preview"
        onAction={() => undefined}
      />
    </div>
  );
}
