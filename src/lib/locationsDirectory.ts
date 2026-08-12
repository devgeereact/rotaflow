/**
 * View model for `/app/locations` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.locations`).
 */

/** `locations.status` (0045). 'setup' is the default for a freshly created site. */
export type SiteStatus = 'setup' | 'active' | 'maintenance' | 'inactive';

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  setup: 'In setup',
  active: 'Active',
  maintenance: 'Maintenance',
  inactive: 'Inactive',
};

export interface LocationRow {
  id: string;
  name: string;
  address: string;
  /** 'Residential' | 'Dementia care' | 'Domiciliary' | 'Head office', or null when unset. */
  type: string | null;
  status: SiteStatus;
  staff: number;
  departmentIds: string[];
  departmentNames: string[];
  /**
   * `null` when no `minimum_cover_rules` row exists for this site at all.
   * Otherwise a short summary — the reference's own "6 on days · 3 on
   * nights" has no day/night axis in this schema (0036 is one number per
   * weekday), so this reads the real spread instead of inventing one.
   */
  minimumCoverSummary: string | null;
}
