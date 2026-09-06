import type { Database } from '@/types/database.types';

/** Convenience row aliases used across the app. */
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type AppSettings = Database['public']['Tables']['app_settings']['Row'];
export type AppSettingsUpdate = Database['public']['Tables']['app_settings']['Update'];

export type ThemeMode = 'dark' | 'light';

/** RotaFlow domain rows (see docs/SCHEMA.md). */
export type Organisation = Database['public']['Tables']['organisations']['Row'];
export type OrganisationInsert = Database['public']['Tables']['organisations']['Insert'];
export type OrganisationUpdate = Database['public']['Tables']['organisations']['Update'];

export type MembershipRole = 'owner' | 'manager' | 'staff';
export type Membership = Database['public']['Tables']['memberships']['Row'];

/**
 * Platform administration roles (0015_platform_roles.sql).
 *
 * Deliberately a separate union from `MembershipRole`, not an extension of it.
 * Organisation permissions control access to one customer's workspace;
 * platform permissions control RotaFlow-wide administration. Conflating them
 * would hand every customer's owner the keys to every other customer's data,
 * which is why Super Admin has never been a fourth membership role.
 */
export type PlatformRole =
  'platform_owner' | 'platform_admin' | 'platform_support' | 'platform_finance';
export type PlatformAdmin = Database['public']['Tables']['platform_admins']['Row'];

export type PlatformSettings = Database['public']['Tables']['platform_settings']['Row'];
export type PlatformSettingsUpdate =
  Database['public']['Tables']['platform_settings']['Update'];

/**
 * `organisations.status` CHECK (0017).
 *
 * A billing and account state, **not** a lockout: no RLS policy consults it,
 * so a suspended organisation's staff keep signing in and clocking in. The
 * console must say so rather than implying enforcement it does not have.
 */
export type OrganisationStatus = 'active' | 'suspended' | 'archived';

export type StaffProfile = Database['public']['Tables']['staff_profiles']['Row'];
export type StaffProfileInsert = Database['public']['Tables']['staff_profiles']['Insert'];
export type StaffProfileUpdate = Database['public']['Tables']['staff_profiles']['Update'];

/**
 * An organisation's job-title catalogue (`0127`).
 *
 * `name_normalised` is a generated column and therefore absent from Insert
 * and Update — the database computes the comparison form, so no caller can
 * put a display name and its normalised form out of step.
 */
export type JobTitle = Database['public']['Tables']['job_titles']['Row'];
export type JobTitleInsert = Database['public']['Tables']['job_titles']['Insert'];
export type JobTitleUpdate = Database['public']['Tables']['job_titles']['Update'];

export type ShiftType = Database['public']['Tables']['shift_types']['Row'];
export type ShiftTypeInsert = Database['public']['Tables']['shift_types']['Insert'];
export type ShiftTypeUpdate = Database['public']['Tables']['shift_types']['Update'];

export type Rota = Database['public']['Tables']['rotas']['Row'];
export type RotaInsert = Database['public']['Tables']['rotas']['Insert'];
export type RotaUpdate = Database['public']['Tables']['rotas']['Update'];

export type Shift = Database['public']['Tables']['shifts']['Row'];
export type ShiftInsert = Database['public']['Tables']['shifts']['Insert'];
export type ShiftUpdate = Database['public']['Tables']['shifts']['Update'];

export type Availability = Database['public']['Tables']['availability']['Row'];
export type AvailabilityInsert = Database['public']['Tables']['availability']['Insert'];

export type ClockEvent = Database['public']['Tables']['clock_events']['Row'];
export type ClockEventInsert = Database['public']['Tables']['clock_events']['Insert'];
/**
 * Append-only correction history for a clock event (`0128`).
 *
 * There is no Insert or Update alias, deliberately: `correct_clock_event` is
 * the only writer and the client holds no grant, so a type that suggested a
 * direct write would describe something the database refuses.
 */
export type ClockEventCorrection =
  Database['public']['Tables']['clock_event_corrections']['Row'];

export type LeaveRequest = Database['public']['Tables']['leave_requests']['Row'];
export type LeaveRequestInsert = Database['public']['Tables']['leave_requests']['Insert'];

export type OvertimeRequest = Database['public']['Tables']['overtime_requests']['Row'];
export type OvertimeRequestInsert =
  Database['public']['Tables']['overtime_requests']['Insert'];

export type ShiftSwap = Database['public']['Tables']['shift_swaps']['Row'];
export type ShiftSwapInsert = Database['public']['Tables']['shift_swaps']['Insert'];

export type Announcement = Database['public']['Tables']['announcements']['Row'];
export type AnnouncementInsert = Database['public']['Tables']['announcements']['Insert'];
export type AnnouncementUpdate = Database['public']['Tables']['announcements']['Update'];
export type AnnouncementRead = Database['public']['Tables']['announcement_reads']['Row'];
export type AnnouncementReadInsert =
  Database['public']['Tables']['announcement_reads']['Insert'];

export type Notification = Database['public']['Tables']['notifications']['Row'];

export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];

export type Subscription = Database['public']['Tables']['subscriptions']['Row'];
/** `subscriptions.plan` CHECK. The three plans the schema will accept. */
export type SubscriptionPlan = 'starter' | 'professional' | 'business';

export type PushSubscriptionRow =
  Database['public']['Tables']['push_subscriptions']['Row'];
export type PushSubscriptionInsert =
  Database['public']['Tables']['push_subscriptions']['Insert'];

export type Invite = Database['public']['Tables']['invites']['Row'];
export type InviteInsert = Database['public']['Tables']['invites']['Insert'];
export type InviteUpdate = Database['public']['Tables']['invites']['Update'];

export type Location = Database['public']['Tables']['locations']['Row'];
export type LocationInsert = Database['public']['Tables']['locations']['Insert'];
export type LocationUpdate = Database['public']['Tables']['locations']['Update'];

export type MinimumCoverRule = Database['public']['Tables']['minimum_cover_rules']['Row'];
export type MinimumCoverRuleUpsert =
  Database['public']['Tables']['minimum_cover_rules']['Insert'];

export type Department = Database['public']['Tables']['departments']['Row'];
export type DepartmentInsert = Database['public']['Tables']['departments']['Insert'];
export type DepartmentUpdate = Database['public']['Tables']['departments']['Update'];

export type EmergencyContact = Database['public']['Tables']['emergency_contacts']['Row'];
export type EmergencyContactInsert =
  Database['public']['Tables']['emergency_contacts']['Insert'];

export type StaffDocument = Database['public']['Tables']['documents']['Row'];
export type StaffDocumentInsert = Database['public']['Tables']['documents']['Insert'];

/**
 * Org SMTP: `smtp_pass` is write-only. Excluded from the column-level
 * SELECT grant on the base table (see 0010_org_smtp_settings.sql). The app
 * only ever reads through the `_safe` view, which omits the password
 * entirely.
 */
export type OrgSmtpSettingsSafe =
  Database['public']['Views']['org_smtp_settings_safe']['Row'];
export type OrgSmtpSettingsInsert =
  Database['public']['Tables']['org_smtp_settings']['Insert'];
export type OrgSmtpSettingsUpdate =
  Database['public']['Tables']['org_smtp_settings']['Update'];
