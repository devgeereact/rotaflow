import type { Organisation } from '@/types';

/**
 * Typed readers over `organisations.settings`, which is a free-form `jsonb`.
 *
 * ## Why a whole module for "read a key"
 *
 * Onboarding, the Organisation screen, Roles, Policies and Notifications all
 * write into the same untyped blob. Nothing stops one of them storing
 * `week_start: "Monday"` while another reads `week_starts_on: 1`, and no
 * typecheck, lint or test would notice. The value simply reads back empty and
 * the screen shows its default. That is a silent-wrong-value bug class, and it
 * is the same one `audit01` §7b found in the timesheet code.
 *
 * So every key lives here once, with its parser and its default. Screens never
 * index the blob directly.
 *
 * These are **preferences**, not enforcement. Nothing in this file constrains
 * what the database will accept, an overtime threshold set to 30 hours does
 * not stop a 40-hour week being written. The policy *engine* that would do
 * that is a separate project (audit01 §4 Tier 3); this is the settings surface
 * it will read from when it exists, which is why the shapes are worth getting
 * right now rather than later.
 */

type Json = Organisation['settings'];

function record(settings: Json): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  return settings;
}

function str(settings: Json, key: string, fallback = ''): string {
  const value = record(settings)[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function num(settings: Json, key: string, fallback: number): number {
  const value = record(settings)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Onboarding wrote some numeric fields through a text input, so a numeric
  // string is a real stored shape and not a bug to reject.
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return fallback;
}

function bool(settings: Json, key: string, fallback: boolean): boolean {
  const value = record(settings)[key];
  return typeof value === 'boolean' ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * Role display labels. Design/SettingsOrganisation.png, "Role Display
 * Labels".
 * ------------------------------------------------------------------ */

/**
 * `memberships.role` is a fixed three-value CHECK (`owner | manager | staff`)
 * and the reference shows seven role rows (Team Leader, Senior Carer, HR
 * Advisor…). The schema cannot represent those as real roles, and inventing a
 * `roles` table is a migration plus an RLS rewrite, not a screen.
 *
 * What the design actually asks for on this card is narrower than it looks:
 * a **display label** per system role, "Customise how roles are shown across
 * the platform". That is presentation, it is genuinely useful (a care home
 * calls a manager a "Deputy Manager"), and it fits the existing schema exactly.
 *
 * So this ships as relabelling of the three real roles. Custom roles with
 * their own permissions remain a schema decision. Flagged on the screen so
 * nobody mistakes a renamed `manager` for a new permission set.
 */
export const SYSTEM_ROLES = ['owner', 'manager', 'staff'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const DEFAULT_ROLE_LABELS: Record<SystemRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

export function roleLabels(settings: Json): Record<SystemRole, string> {
  const stored = record(settings)['role_labels'];
  const source =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  return {
    owner:
      typeof source['owner'] === 'string' && source['owner']
        ? source['owner']
        : DEFAULT_ROLE_LABELS.owner,
    manager:
      typeof source['manager'] === 'string' && source['manager']
        ? source['manager']
        : DEFAULT_ROLE_LABELS.manager,
    staff:
      typeof source['staff'] === 'string' && source['staff']
        ? source['staff']
        : DEFAULT_ROLE_LABELS.staff,
  };
}

/* ------------------------------------------------------------------ *
 * Scheduling policies. Design/Settingspolicy.png, reduced to the rules
 * the current schema can actually express.
 * ------------------------------------------------------------------ */

export interface SchedulingPolicies {
  /** Weekly hours after which time counts as overtime. */
  overtimeThresholdHours: number;
  /** Minimum rest between the end of one shift and the start of the next. */
  minRestHours: number;
  /** Maximum consecutive days a person may be rostered. */
  maxConsecutiveDays: number;
  /** Weekly hours a rota may not roster a person past. */
  maxWeeklyHours: number;
  /** Whether break time is deducted from paid hours. */
  breaksArePaid: boolean;
  /** Clock times are rounded to this many minutes on a timesheet. */
  roundingMinutes: number;
  /** How many days ahead a rota should be published. */
  publishLeadDays: number;
  /**
   * Whether a manager must approve every agreed swap. When false, a named
   * colleague's acceptance plus the requester's own final say
   * (`shift_swaps_requester_finalize`, 0043) is enough — see
   * `SwapsPage.tsx`'s `handleColleagueDecision`/`handleFinalize`.
   */
  swapApprovalRequired: boolean;
  /** Whether leave that would drop a day under minimum cover auto-declines rather than just warning. */
  autoDeclineClashingLeave: boolean;
}

export const DEFAULT_POLICIES: SchedulingPolicies = {
  overtimeThresholdHours: 37.5,
  minRestHours: 11,
  maxConsecutiveDays: 6,
  maxWeeklyHours: 48,
  breaksArePaid: false,
  roundingMinutes: 15,
  publishLeadDays: 14,
  swapApprovalRequired: true,
  autoDeclineClashingLeave: false,
};

export function schedulingPolicies(settings: Json): SchedulingPolicies {
  return {
    overtimeThresholdHours: num(
      settings,
      'overtime_threshold_hours',
      DEFAULT_POLICIES.overtimeThresholdHours,
    ),
    minRestHours: num(settings, 'min_rest_hours', DEFAULT_POLICIES.minRestHours),
    maxConsecutiveDays: num(
      settings,
      'max_consecutive_days',
      DEFAULT_POLICIES.maxConsecutiveDays,
    ),
    maxWeeklyHours: num(settings, 'max_weekly_hours', DEFAULT_POLICIES.maxWeeklyHours),
    breaksArePaid: bool(settings, 'breaks_are_paid', DEFAULT_POLICIES.breaksArePaid),
    roundingMinutes: num(settings, 'rounding_minutes', DEFAULT_POLICIES.roundingMinutes),
    publishLeadDays: num(settings, 'publish_lead_days', DEFAULT_POLICIES.publishLeadDays),
    swapApprovalRequired: bool(
      settings,
      'swap_approval_required',
      DEFAULT_POLICIES.swapApprovalRequired,
    ),
    autoDeclineClashingLeave: bool(
      settings,
      'auto_decline_clashing_leave',
      DEFAULT_POLICIES.autoDeclineClashingLeave,
    ),
  };
}

export function policiesToSettings(p: SchedulingPolicies): Record<string, unknown> {
  return {
    overtime_threshold_hours: p.overtimeThresholdHours,
    min_rest_hours: p.minRestHours,
    max_consecutive_days: p.maxConsecutiveDays,
    max_weekly_hours: p.maxWeeklyHours,
    breaks_are_paid: p.breaksArePaid,
    rounding_minutes: p.roundingMinutes,
    publish_lead_days: p.publishLeadDays,
    swap_approval_required: p.swapApprovalRequired,
    auto_decline_clashing_leave: p.autoDeclineClashingLeave,
  };
}

/* ------------------------------------------------------------------ *
 * Organisation notification defaults. Design/SettingsNotifications.png.
 * ------------------------------------------------------------------ */

/**
 * The events RotaFlow can notify on today. Each one corresponds to a real
 * dispatch site in the app, so this list stays honest: nothing here is a
 * notification the product cannot send.
 */
export const NOTIFICATION_EVENTS = [
  { key: 'rota_published', label: 'Rota published', hint: 'When a new rota goes live' },
  { key: 'shift_reminder', label: 'Shift reminders', hint: 'Before an upcoming shift' },
  {
    key: 'swap_requests',
    label: 'Swap requests',
    hint: 'New swap requests and outcomes',
  },
  { key: 'leave_updates', label: 'Leave updates', hint: 'Leave approvals and changes' },
  { key: 'announcements', label: 'Announcements', hint: 'Important org announcements' },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]['key'];

/**
 * Channels. **SMS is deliberately absent** even though the reference shows an
 * SMS column: there is no SMS provider in the stack, no table recording
 * delivery, and no Edge Function that could send one. A toggle a customer can
 * switch on that silently sends nothing is worse than no toggle. They would
 * believe their staff were texted.
 */
export const NOTIFICATION_CHANNELS = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
] as const;

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number]['key'];

export type NotificationMatrix = Record<
  NotificationEventKey,
  Record<NotificationChannelKey, boolean>
>;

export function defaultNotificationMatrix(): NotificationMatrix {
  const matrix = {} as NotificationMatrix;
  for (const event of NOTIFICATION_EVENTS) {
    matrix[event.key] = { in_app: true, email: true, push: true };
  }
  return matrix;
}

export function notificationMatrix(settings: Json): NotificationMatrix {
  const stored = record(settings)['notification_defaults'];
  const source =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  const matrix = defaultNotificationMatrix();
  for (const event of NOTIFICATION_EVENTS) {
    const row = source[event.key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const typed = row as Record<string, unknown>;
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = typed[channel.key];
      if (typeof value === 'boolean') matrix[event.key][channel.key] = value;
    }
  }
  return matrix;
}

/* ------------------------------------------------------------------ *
 * Organisation profile fields shared with onboarding.
 * ------------------------------------------------------------------ */

export interface OrgProfileFields {
  industry: string;
  orgType: string;
  country: string;
  timezone: string;
  workingWeek: string;
  phone: string;
  website: string;
  addressLine: string;
  registrationNo: string;
  contactEmail: string;
  primaryContact: string;
  dateFormat: string;
  currency: string;
}

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;

export const CURRENCIES = [
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'USD', label: 'USD ($)' },
] as const;

export function orgProfileFields(settings: Json): OrgProfileFields {
  return {
    industry: str(settings, 'industry'),
    orgType: str(settings, 'org_type'),
    country: str(settings, 'country', 'United Kingdom'),
    timezone: str(settings, 'timezone', 'Europe/London'),
    workingWeek: str(settings, 'working_week', 'mon-sun'),
    phone: str(settings, 'phone'),
    website: str(settings, 'website'),
    addressLine: str(settings, 'address_line'),
    registrationNo: str(settings, 'registration_no'),
    contactEmail: str(settings, 'contact_email'),
    primaryContact: str(settings, 'primary_contact'),
    dateFormat: str(settings, 'date_format', DATE_FORMATS[0]),
    currency: str(settings, 'currency', CURRENCIES[0].value),
  };
}
