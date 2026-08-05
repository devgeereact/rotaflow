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
      // HAND-MAINTAINED PENDING REGENERATION (0018_platform_settings.sql).
      platform_settings: {
        Row: {
          created_at: string;
          default_timezone: string;
          id: boolean;
          maintenance_message: string | null;
          maintenance_mode: boolean;
          platform_name: string;
          platform_url: string;
          registration_enabled: boolean;
          support_email: string;
          updated_at: string;
          updated_by: string | null;
          admin_session_minutes: number;
          api_rate_limit_per_min: number;
          email_provider: string;
          email_sender_address: string;
          email_sender_name: string;
          favicon_url: string | null;
          logo_url: string | null;
          max_concurrent_sessions: number;
          max_upload_mb: number;
          permitted_file_types: string[];
          primary_colour: string;
          public_api_enabled: boolean;
          reauth_for_critical: boolean;
          require_mfa: boolean;
          signin_alerts: boolean;
          support_branding: boolean;
          webhook_max_attempts: number;
        };
        Insert: {
          created_at?: string;
          default_timezone?: string;
          id?: boolean;
          maintenance_message?: string | null;
          maintenance_mode?: boolean;
          platform_name?: string;
          platform_url?: string;
          registration_enabled?: boolean;
          support_email?: string;
          updated_at?: string;
          updated_by?: string | null;
          admin_session_minutes?: number;
          api_rate_limit_per_min?: number;
          email_provider?: string;
          email_sender_address?: string;
          email_sender_name?: string;
          favicon_url?: string | null;
          logo_url?: string | null;
          max_concurrent_sessions?: number;
          max_upload_mb?: number;
          permitted_file_types?: string[];
          primary_colour?: string;
          public_api_enabled?: boolean;
          reauth_for_critical?: boolean;
          require_mfa?: boolean;
          signin_alerts?: boolean;
          support_branding?: boolean;
          webhook_max_attempts?: number;
        };
        Update: {
          created_at?: string;
          default_timezone?: string;
          id?: boolean;
          maintenance_message?: string | null;
          maintenance_mode?: boolean;
          platform_name?: string;
          platform_url?: string;
          registration_enabled?: boolean;
          support_email?: string;
          updated_at?: string;
          updated_by?: string | null;
          admin_session_minutes?: number;
          api_rate_limit_per_min?: number;
          email_provider?: string;
          email_sender_address?: string;
          email_sender_name?: string;
          favicon_url?: string | null;
          logo_url?: string | null;
          max_concurrent_sessions?: number;
          max_upload_mb?: number;
          permitted_file_types?: string[];
          primary_colour?: string;
          public_api_enabled?: boolean;
          reauth_for_critical?: boolean;
          require_mfa?: boolean;
          signin_alerts?: boolean;
          support_branding?: boolean;
          webhook_max_attempts?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      // HAND-MAINTAINED PENDING REGENERATION (0015_platform_roles.sql).
      platform_admins: {
        Row: {
          created_at: string;
          granted_at: string;
          granted_by: string | null;
          note: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          note?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          note?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_admins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
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
      // HAND-MAINTAINED PENDING REGENERATION (0016_audit_events.sql).
      // `org_id` is nullable for platform-scoped events, and the actor/org
      // names are snapshotted at write time rather than joined. Replace this
      // block with a real `supabase gen types` run once 0016 is applied.
      audit_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_name: string | null;
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          ip_address: string | null;
          metadata: Json;
          org_id: string | null;
          org_name: string | null;
          scope: string;
          severity: string;
          user_agent: string | null;
          visibility: string;
          after_value: string | null;
          before_value: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json;
          org_id?: string | null;
          org_name?: string | null;
          scope?: string;
          severity?: string;
          user_agent?: string | null;
          visibility?: string;
          after_value?: string | null;
          before_value?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json;
          org_id?: string | null;
          org_name?: string | null;
          scope?: string;
          severity?: string;
          user_agent?: string | null;
          visibility?: string;
          after_value?: string | null;
          before_value?: string | null;
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
      // Lifecycle columns HAND-MAINTAINED PENDING REGENERATION
      // (0017_organisation_status.sql). `status` and `support_access_allowed`
      // are absent from `Update` on purpose: 0017 revokes the UPDATE privilege
      // on both from `authenticated`, so they move through `set_org_status` /
      // `set_org_support_access` only. Typing them as writable here would
      // invite a `.update({ status })` that compiles and then 42501s.
      organisations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          plan: string;
          settings: Json;
          slug: string;
          status: string;
          support_access_allowed: boolean;
          suspended_at: string | null;
          suspended_reason: string | null;
          updated_at: string;
          contact_email: string | null;
          contact_phone: string | null;
          country: string;
          industry: string | null;
          last_activity_at: string | null;
          timezone: string;
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
          contact_email?: string | null;
          contact_phone?: string | null;
          country?: string;
          industry?: string | null;
          last_activity_at?: string | null;
          timezone?: string;
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
          contact_email?: string | null;
          contact_phone?: string | null;
          country?: string;
          industry?: string | null;
          last_activity_at?: string | null;
          timezone?: string;
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
      // HAND-MAINTAINED PENDING REGENERATION (0020_gdpr_requests.sql).
      gdpr_requests: {
        Row: {
          id: string;
          org_id: string | null;
          subject_email: string;
          subject_name: string | null;
          kind: string;
          status: string;
          received_on: string;
          due_on: string;
          extended_to: string | null;
          extension_reason: string | null;
          assigned_to: string | null;
          closed_at: string | null;
          outcome_note: string | null;
          created_at: string;
          updated_at: string;
        };
        // Mutations go through the SECURITY DEFINER RPCs above.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // HAND-MAINTAINED PENDING REGENERATION (0019_support_access_sessions.sql).
      support_access_sessions: {
        Row: {
          id: string;
          org_id: string;
          admin_user_id: string;
          reason: string;
          case_ref: string;
          scope: string;
          granted_at: string;
          expires_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
          revoke_reason: string | null;
        };
        // No insert or update policy exists — both mutations go through the
        // SECURITY DEFINER RPCs above. These shapes are here so a `select`
        // types correctly, not because a client may write the table.
        Insert: never;
        Update: never;
        Relationships: [];
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
          canceled_at: string | null;
          currency: string;
          price_pence: number | null;
          started_at: string;
          trial_ends_at: string | null;
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
          canceled_at?: string | null;
          currency?: string;
          price_pence?: number | null;
          started_at?: string;
          trial_ends_at?: string | null;
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
          canceled_at?: string | null;
          currency?: string;
          price_pence?: number | null;
          started_at?: string;
          trial_ends_at?: string | null;
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
      // HAND-MAINTAINED PENDING REGENERATION (0021–0027).
      //
      // Every block below follows the same shape the generator emits: a `Row`
      // of what a select returns, an `Insert`/`Update` pair, and no
      // relationships, because nothing in the console navigates a foreign key
      // through PostgREST's embedding syntax for these.
      //
      // `Insert` and `Update` are declared `never` on the tables whose writes
      // all go through SECURITY DEFINER functions. That is not laziness: the
      // grants were revoked in the migration, so a `.insert()` would fail at
      // runtime, and a type that permits it invites the call.
      incidents: {
        Row: {
          created_at: string;
          detected_at: string | null;
          id: string;
          impact: string;
          is_public: boolean;
          owner_id: string | null;
          reference: string;
          resolution: string | null;
          resolved_at: string | null;
          service: string;
          severity: string;
          started_at: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      incident_updates: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          incident_id: string;
          status: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      feature_flags: {
        Row: {
          created_at: string;
          critical: boolean;
          description: string;
          enabled: boolean;
          environment: string;
          key: string;
          name: string;
          rollout: number;
          target_plans: string[];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      feature_flag_targets: {
        Row: { created_at: string; flag_key: string; org_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      feature_flag_changes: {
        Row: {
          actor_id: string | null;
          actor_name: string | null;
          after_value: string | null;
          before_value: string | null;
          created_at: string;
          field: string;
          flag_key: string;
          id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      plans: {
        Row: {
          code: string;
          created_at: string;
          currency: string;
          description: string;
          location_limit: number | null;
          monthly_price_pence: number;
          name: string;
          seat_limit: number | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      invoices: {
        Row: {
          amount_pence: number;
          attempts: number;
          created_at: string;
          currency: string;
          due_on: string;
          failure_reason: string | null;
          id: string;
          issued_on: string;
          number: string;
          org_id: string;
          paid_at: string | null;
          period_end: string;
          period_start: string;
          provider: string | null;
          provider_ref: string | null;
          refunded_at: string | null;
          status: string;
          tax_pence: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      support_cases: {
        Row: {
          assigned_to: string | null;
          category: string;
          created_at: string;
          csat: number | null;
          csat_comment: string | null;
          first_response_at: string | null;
          id: string;
          org_id: string | null;
          priority: string;
          reference: string;
          requester_email: string;
          requester_id: string | null;
          requester_name: string | null;
          resolved_at: string | null;
          status: string;
          subject: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      support_case_messages: {
        Row: {
          author_id: string | null;
          author_name: string | null;
          author_side: string;
          body: string;
          case_id: string;
          created_at: string;
          id: string;
          is_internal: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_announcements: {
        Row: {
          audience: string;
          audience_plans: string[];
          body: string;
          channel: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          scheduled_for: string | null;
          sent_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_announcement_deliveries: {
        Row: {
          announcement_id: string;
          created_at: string;
          failed_at: string | null;
          failure_reason: string | null;
          id: string;
          org_id: string;
          read_at: string | null;
          read_by: string | null;
          sent_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_announcement_optouts: {
        Row: { created_at: string; opted_out_by: string | null; org_id: string };
        Insert: { org_id: string; opted_out_by?: string | null };
        Update: never;
        Relationships: [];
      };
      integration_connectors: {
        Row: {
          available: boolean;
          category: string;
          created_at: string;
          description: string;
          docs_url: string | null;
          key: string;
          name: string;
          status: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      org_integrations: {
        Row: {
          connected_at: string;
          connected_by: string | null;
          connector_key: string;
          created_at: string;
          credentials_ref: string | null;
          id: string;
          last_error: string | null;
          last_sync_at: string | null;
          org_id: string;
          status: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      integration_sync_runs: {
        Row: {
          connector_key: string;
          duration_ms: number | null;
          error: string | null;
          finished_at: string | null;
          id: string;
          org_id: string;
          org_integration_id: string;
          outcome: string;
          records: number;
          started_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_ip_allowlist: {
        Row: {
          cidr: string;
          created_at: string;
          created_by: string | null;
          id: string;
          label: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      retention_policies: {
        Row: {
          data_type: string;
          enforced: boolean;
          label: string;
          note: string;
          retain_months: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_health_samples: {
        Row: {
          checked_at: string;
          id: number;
          latency_ms: number | null;
          service: string;
          source: string;
          status: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      background_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          job_key: string;
          org_id: string | null;
          payload: Json;
          queue: string;
          scheduled_for: string;
          started_at: string | null;
          status: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      // HAND-MAINTAINED PENDING REGENERATION (0026, 0027).
      integration_connector_stats: {
        Row: {
          available: boolean | null;
          category: string | null;
          failed_24h: number | null;
          key: string | null;
          last_sync_at: string | null;
          median_duration_ms: number | null;
          name: string | null;
          orgs_connected: number | null;
          runs_24h: number | null;
          status: string | null;
          success_rate_7d: number | null;
        };
        Relationships: [];
      };
      platform_health_summary: {
        Row: {
          last_checked_at: string | null;
          ok_24h: number | null;
          p50_ms: number | null;
          p95_ms: number | null;
          p99_ms: number | null;
          samples_24h: number | null;
          service: string | null;
          uptime_pct_24h: number | null;
        };
        Relationships: [];
      };
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
      // HAND-MAINTAINED PENDING REGENERATION (0021–0027).
      declare_incident: {
        Args: {
          p_title: string;
          p_impact: string;
          p_severity: string;
          p_service: string;
          p_started_at?: string | null;
        };
        Returns: string;
      };
      add_incident_update: {
        Args: { p_incident: string; p_status: string; p_body: string };
        Returns: string;
      };
      resolve_incident: {
        Args: { p_incident: string; p_resolution: string };
        Returns: undefined;
      };
      flag_enabled_for_org: { Args: { p_key: string; p_org: string }; Returns: boolean };
      set_feature_flag: {
        Args: {
          p_key: string;
          p_enabled?: boolean | null;
          p_rollout?: number | null;
          p_plans?: string[] | null;
        };
        Returns: undefined;
      };
      set_feature_flag_target: {
        Args: { p_key: string; p_org: string; p_targeted: boolean };
        Returns: undefined;
      };
      subscription_mrr_pence: { Args: { p_org: string }; Returns: number };
      touch_org_activity: { Args: { p_org: string }; Returns: undefined };
      issue_invoice: {
        Args: {
          p_org: string;
          p_period_start: string;
          p_period_end: string;
          p_amount_pence?: number | null;
        };
        Returns: string;
      };
      set_invoice_status: {
        Args: { p_invoice: string; p_status: string; p_reason?: string | null };
        Returns: undefined;
      };
      open_support_case: {
        Args: {
          p_subject: string;
          p_body: string;
          p_category?: string;
          p_priority?: string;
          p_org?: string | null;
          p_requester_email?: string | null;
        };
        Returns: string;
      };
      reply_to_support_case: {
        Args: { p_case: string; p_body: string; p_internal?: boolean };
        Returns: string;
      };
      set_support_case_status: {
        Args: { p_case: string; p_status: string; p_note?: string | null };
        Returns: undefined;
      };
      assign_support_case: {
        Args: { p_case: string; p_agent: string | null };
        Returns: undefined;
      };
      rate_support_case: {
        Args: { p_case: string; p_score: number; p_comment?: string | null };
        Returns: undefined;
      };
      create_platform_announcement: {
        Args: {
          p_title: string;
          p_body: string;
          p_kind?: string;
          p_audience?: string;
          p_plans?: string[];
          p_channel?: string;
          p_scheduled_for?: string | null;
        };
        Returns: string;
      };
      publish_platform_announcement: {
        Args: { p_announcement: string };
        Returns: number;
      };
      mark_announcement_read: { Args: { p_announcement: string }; Returns: undefined };
      connect_integration: {
        Args: { p_org: string; p_connector: string; p_ref?: string | null };
        Returns: string;
      };
      set_org_integration_status: {
        Args: { p_org: string; p_connector: string; p_status: string };
        Returns: undefined;
      };
      record_health_sample: {
        Args: {
          p_service: string;
          p_status: string;
          p_latency_ms?: number | null;
          p_source?: string;
        };
        Returns: undefined;
      };
      platform_user_auth_facts: {
        Args: { p_user: string };
        Returns: {
          email_confirmed_at: string | null;
          last_sign_in_at: string | null;
          mfa_enrolled: boolean;
          banned_until: string | null;
        }[];
      };
      platform_auth_facts_summary: {
        Args: never;
        Returns: {
          total_accounts: number;
          unverified: number;
          active_30d: number;
          inactive_90d: number;
          mfa_enrolled: number;
          banned: number;
        }[];
      };
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
      // HAND-MAINTAINED PENDING REGENERATION (0015_platform_roles.sql).
      has_platform_role: { Args: { p_roles: string[] }; Returns: boolean };
      my_platform_role: { Args: never; Returns: string | null };
      my_active_org_ids: { Args: never; Returns: string[] };
      grant_platform_role: {
        Args: { p_user: string; p_role: string };
        Returns: undefined;
      };
      revoke_platform_role: { Args: { p_user: string }; Returns: undefined };
      // HAND-MAINTAINED PENDING REGENERATION (0017_organisation_status.sql).
      set_org_status: {
        Args: { p_org: string; p_status: string; p_reason?: string | null };
        Returns: undefined;
      };
      set_org_support_access: {
        Args: { p_org: string; p_allowed: boolean };
        Returns: undefined;
      };
      // HAND-MAINTAINED PENDING REGENERATION (0020_gdpr_requests.sql).
      log_gdpr_request: {
        Args: {
          p_subject_email: string;
          p_subject_name?: string | null;
          p_kind: string;
          p_org?: string | null;
          p_received_on?: string | null;
        };
        Returns: string;
      };
      set_gdpr_request_status: {
        Args: { p_request: string; p_status: string; p_note?: string | null };
        Returns: undefined;
      };
      extend_gdpr_request: {
        Args: { p_request: string; p_reason: string };
        Returns: string;
      };
      // HAND-MAINTAINED PENDING REGENERATION (0019_support_access_sessions.sql).
      request_support_access: {
        Args: {
          p_org: string;
          p_reason: string;
          p_case_ref: string;
          p_scope: string;
          p_minutes: number;
        };
        Returns: string;
      };
      revoke_support_access: {
        Args: { p_session: string; p_reason?: string | null };
        Returns: undefined;
      };
      // HAND-MAINTAINED PENDING REGENERATION (0016_audit_events.sql).
      log_audit_event: {
        Args: {
          p_org: string;
          p_action: string;
          p_entity_type?: string | null;
          p_entity_id?: string | null;
          p_metadata?: Json;
        };
        Returns: undefined;
      };
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
