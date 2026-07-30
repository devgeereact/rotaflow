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

export type StaffProfile = Database['public']['Tables']['staff_profiles']['Row'];
export type StaffProfileInsert = Database['public']['Tables']['staff_profiles']['Insert'];
export type StaffProfileUpdate = Database['public']['Tables']['staff_profiles']['Update'];

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

export type LeaveRequest = Database['public']['Tables']['leave_requests']['Row'];
export type LeaveRequestInsert = Database['public']['Tables']['leave_requests']['Insert'];

export type ShiftSwap = Database['public']['Tables']['shift_swaps']['Row'];
export type ShiftSwapInsert = Database['public']['Tables']['shift_swaps']['Insert'];

export type Announcement = Database['public']['Tables']['announcements']['Row'];
export type AnnouncementInsert = Database['public']['Tables']['announcements']['Insert'];
export type AnnouncementUpdate = Database['public']['Tables']['announcements']['Update'];

export type Notification = Database['public']['Tables']['notifications']['Row'];

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

export type Department = Database['public']['Tables']['departments']['Row'];
export type DepartmentInsert = Database['public']['Tables']['departments']['Insert'];
export type DepartmentUpdate = Database['public']['Tables']['departments']['Update'];

export type EmergencyContact = Database['public']['Tables']['emergency_contacts']['Row'];
export type StaffDocument = Database['public']['Tables']['documents']['Row'];

/**
 * Org SMTP: `smtp_pass` is write-only — excluded from the column-level
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
