/**
 * Supabase schema types.
 *
 * Regenerate after any migration:
 *   supabase gen types typescript --project-id <ref> --schema public \
 *     > src/types/database.types.ts
 *
 * Generated from the live project (supabase/migrations/0001_init.sql +
 * 0002_rotaflow.sql applied).
 */

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      announcements: {
        Row: {
          author_user_id: string | null;
          body: string;
          created_at: string;
          department_id: string | null;
          id: string;
          location_id: string | null;
          org_id: string;
          published_at: string | null;
          scope: string;
          title: string;
          updated_at: string;
          urgent: boolean;
        };
        Insert: {
          author_user_id?: string | null;
          body: string;
          created_at?: string;
          department_id?: string | null;
          id?: string;
          location_id?: string | null;
          org_id: string;
          published_at?: string | null;
          scope?: string;
          title: string;
          updated_at?: string;
          urgent?: boolean;
        };
        Update: {
          author_user_id?: string | null;
          body?: string;
          created_at?: string;
          department_id?: string | null;
          id?: string;
          location_id?: string | null;
          org_id?: string;
          published_at?: string | null;
          scope?: string;
          title?: string;
          updated_at?: string;
          urgent?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'announcements_author_user_id_fkey';
            columns: ['author_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcements_department_id_fkey';
            columns: ['department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcements_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcements_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      app_settings: {
        Row: {
          created_at: string;
          id: string;
          notifications_enabled: boolean;
          theme: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notifications_enabled?: boolean;
          theme?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notifications_enabled?: boolean;
          theme?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'app_settings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json;
          org_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          org_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      availability: {
        Row: {
          created_at: string;
          date: string | null;
          end_time: string | null;
          id: string;
          org_id: string;
          recurring: boolean;
          staff_profile_id: string;
          start_time: string | null;
          status: string;
          updated_at: string;
          weekday: number | null;
        };
        Insert: {
          created_at?: string;
          date?: string | null;
          end_time?: string | null;
          id?: string;
          org_id: string;
          recurring?: boolean;
          staff_profile_id: string;
          start_time?: string | null;
          status?: string;
          updated_at?: string;
          weekday?: number | null;
        };
        Update: {
          created_at?: string;
          date?: string | null;
          end_time?: string | null;
          id?: string;
          org_id?: string;
          recurring?: boolean;
          staff_profile_id?: string;
          start_time?: string | null;
          status?: string;
          updated_at?: string;
          weekday?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'availability_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availability_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      clock_events: {
        Row: {
          accuracy: number | null;
          created_at: string;
          event_at: string;
          id: string;
          latitude: number | null;
          location_name: string | null;
          longitude: number | null;
          method: string;
          org_id: string;
          shift_id: string | null;
          staff_profile_id: string;
          synced: boolean;
          type: string;
          updated_at: string;
        };
        Insert: {
          accuracy?: number | null;
          created_at?: string;
          event_at?: string;
          id?: string;
          latitude?: number | null;
          location_name?: string | null;
          longitude?: number | null;
          method?: string;
          org_id: string;
          shift_id?: string | null;
          staff_profile_id: string;
          synced?: boolean;
          type: string;
          updated_at?: string;
        };
        Update: {
          accuracy?: number | null;
          created_at?: string;
          event_at?: string;
          id?: string;
          latitude?: number | null;
          location_name?: string | null;
          longitude?: number | null;
          method?: string;
          org_id?: string;
          shift_id?: string | null;
          staff_profile_id?: string;
          synced?: boolean;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clock_events_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clock_events_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'shifts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clock_events_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      departments: {
        Row: {
          created_at: string;
          id: string;
          location_id: string | null;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          location_id?: string | null;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          location_id?: string | null;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'departments_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'departments_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string;
          expires_at: string | null;
          file_url: string;
          id: string;
          issued_at: string | null;
          name: string;
          org_id: string;
          staff_profile_id: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          file_url: string;
          id?: string;
          issued_at?: string | null;
          name: string;
          org_id: string;
          staff_profile_id: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          file_url?: string;
          id?: string;
          issued_at?: string | null;
          name?: string;
          org_id?: string;
          staff_profile_id?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'documents_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      emergency_contacts: {
        Row: {
          created_at: string;
          id: string;
          medical_notes: string | null;
          name: string;
          org_id: string;
          phone: string;
          relationship: string | null;
          secondary_phone: string | null;
          staff_profile_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          medical_notes?: string | null;
          name: string;
          org_id: string;
          phone: string;
          relationship?: string | null;
          secondary_phone?: string | null;
          staff_profile_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          medical_notes?: string | null;
          name?: string;
          org_id?: string;
          phone?: string;
          relationship?: string | null;
          secondary_phone?: string | null;
          staff_profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'emergency_contacts_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'emergency_contacts_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      leave_requests: {
        Row: {
          created_at: string;
          end_date: string;
          id: string;
          org_id: string;
          reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          staff_profile_id: string;
          start_date: string;
          status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          end_date: string;
          id?: string;
          org_id: string;
          reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          staff_profile_id: string;
          start_date: string;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          end_date?: string;
          id?: string;
          org_id?: string;
          reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          staff_profile_id?: string;
          start_date?: string;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'leave_requests_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leave_requests_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leave_requests_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      invites: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          org_id: string;
          revoked_at: string | null;
          role: string;
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          org_id: string;
          revoked_at?: string | null;
          role?: string;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          org_id?: string;
          revoked_at?: string | null;
          role?: string;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invites_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      locations: {
        Row: {
          address: string | null;
          created_at: string;
          geofence_radius_m: number;
          id: string;
          latitude: number | null;
          longitude: number | null;
          name: string;
          org_id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          geofence_radius_m?: number;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name: string;
          org_id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          geofence_radius_m?: number;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name?: string;
          org_id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'locations_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          channel: string;
          created_at: string;
          id: string;
          org_id: string;
          read_at: string | null;
          title: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          channel?: string;
          created_at?: string;
          id?: string;
          org_id: string;
          read_at?: string | null;
          title: string;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          channel?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organisations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          plan: string;
          settings: Json;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          plan?: string;
          settings?: Json;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          plan?: string;
          settings?: Json;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organisations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      overtime_requests: {
        Row: {
          created_at: string;
          date: string;
          hours: number;
          id: string;
          note: string | null;
          org_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          staff_profile_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          hours: number;
          id?: string;
          note?: string | null;
          org_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          staff_profile_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          hours?: number;
          id?: string;
          note?: string | null;
          org_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          staff_profile_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'overtime_requests_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'overtime_requests_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'overtime_requests_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth_key: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth_key: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth_key?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_smtp_settings: {
        Row: {
          org_id: string;
          smtp_host: string;
          smtp_port: number;
          smtp_user: string;
          smtp_pass: string;
          from_email: string;
          from_name: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          smtp_host: string;
          smtp_port?: number;
          smtp_user: string;
          smtp_pass: string;
          from_email: string;
          from_name?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          smtp_host?: string;
          smtp_port?: number;
          smtp_user?: string;
          smtp_pass?: string;
          from_email?: string;
          from_name?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_smtp_settings_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_platform_admin: boolean;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_platform_admin?: boolean;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_platform_admin?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      rotas: {
        Row: {
          created_at: string;
          id: string;
          location_id: string | null;
          name: string;
          org_id: string;
          period_end: string;
          period_start: string;
          published_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          location_id?: string | null;
          name: string;
          org_id: string;
          period_end: string;
          period_start: string;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          location_id?: string | null;
          name?: string;
          org_id?: string;
          period_end?: string;
          period_start?: string;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rotas_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rotas_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      shift_swaps: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          org_id: string;
          requested_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          shift_id: string;
          status: string;
          target_staff_profile_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          org_id: string;
          requested_by: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          shift_id: string;
          status?: string;
          target_staff_profile_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          org_id?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          shift_id?: string;
          status?: string;
          target_staff_profile_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_swaps_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_swaps_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_swaps_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_swaps_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'shifts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_swaps_target_staff_profile_id_fkey';
            columns: ['target_staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      shift_templates: {
        Row: {
          break_minutes: number;
          created_at: string;
          department_id: string | null;
          end_time: string;
          id: string;
          location_id: string | null;
          name: string;
          org_id: string;
          required_skills: string[];
          shift_type_id: string | null;
          start_time: string;
          updated_at: string;
        };
        Insert: {
          break_minutes?: number;
          created_at?: string;
          department_id?: string | null;
          end_time: string;
          id?: string;
          location_id?: string | null;
          name: string;
          org_id: string;
          required_skills?: string[];
          shift_type_id?: string | null;
          start_time: string;
          updated_at?: string;
        };
        Update: {
          break_minutes?: number;
          created_at?: string;
          department_id?: string | null;
          end_time?: string;
          id?: string;
          location_id?: string | null;
          name?: string;
          org_id?: string;
          required_skills?: string[];
          shift_type_id?: string | null;
          start_time?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_templates_department_id_fkey';
            columns: ['department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_templates_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_templates_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_templates_shift_type_id_fkey';
            columns: ['shift_type_id'];
            isOneToOne: false;
            referencedRelation: 'shift_types';
            referencedColumns: ['id'];
          },
        ];
      };
      shift_types: {
        Row: {
          category: string | null;
          colour: string;
          created_at: string;
          default_end: string | null;
          default_start: string | null;
          id: string;
          is_paid: boolean;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          category?: string | null;
          colour?: string;
          created_at?: string;
          default_end?: string | null;
          default_start?: string | null;
          id?: string;
          is_paid?: boolean;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          category?: string | null;
          colour?: string;
          created_at?: string;
          default_end?: string | null;
          default_start?: string | null;
          id?: string;
          is_paid?: boolean;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_types_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      shifts: {
        Row: {
          break_minutes: number;
          colour: string | null;
          created_at: string;
          department_id: string | null;
          ends_at: string;
          id: string;
          location_id: string | null;
          notes: string | null;
          org_id: string;
          rota_id: string | null;
          shift_type_id: string | null;
          staff_profile_id: string | null;
          starts_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          break_minutes?: number;
          colour?: string | null;
          created_at?: string;
          department_id?: string | null;
          ends_at: string;
          id?: string;
          location_id?: string | null;
          notes?: string | null;
          org_id: string;
          rota_id?: string | null;
          shift_type_id?: string | null;
          staff_profile_id?: string | null;
          starts_at: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          break_minutes?: number;
          colour?: string | null;
          created_at?: string;
          department_id?: string | null;
          ends_at?: string;
          id?: string;
          location_id?: string | null;
          notes?: string | null;
          org_id?: string;
          rota_id?: string | null;
          shift_type_id?: string | null;
          staff_profile_id?: string | null;
          starts_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shifts_department_id_fkey';
            columns: ['department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shifts_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shifts_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shifts_rota_id_fkey';
            columns: ['rota_id'];
            isOneToOne: false;
            referencedRelation: 'rotas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shifts_shift_type_id_fkey';
            columns: ['shift_type_id'];
            isOneToOne: false;
            referencedRelation: 'shift_types';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shifts_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_profiles: {
        Row: {
          active: boolean;
          contract_type: string | null;
          created_at: string;
          department_id: string | null;
          first_name: string;
          holiday_allowance: number | null;
          id: string;
          job_title: string | null;
          last_name: string;
          org_id: string;
          payroll_id: string | null;
          phone: string | null;
          photo_url: string | null;
          skills: string[];
          start_date: string | null;
          updated_at: string;
          user_id: string | null;
          weekly_hours: number | null;
        };
        Insert: {
          active?: boolean;
          contract_type?: string | null;
          created_at?: string;
          department_id?: string | null;
          first_name: string;
          holiday_allowance?: number | null;
          id?: string;
          job_title?: string | null;
          last_name: string;
          org_id: string;
          payroll_id?: string | null;
          phone?: string | null;
          photo_url?: string | null;
          skills?: string[];
          start_date?: string | null;
          updated_at?: string;
          user_id?: string | null;
          weekly_hours?: number | null;
        };
        Update: {
          active?: boolean;
          contract_type?: string | null;
          created_at?: string;
          department_id?: string | null;
          first_name?: string;
          holiday_allowance?: number | null;
          id?: string;
          job_title?: string | null;
          last_name?: string;
          org_id?: string;
          payroll_id?: string | null;
          phone?: string | null;
          photo_url?: string | null;
          skills?: string[];
          start_date?: string | null;
          updated_at?: string;
          user_id?: string | null;
          weekly_hours?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_profiles_department_id_fkey';
            columns: ['department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_profiles_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          org_id: string;
          plan: string;
          provider: string | null;
          provider_ref: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          org_id: string;
          plan?: string;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          org_id?: string;
          plan?: string;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      timesheets: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          period_end: string;
          period_start: string;
          staff_profile_id: string;
          status: string;
          total_minutes: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          period_end: string;
          period_start: string;
          staff_profile_id: string;
          status?: string;
          total_minutes?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          period_end?: string;
          period_start?: string;
          staff_profile_id?: string;
          status?: string;
          total_minutes?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'timesheets_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'timesheets_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      org_smtp_settings_safe: {
        Row: {
          org_id: string;
          smtp_host: string;
          smtp_port: number;
          smtp_user: string;
          from_email: string;
          from_name: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_smtp_settings_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      create_invite: {
        Args: { p_org: string; p_email: string; p_role?: string };
        Returns: { invite_id: string; token: string; expires_at: string }[];
      };
      preview_invite: {
        Args: { p_token: string };
        Returns: {
          org_name: string;
          role: string;
          email: string;
          expires_at: string;
        }[];
      };
      slug_available: { Args: { p_slug: string }; Returns: boolean };
      has_org_role: {
        Args: { p_org: string; p_roles: string[] };
        Returns: boolean;
      };
      is_org_member: { Args: { p_org: string }; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      my_staff_profile_id: { Args: { p_org: string }; Returns: string };
      anonymize_staff_member: {
        Args: { p_org: string; p_staff_profile_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;
type DefaultSchema = DatabaseWithoutInternals['public'];

export type Tables<
  TableName extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views']),
> = (DefaultSchema['Tables'] & DefaultSchema['Views'])[TableName] extends {
  Row: infer R;
}
  ? R
  : never;

export type TablesInsert<TableName extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][TableName] extends { Insert: infer I } ? I : never;

export type TablesUpdate<TableName extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][TableName] extends { Update: infer U } ? U : never;
