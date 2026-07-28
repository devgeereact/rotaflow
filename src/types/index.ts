import type { Database } from '@/types/database.types';

/** Convenience row aliases used across the app. */
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type AppSettings = Database['public']['Tables']['app_settings']['Row'];
export type AppSettingsUpdate =
  Database['public']['Tables']['app_settings']['Update'];

export type ThemeMode = 'dark' | 'light';
