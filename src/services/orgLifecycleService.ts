import { api, orgPath } from '@/lib/api';
import { getOrganisation } from '@/services/orgService';
import type { Organisation } from '@/types';

/**
 * Exporting and deleting a whole organisation.
 *
 * Kept apart from `orgService`, which is the everyday CRUD an owner does
 * dozens of times. These two are the end of the tenant's life: one is the
 * only copy of their data they will ever get, the other is irreversible and
 * unbacked. Grouping them makes the ordering — export, then confirm, then
 * delete — visible in one file rather than implied across a settings page.
 */

/** What a deletion is about to destroy, for the confirmation dialog. */
export interface OrganisationDeletionPreview {
  staffProfiles: number;
  locations: number;
  rotas: number;
  shifts: number;
  clockEvents: number;
  leaveRequests: number;
  documents: number;
  members: number;
}

export async function organisationDeletionPreview(
  orgId: string,
): Promise<OrganisationDeletionPreview | null> {
  const r = await api.get<{ preview: Record<string, number> }>(
    orgPath(orgId, '/deletion-preview'),
  );
  const n = (k: string): number => Number(r.preview[k] ?? 0);
  return {
    staffProfiles: n('staff_profiles'),
    locations: n('locations'),
    rotas: n('rotas'),
    shifts: n('shifts'),
    clockEvents: n('clock_events'),
    leaveRequests: n('leave_requests'),
    // Documents arrive with compliance (S10); none can exist before it.
    documents: n('documents'),
    members: n('memberships'),
  };
}

/**
 * Delete an organisation and everything scoped to it.
 *
 * `confirmName` must equal the organisation's name exactly; the database
 * checks it, not this call. Five triggers used to make this impossible
 * (BUG-009) — see `0063_delete_organisation.sql` for which, and why the fix
 * is an exemption the guards understand rather than turning them off.
 *
 * Irreversible, and this project has no point-in-time recovery. Do not call
 * it without offering `exportOrganisationData` first.
 */
export async function deleteOrganisation(
  orgId: string,
  confirmName: string,
): Promise<void> {
  // The name must match exactly; the API removes every row and queues every stored file for deletion.
  await api.post(orgPath(orgId, '/delete'), { confirm_name: confirmName });
}

/**
 * Every table in the export, in the order a human would read them.
 *
 * Listed as data rather than written out as awaited calls so the set is
 * reviewable: the risk in an export is a table quietly missing from it, and
 * that is much easier to spot in a list than in a paragraph of code.
 *
 * ## It was materially incomplete until 2026-08-31
 *
 * Nineteen tables, against forty that carry an `org_id`. Missing were the
 * organisation's **invoices**, its staff **inboxes and delivery record**, its
 * **minimum-cover rules**, its **integration configuration and history**, its
 * own **GDPR request log**, its **support cases**, and the record of when
 * platform staff had **support access to its data** — that last being exactly
 * the sort of thing a customer is entitled to a copy of. Five more tables
 * added the same day (pay rates, sites, delegations, templates) would have
 * joined them.
 *
 * `scripts/check-export-coverage.mjs` now fails CI when a table with an
 * `org_id` is in neither this list nor `DELIBERATELY_EXCLUDED`, so the next
 * table cannot be forgotten the way these were.
 */
const EXPORTED_TABLES = [
  'locations',
  'departments',
  'staff_profiles',
  'staff_locations',
  'staff_pay_rates',
  'shift_types',
  'job_titles',
  'rotas',
  'shifts',
  'minimum_cover_rules',
  'availability',
  'leave_requests',
  'overtime_requests',
  'shift_swaps',
  'clock_events',
  'clock_event_corrections',
  'timesheets',
  'emergency_contacts',
  'documents',
  'announcements',
  'announcement_reads',
  'notifications',
  'notification_deliveries',
  'notification_templates',
  'invites',
  'memberships',
  'role_delegations',
  'audit_logs',
  'gdpr_requests',
  'support_cases',
  'support_access_sessions',
  'org_integrations',
  'integration_sync_runs',
  'subscriptions',
  'invoices',
  // A credit is money the customer is owed back against an invoice they
  // hold, so it belongs in their export beside the invoice itself (0149).
  'invoice_credits',
] as const;

type ExportedTable = (typeof EXPORTED_TABLES)[number];

/**
 * Tables with an `org_id` that are deliberately NOT exported, and why.
 *
 * Read by the coverage gate, and repeated to the reader in `notes` below —
 * an export that silently omits something is the failure this whole file is
 * organised against, so the omissions are part of the output.
 */
export const DELIBERATELY_EXCLUDED: readonly { table: string; reason: string }[] = [
  {
    table: 'billing_events',
    reason:
      'A ledger of which webhook deliveries Stripe has made and whether they finished (0125). It is operational plumbing, not your data: the invoices and subscription states those events produced are exported, and they are the record that means anything to you. It also carries no personal data at all.',
  },
  {
    table: 'storage_deletions',
    reason:
      'A queue of stored files waiting to be removed from Storage after their record, person or organisation was deleted (0159). It is server plumbing, readable by no signed-in user, and the records it refers to have already gone.',
  },
  {
    table: 'org_smtp_settings',
    reason:
      'Contains the SMTP password for your own mailbox. Exporting a live credential into a file that gets emailed around is a worse outcome than an incomplete export; the settings are on your Integrations screen.',
  },
  {
    table: 'calendar_feed_tokens',
    reason:
      "Each row IS a live credential — the URL that lets a calendar read one person's shifts. Anyone who opened this file could read those rotas. Each person can see and rotate their own from their account screen.",
  },
  {
    table: 'notification_outbox',
    reason:
      'A dispatch queue that empties within a minute, not a record of anything. What was actually sent is in `notification_deliveries`, which is included.',
  },
  {
    table: 'background_jobs',
    reason: 'Platform scheduling, not your data.',
  },
  {
    table: 'feature_flag_targets',
    reason: 'Which platform features are switched on for you. Ours, not yours.',
  },
  {
    table: 'platform_announcement_deliveries',
    reason: 'Whether we managed to deliver a message from us to you.',
  },
  {
    table: 'platform_announcement_optouts',
    reason: 'Which of our platform messages you have muted.',
  },
];

export interface OrganisationExport {
  exportedAt: string;
  organisation: Organisation;
  tables: Record<ExportedTable, unknown[]>;
  /** Tables the reader's own permissions kept out of the file. */
  omitted: { table: string; reason: string }[];
  notes: string[];
}

/**
 * Where a table is READ from, when that is not the table itself.
 *
 * `0150` revoked `select` on `staff_profiles.payroll_id`, `start_date`,
 * `phone`, `email` and `holiday_allowance` from `authenticated`, so
 * `select('*')` on the base table is now refused outright — 42501, for
 * everyone, owner included, because column privileges are held per role and
 * not per person. The loop below caught that error and listed the table under
 * `omitted`, which meant every export shipped with an EMPTY staff table and a
 * footnote. A workforce product's export without its workforce is not a
 * portability answer.
 *
 * So the staff rows come from `staff_profiles_visible`, the view `0150` added.
 * The export screen is owner-only (`SettingsOrganisationPage` renders
 * `OwnerOnlyNotice` for anyone else), and the view returns all five columns
 * unmasked to an owner or manager of that organisation, so the file holds the
 * same rows it held before `0150`. The output key stays `staff_profiles`: the
 * customer's file should not change shape because of where we read it.
 *
 * Read this as the general rule, not a special case. When a base table stops
 * granting `select` on every column, the loop below needs the same branch for
 * it — otherwise the export loses it quietly. It is a branch rather than a
 * lookup table because the generated client types tables and views as
 * separate overloads of `from`, and a union of the two satisfies neither.
 */
/**
 * Where each exported table is read from. Each is the API's own list route, read with the exporter's own
 * permissions; a table with no route is listed under `omitted` with the reason, never left out silently.
 */
const SOURCES: Partial<
  Record<ExportedTable, { path: string; key: string; query?: Record<string, string> }>
> = {
  locations: { path: '/locations', key: 'locations' },
  departments: { path: '/departments', key: 'departments' },
  staff_profiles: { path: '/staff', key: 'staff' },
  shift_types: { path: '/shift-types', key: 'shift_types' },
  job_titles: { path: '/job-titles', key: 'job_titles' },
  rotas: { path: '/rotas', key: 'rotas' },
  minimum_cover_rules: { path: '/minimum-cover', key: 'rules' },
  availability: { path: '/availability', key: 'availability' },
  leave_requests: { path: '/leave', key: 'leave' },
  overtime_requests: { path: '/overtime', key: 'overtime' },
  shift_swaps: { path: '/swaps', key: 'swaps' },
  clock_events: { path: '/clock-events', key: 'clock_events', query: { limit: '1000' } },
  timesheets: { path: '/timesheets', key: 'timesheets' },
  announcements: { path: '/announcements', key: 'announcements' },
  invites: { path: '/invites', key: 'invites' },
  memberships: { path: '/members', key: 'members' },
  role_delegations: { path: '/delegations', key: 'delegations' },
  audit_logs: { path: '/audit', key: 'entries', query: { limit: '100' } },
  gdpr_requests: { path: '/gdpr', key: 'requests' },
  support_access_sessions: { path: '/support-sessions', key: 'sessions' },
  invoices: { path: '/billing', key: 'invoices' },
};

export async function exportOrganisationData(orgId: string): Promise<OrganisationExport> {
  const organisation = await getOrganisation(orgId);
  const tables = {} as Record<ExportedTable, unknown[]>;
  const omitted: { table: string; reason: string }[] = [];

  for (const table of EXPORTED_TABLES) {
    const source = SOURCES[table];
    if (!source) {
      tables[table] = [];
      omitted.push({ table, reason: 'Not available from the API in this release.' });
      continue;
    }
    try {
      const r = await api.get<Record<string, unknown[]>>(
        orgPath(orgId, source.path),
        source.query,
      );
      tables[table] = r[source.key] ?? [];
    } catch (error) {
      tables[table] = [];
      omitted.push({
        table,
        reason: error instanceof Error ? error.message : 'Could not be read.',
      });
    }
  }
  // Shifts are read per rota, at most 50 rotas a request.
  try {
    const rotaIds = (tables.rotas as { id: string }[]).map((r) => r.id);
    const shifts: unknown[] = [];
    for (let i = 0; i < rotaIds.length; i += 50) {
      const r = await api.get<{ shifts: unknown[] }>(orgPath(orgId, '/shifts'), {
        rota_ids: rotaIds.slice(i, i + 50).join(','),
      });
      shifts.push(...r.shifts);
    }
    tables.shifts = shifts;
    const pending = omitted.findIndex((o) => o.table === 'shifts');
    if (pending >= 0) omitted.splice(pending, 1);
  } catch (error) {
    omitted.push({
      table: 'shifts',
      reason: error instanceof Error ? error.message : 'Could not be read.',
    });
  }

  return {
    exportedAt: new Date().toISOString(),
    organisation,
    tables,
    omitted,
    notes: [
      'Every row scoped to this organisation, read with your own permissions. A table that cannot be read is listed under "omitted" with the reason, rather than left out silently.',
      'Staff records carry payroll id, start date, phone, email and holiday allowance only for an owner or manager of this organisation, or for the person the record is about, so they are present in an export an owner runs and blank in one run by anybody else.',
      'Files themselves are not included. Deleting the organisation deletes every stored file, so download anything you need to keep first.',
      "Staff accounts are not included. A person's RotaFlow login can belong to more than one organisation, so it is not this organisation's to export. Their employment record with you is in `staff_profiles` and the tables around it.",
      "Audit rows survive the organisation being deleted, by design: an audit trail a tenant deletion erases is not an audit trail. They are kept with the organisation's name and no longer linked to it.",
      ...DELIBERATELY_EXCLUDED.map(
        (excluded) => `Not included — ${excluded.table}: ${excluded.reason}`,
      ),
    ],
  };
}
