import { useState } from 'react';
import { TeamDirectoryView } from '@/components/staff/TeamDirectoryView';
import type { TeamRow } from '@/lib/teamRows';
import { PreviewCanvas } from '@/components/ui/PreviewCanvas';
import { FilterBar } from '@/components/ui/FilterBar';
import type { FilterDimension, FilterOption } from '@/lib/filters';

/**
 * The preview drives only the search box: the real screen's site, department
 * and job-title options come from the tenant, and a preview inventing them
 * would be showing a control that filters nothing.
 */
const PREVIEW_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text', sensitive: true },
] as const;

const optionsFor = (): readonly FilterOption[] => [];

const ROWS: TeamRow[] = [
  {
    id: 's1',
    firstName: 'Amara',
    lastName: 'Osei',
    photoUrl: null,
    jobTitle: 'Senior Carer',
    jobTitleId: null,
    jobTitleColour: null,
    jobTitleArchived: false,
    department: 'Nursing',
    location: 'Sunnyvale House',
    locationIds: [],
    contractHoursLabel: '37.5h',
    rosteredHoursLabel: '36.0h',
    todayStatus: 'on_shift',
    active: true,
  },
  {
    id: 's2',
    firstName: 'Callum',
    lastName: 'Reid',
    photoUrl: null,
    jobTitle: 'Care Assistant',
    jobTitleId: null,
    jobTitleColour: null,
    jobTitleArchived: false,
    department: 'Care',
    location: 'Riverside House',
    locationIds: [],
    contractHoursLabel: '30.0h',
    rosteredHoursLabel: '30.0h',
    todayStatus: 'off',
    active: true,
  },
  {
    id: 's3',
    firstName: 'Priya',
    lastName: 'Raman',
    photoUrl: null,
    jobTitle: 'Senior Nurse',
    jobTitleId: null,
    jobTitleColour: null,
    jobTitleArchived: false,
    department: 'Nursing',
    location: 'Sunnyvale House',
    locationIds: [],
    contractHoursLabel: '37.5h',
    rosteredHoursLabel: '0.0h',
    todayStatus: 'absent',
    active: true,
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/team` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `TeamDirectoryView` against fixed mock data
 * shaped to match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`.
 */
export function StaffPreviewPage(): JSX.Element {
  const [search, setSearch] = useState('');

  const filtered = ROWS.filter((r) => {
    if (
      search.trim() &&
      !`${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <PreviewCanvas>
      <TeamDirectoryView
        orgName="Sunnyvale Care Group"
        tiles={{
          teamMembers: 12,
          onShiftToday: 7,
          absentToday: 1,
          onLeaveToday: 2,
          documentsExpiring: 3,
          invitesOutstanding: 2,
        }}
        outcome={filtered.length === 0 ? 'no-match' : 'rows'}
        filters={
          <FilterBar
            dimensions={PREVIEW_FILTERS}
            filters={{ q: search ? [search] : [] }}
            optionsFor={optionsFor}
            onSetValue={(_, value) => setSearch(value)}
            onSetValues={(_, values) => setSearch(values[0] ?? '')}
            onClearOne={() => setSearch('')}
            onClearAll={() => setSearch('')}
            searchPlaceholder="Search name, job title or site"
            resultSummary={`Showing ${filtered.length} of ${ROWS.length}`}
          />
        }
        rows={filtered}
        totalRowCount={ROWS.length}
        onClearFilters={() => setSearch('')}
        onRetry={() => {}}
        onOpenActions={() => {}}
        onExport={() => {}}
        onAddStaff={() => {}}
      />
    </PreviewCanvas>
  );
}
