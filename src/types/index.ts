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

export type Location = Database['public']['Tables']['locations']['Row'];
export type LocationInsert = Database['public']['Tables']['locations']['Insert'];
export type LocationUpdate = Database['public']['Tables']['locations']['Update'];

export type Department = Database['public']['Tables']['departments']['Row'];
export type DepartmentInsert = Database['public']['Tables']['departments']['Insert'];
export type DepartmentUpdate = Database['public']['Tables']['departments']['Update'];
