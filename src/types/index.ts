import type { Database } from '@/types/database.types';

/** Convenience row aliases used across the app. */
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type AppSettings = Database['public']['Tables']['app_settings']['Row'];
export type AppSettingsUpdate =
  Database['public']['Tables']['app_settings']['Update'];

export type ThemeMode = 'dark' | 'light';

/** RotaFlow domain rows (see docs/SCHEMA.md). */
export type Organisation = Database['public']['Tables']['organisations']['Row'];
export type OrganisationInsert =
  Database['public']['Tables']['organisations']['Insert'];

export type MembershipRole = 'owner' | 'manager' | 'staff';
export type Membership = Database['public']['Tables']['memberships']['Row'];

export type StaffProfile = Database['public']['Tables']['staff_profiles']['Row'];

export type ShiftType = Database['public']['Tables']['shift_types']['Row'];

export type Rota = Database['public']['Tables']['rotas']['Row'];
export type RotaInsert = Database['public']['Tables']['rotas']['Insert'];

export type Shift = Database['public']['Tables']['shifts']['Row'];
export type ShiftInsert = Database['public']['Tables']['shifts']['Insert'];
