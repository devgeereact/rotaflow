/* eslint-disable @typescript-eslint/no-redundant-type-constituents -- generated file: the generator emits `never` inside a union for tables whose writes are revoked, and reformatting generated output would be undone by the next run. */
/**
 * Supabase schema types, generated from the live project.
 *
 * Regenerate after any migration:
 *   supabase gen types typescript --project-id vwqqbdvlskngrqrejzxi --schema public \
 *     > src/types/database.types.ts
 *
 * This file was hand maintained from 0015 to 0033 because the generator was
 * never run, which is why several tables carried `Insert: never` and a few
 * columns drifted from the database. It is generated now, and the diff between
 * `supabase gen types` output and the declarations in `supabase/migrations` is
 * the check that the repository still describes production. 0033 was written
 * because that diff found a whole incident feature nobody had declared.
 */
export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      announcement_reads: {
        Row: {
          announcement_id: string;
          id: string;
          org_id: string;
          read_at: string;
          staff_profile_id: string;
        };
        Insert: {
          announcement_id: string;
          id?: string;
          org_id: string;
          read_at?: string;
          staff_profile_id: string;
        };
        Update: {
          announcement_id?: string;
          id?: string;
          org_id?: string;
          read_at?: string;
          staff_profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'announcement_reads_announcement_id_fkey';
            columns: ['announcement_id'];
            isOneToOne: false;
            referencedRelation: 'announcements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcement_reads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcement_reads_staff_profile_id_fkey';
            columns: ['staff_profile_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
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
      audit_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_name: string | null;
          actor_user_id: string | null;
          after_value: string | null;
          before_value: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          ip_address: unknown;
          metadata: Json;
          org_id: string | null;
          org_name: string | null;
          scope: string;
          severity: string;
          user_agent: string | null;
          visibility: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          after_value?: string | null;
          before_value?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          org_id?: string | null;
          org_name?: string | null;
          scope?: string;
          severity?: string;
          user_agent?: string | null;
          visibility?: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          after_value?: string | null;
          before_value?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          org_id?: string | null;
          org_name?: string | null;
          scope?: string;
          severity?: string;
          user_agent?: string | null;
          visibility?: string;
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
        Insert: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_key: string;
          org_id?: string | null;
          payload?: Json;
          queue: string;
          scheduled_for?: string;
          started_at?: string | null;
          status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_key?: string;
          org_id?: string | null;
          payload?: Json;
          queue?: string;
          scheduled_for?: string;
          started_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'background_jobs_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
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
        Insert: {
          actor_id?: string | null;
          actor_name?: string | null;
          after_value?: string | null;
          before_value?: string | null;
          created_at?: string;
          field: string;
          flag_key: string;
          id?: string;
        };
        Update: {
          actor_id?: string | null;
          actor_name?: string | null;
          after_value?: string | null;
          before_value?: string | null;
          created_at?: string;
          field?: string;
          flag_key?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_flag_changes_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feature_flag_changes_flag_key_fkey';
            columns: ['flag_key'];
            isOneToOne: false;
            referencedRelation: 'feature_flags';
            referencedColumns: ['key'];
          },
        ];
      };
      feature_flag_targets: {
        Row: {
          created_at: string;
          flag_key: string;
          org_id: string;
        };
        Insert: {
          created_at?: string;
          flag_key: string;
          org_id: string;
        };
        Update: {
          created_at?: string;
          flag_key?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_flag_targets_flag_key_fkey';
            columns: ['flag_key'];
            isOneToOne: false;
            referencedRelation: 'feature_flags';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'feature_flag_targets_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
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
          retired_at: string | null;
          retired_reason: string | null;
          rollout: number;
          target_plans: string[];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          critical?: boolean;
          description?: string;
          enabled?: boolean;
          environment?: string;
          key: string;
          name: string;
          retired_at?: string | null;
          retired_reason?: string | null;
          rollout?: number;
          target_plans?: string[];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          critical?: boolean;
          description?: string;
          enabled?: boolean;
          environment?: string;
          key?: string;
          name?: string;
          retired_at?: string | null;
          retired_reason?: string | null;
          rollout?: number;
          target_plans?: string[];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_flags_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      gdpr_requests: {
        Row: {
          assigned_to: string | null;
          closed_at: string | null;
          created_at: string;
          due_on: string;
          extended_to: string | null;
          extension_reason: string | null;
          id: string;
          kind: string;
          org_id: string | null;
          outcome_note: string | null;
          received_on: string;
          status: string;
          subject_email: string;
          subject_name: string | null;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          closed_at?: string | null;
          created_at?: string;
          due_on: string;
          extended_to?: string | null;
          extension_reason?: string | null;
          id?: string;
          kind: string;
          org_id?: string | null;
          outcome_note?: string | null;
          received_on?: string;
          status?: string;
          subject_email: string;
          subject_name?: string | null;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          closed_at?: string | null;
          created_at?: string;
          due_on?: string;
          extended_to?: string | null;
          extension_reason?: string | null;
          id?: string;
          kind?: string;
          org_id?: string | null;
          outcome_note?: string | null;
          received_on?: string;
          status?: string;
          subject_email?: string;
          subject_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gdpr_requests_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gdpr_requests_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          incident_id: string;
          status: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          incident_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'incident_updates_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incident_updates_incident_id_fkey';
            columns: ['incident_id'];
            isOneToOne: false;
            referencedRelation: 'incidents';
            referencedColumns: ['id'];
          },
        ];
      };
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
        Insert: {
          created_at?: string;
          detected_at?: string | null;
          id?: string;
          impact: string;
          is_public?: boolean;
          owner_id?: string | null;
          reference: string;
          resolution?: string | null;
          resolved_at?: string | null;
          service: string;
          severity: string;
          started_at?: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          detected_at?: string | null;
          id?: string;
          impact?: string;
          is_public?: boolean;
          owner_id?: string | null;
          reference?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          service?: string;
          severity?: string;
          started_at?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'incidents_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          available?: boolean;
          category: string;
          created_at?: string;
          description?: string;
          docs_url?: string | null;
          key: string;
          name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          available?: boolean;
          category?: string;
          created_at?: string;
          description?: string;
          docs_url?: string | null;
          key?: string;
          name?: string;
          status?: string;
          updated_at?: string;
        };
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
        Insert: {
          connector_key: string;
          duration_ms?: number | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          org_id: string;
          org_integration_id: string;
          outcome?: string;
          records?: number;
          started_at?: string;
        };
        Update: {
          connector_key?: string;
          duration_ms?: number | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          org_id?: string;
          org_integration_id?: string;
          outcome?: string;
          records?: number;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_sync_runs_connector_key_fkey';
            columns: ['connector_key'];
            isOneToOne: false;
            referencedRelation: 'integration_connector_stats';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'integration_sync_runs_connector_key_fkey';
            columns: ['connector_key'];
            isOneToOne: false;
            referencedRelation: 'integration_connectors';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'integration_sync_runs_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'integration_sync_runs_org_integration_id_fkey';
            columns: ['org_integration_id'];
            isOneToOne: false;
            referencedRelation: 'org_integrations';
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
            foreignKeyName: 'invites_accepted_by_fkey';
            columns: ['accepted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invites_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invites_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          amount_pence: number;
          attempts?: number;
          created_at?: string;
          currency?: string;
          due_on: string;
          failure_reason?: string | null;
          id?: string;
          issued_on?: string;
          number: string;
          org_id: string;
          paid_at?: string | null;
          period_end: string;
          period_start: string;
          provider?: string | null;
          provider_ref?: string | null;
          refunded_at?: string | null;
          status?: string;
          tax_pence?: number;
          updated_at?: string;
        };
        Update: {
          amount_pence?: number;
          attempts?: number;
          created_at?: string;
          currency?: string;
          due_on?: string;
          failure_reason?: string | null;
          id?: string;
          issued_on?: string;
          number?: string;
          org_id?: string;
          paid_at?: string | null;
          period_end?: string;
          period_start?: string;
          provider?: string | null;
          provider_ref?: string | null;
          refunded_at?: string | null;
          status?: string;
          tax_pence?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
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
      locations: {
        Row: {
          address: string | null;
          created_at: string;
          geofence_radius_m: number;
          id: string;
          latitude: number | null;
          location_type: string | null;
          longitude: number | null;
          name: string;
          org_id: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          geofence_radius_m?: number;
          id?: string;
          latitude?: number | null;
          location_type?: string | null;
          longitude?: number | null;
          name: string;
          org_id: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          geofence_radius_m?: number;
          id?: string;
          latitude?: number | null;
          location_type?: string | null;
          longitude?: number | null;
          name?: string;
          org_id?: string;
          status?: string;
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
      minimum_cover_rules: {
        Row: {
          created_at: string;
          id: string;
          location_id: string;
          min_staff: number;
          org_id: string;
          updated_at: string;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          location_id: string;
          min_staff?: number;
          org_id: string;
          updated_at?: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          location_id?: string;
          min_staff?: number;
          org_id?: string;
          updated_at?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'minimum_cover_rules_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'minimum_cover_rules_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
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
        Insert: {
          connected_at?: string;
          connected_by?: string | null;
          connector_key: string;
          created_at?: string;
          credentials_ref?: string | null;
          id?: string;
          last_error?: string | null;
          last_sync_at?: string | null;
          org_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          connected_at?: string;
          connected_by?: string | null;
          connector_key?: string;
          created_at?: string;
          credentials_ref?: string | null;
          id?: string;
          last_error?: string | null;
          last_sync_at?: string | null;
          org_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_integrations_connected_by_fkey';
            columns: ['connected_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_integrations_connector_key_fkey';
            columns: ['connector_key'];
            isOneToOne: false;
            referencedRelation: 'integration_connector_stats';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'org_integrations_connector_key_fkey';
            columns: ['connector_key'];
            isOneToOne: false;
            referencedRelation: 'integration_connectors';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'org_integrations_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
      };
      org_smtp_settings: {
        Row: {
          created_at: string;
          from_email: string;
          from_name: string | null;
          org_id: string;
          smtp_host: string;
          smtp_pass: string;
          smtp_port: number;
          smtp_user: string;
          updated_at: string;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string;
          from_email: string;
          from_name?: string | null;
          org_id: string;
          smtp_host: string;
          smtp_pass: string;
          smtp_port?: number;
          smtp_user: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          from_email?: string;
          from_name?: string | null;
          org_id?: string;
          smtp_host?: string;
          smtp_pass?: string;
          smtp_port?: number;
          smtp_user?: string;
          updated_at?: string;
          verified_at?: string | null;
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
      organisations: {
        Row: {
          contact_email: string | null;
          contact_phone: string | null;
          country: string;
          created_at: string;
          created_by: string | null;
          id: string;
          industry: string | null;
          is_demo: boolean;
          last_activity_at: string | null;
          name: string;
          plan: string;
          settings: Json;
          slug: string;
          status: string;
          support_access_allowed: boolean;
          suspended_at: string | null;
          suspended_reason: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          contact_email?: string | null;
          contact_phone?: string | null;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          industry?: string | null;
          is_demo?: boolean;
          last_activity_at?: string | null;
          name: string;
          plan?: string;
          settings?: Json;
          slug: string;
          status?: string;
          support_access_allowed?: boolean;
          suspended_at?: string | null;
          suspended_reason?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          contact_email?: string | null;
          contact_phone?: string | null;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          industry?: string | null;
          is_demo?: boolean;
          last_activity_at?: string | null;
          name?: string;
          plan?: string;
          settings?: Json;
          slug?: string;
          status?: string;
          support_access_allowed?: boolean;
          suspended_at?: string | null;
          suspended_reason?: string | null;
          timezone?: string;
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
      plans: {
        Row: {
          code: string;
          created_at: string;
          currency: string;
          description: string;
          features: string[];
          location_limit: number | null;
          monthly_price_pence: number;
          name: string;
          seat_limit: number | null;
          sort_order: number;
          stripe_price_id: string | null;
          stripe_test_price_id: string | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          currency?: string;
          description?: string;
          features?: string[];
          location_limit?: number | null;
          monthly_price_pence: number;
          name: string;
          seat_limit?: number | null;
          sort_order?: number;
          stripe_price_id?: string | null;
          stripe_test_price_id?: string | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          features?: string[];
          location_limit?: number | null;
          monthly_price_pence?: number;
          name?: string;
          seat_limit?: number | null;
          sort_order?: number;
          stripe_price_id?: string | null;
          stripe_test_price_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
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
            foreignKeyName: 'platform_admins_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_admins_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_admins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          announcement_id: string;
          created_at?: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          org_id: string;
          read_at?: string | null;
          read_by?: string | null;
          sent_at?: string | null;
        };
        Update: {
          announcement_id?: string;
          created_at?: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          org_id?: string;
          read_at?: string | null;
          read_by?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_announcement_deliveries_announcement_id_fkey';
            columns: ['announcement_id'];
            isOneToOne: false;
            referencedRelation: 'platform_announcements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_announcement_deliveries_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_announcement_deliveries_read_by_fkey';
            columns: ['read_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_announcement_optouts: {
        Row: {
          created_at: string;
          opted_out_by: string | null;
          org_id: string;
        };
        Insert: {
          created_at?: string;
          opted_out_by?: string | null;
          org_id: string;
        };
        Update: {
          created_at?: string;
          opted_out_by?: string | null;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_announcement_optouts_opted_out_by_fkey';
            columns: ['opted_out_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_announcement_optouts_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          audience?: string;
          audience_plans?: string[];
          body: string;
          channel?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          audience?: string;
          audience_plans?: string[];
          body?: string;
          channel?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_announcements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          checked_at?: string;
          id?: never;
          latency_ms?: number | null;
          service: string;
          source?: string;
          status: string;
        };
        Update: {
          checked_at?: string;
          id?: never;
          latency_ms?: number | null;
          service?: string;
          source?: string;
          status?: string;
        };
        Relationships: [];
      };
      platform_ip_allowlist: {
        Row: {
          cidr: unknown;
          created_at: string;
          created_by: string | null;
          id: string;
          label: string;
        };
        Insert: {
          cidr: unknown;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label: string;
        };
        Update: {
          cidr?: unknown;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_ip_allowlist_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_settings: {
        Row: {
          admin_session_minutes: number;
          api_rate_limit_per_min: number;
          created_at: string;
          default_timezone: string;
          email_provider: string;
          email_sender_address: string;
          email_sender_name: string;
          favicon_url: string | null;
          id: boolean;
          logo_url: string | null;
          maintenance_message: string | null;
          maintenance_mode: boolean;
          max_concurrent_sessions: number;
          max_upload_mb: number;
          permitted_file_types: string[];
          platform_name: string;
          platform_url: string;
          primary_colour: string;
          public_api_enabled: boolean;
          reauth_for_critical: boolean;
          registration_enabled: boolean;
          require_mfa: boolean;
          signin_alerts: boolean;
          support_branding: boolean;
          support_email: string;
          updated_at: string;
          updated_by: string | null;
          webhook_max_attempts: number;
        };
        Insert: {
          admin_session_minutes?: number;
          api_rate_limit_per_min?: number;
          created_at?: string;
          default_timezone?: string;
          email_provider?: string;
          email_sender_address?: string;
          email_sender_name?: string;
          favicon_url?: string | null;
          id?: boolean;
          logo_url?: string | null;
          maintenance_message?: string | null;
          maintenance_mode?: boolean;
          max_concurrent_sessions?: number;
          max_upload_mb?: number;
          permitted_file_types?: string[];
          platform_name?: string;
          platform_url?: string;
          primary_colour?: string;
          public_api_enabled?: boolean;
          reauth_for_critical?: boolean;
          registration_enabled?: boolean;
          require_mfa?: boolean;
          signin_alerts?: boolean;
          support_branding?: boolean;
          support_email?: string;
          updated_at?: string;
          updated_by?: string | null;
          webhook_max_attempts?: number;
        };
        Update: {
          admin_session_minutes?: number;
          api_rate_limit_per_min?: number;
          created_at?: string;
          default_timezone?: string;
          email_provider?: string;
          email_sender_address?: string;
          email_sender_name?: string;
          favicon_url?: string | null;
          id?: boolean;
          logo_url?: string | null;
          maintenance_message?: string | null;
          maintenance_mode?: boolean;
          max_concurrent_sessions?: number;
          max_upload_mb?: number;
          permitted_file_types?: string[];
          platform_name?: string;
          platform_url?: string;
          primary_colour?: string;
          public_api_enabled?: boolean;
          reauth_for_critical?: boolean;
          registration_enabled?: boolean;
          require_mfa?: boolean;
          signin_alerts?: boolean;
          support_branding?: boolean;
          support_email?: string;
          updated_at?: string;
          updated_by?: string | null;
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
      retention_policies: {
        Row: {
          data_type: string;
          enforced: boolean;
          label: string;
          note: string;
          retain_months: number | null;
          updated_at: string;
        };
        Insert: {
          data_type: string;
          enforced?: boolean;
          label: string;
          note?: string;
          retain_months?: number | null;
          updated_at?: string;
        };
        Update: {
          data_type?: string;
          enforced?: boolean;
          label?: string;
          note?: string;
          retain_months?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      retention_runs: {
        Row: {
          cutoff: string | null;
          data_type: string;
          dry_run: boolean;
          error: string | null;
          id: number;
          ran_at: string;
          rows_removed: number;
        };
        Insert: {
          cutoff?: string | null;
          data_type: string;
          dry_run?: boolean;
          error?: string | null;
          id?: never;
          ran_at?: string;
          rows_removed?: number;
        };
        Update: {
          cutoff?: string | null;
          data_type?: string;
          dry_run?: boolean;
          error?: string | null;
          id?: never;
          ran_at?: string;
          rows_removed?: number;
        };
        Relationships: [];
      };
      rotas: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          location_id: string | null;
          name: string;
          org_id: string;
          period_end: string;
          period_start: string;
          published_at: string | null;
          published_by: string | null;
          status: string;
          supersedes_rota_id: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location_id?: string | null;
          name: string;
          org_id: string;
          period_end: string;
          period_start: string;
          published_at?: string | null;
          published_by?: string | null;
          status?: string;
          supersedes_rota_id?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location_id?: string | null;
          name?: string;
          org_id?: string;
          period_end?: string;
          period_start?: string;
          published_at?: string | null;
          published_by?: string | null;
          status?: string;
          supersedes_rota_id?: string | null;
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
          email: string | null;
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
          email?: string | null;
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
          email?: string | null;
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
          canceled_at: string | null;
          created_at: string;
          currency: string;
          current_period_end: string | null;
          id: string;
          org_id: string;
          plan: string;
          price_pence: number | null;
          provider: string | null;
          provider_ref: string | null;
          started_at: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_mode: string;
          trial_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          canceled_at?: string | null;
          created_at?: string;
          currency?: string;
          current_period_end?: string | null;
          id?: string;
          org_id: string;
          plan?: string;
          price_pence?: number | null;
          provider?: string | null;
          provider_ref?: string | null;
          started_at?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_mode?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          canceled_at?: string | null;
          created_at?: string;
          currency?: string;
          current_period_end?: string | null;
          id?: string;
          org_id?: string;
          plan?: string;
          price_pence?: number | null;
          provider?: string | null;
          provider_ref?: string | null;
          started_at?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_mode?: string;
          trial_ends_at?: string | null;
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
      support_access_sessions: {
        Row: {
          admin_user_id: string;
          case_ref: string;
          expires_at: string;
          granted_at: string;
          id: string;
          org_id: string;
          reason: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          scope: string;
        };
        Insert: {
          admin_user_id: string;
          case_ref: string;
          expires_at: string;
          granted_at?: string;
          id?: string;
          org_id: string;
          reason: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scope?: string;
        };
        Update: {
          admin_user_id?: string;
          case_ref?: string;
          expires_at?: string;
          granted_at?: string;
          id?: string;
          org_id?: string;
          reason?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scope?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'support_access_sessions_admin_user_id_fkey';
            columns: ['admin_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'support_access_sessions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'support_access_sessions_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          author_id?: string | null;
          author_name?: string | null;
          author_side: string;
          body: string;
          case_id: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
        };
        Update: {
          author_id?: string | null;
          author_name?: string | null;
          author_side?: string;
          body?: string;
          case_id?: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'support_case_messages_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'support_case_messages_case_id_fkey';
            columns: ['case_id'];
            isOneToOne: false;
            referencedRelation: 'support_cases';
            referencedColumns: ['id'];
          },
        ];
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
        Insert: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          csat?: number | null;
          csat_comment?: string | null;
          first_response_at?: string | null;
          id?: string;
          org_id?: string | null;
          priority?: string;
          reference: string;
          requester_email: string;
          requester_id?: string | null;
          requester_name?: string | null;
          resolved_at?: string | null;
          status?: string;
          subject: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          csat?: number | null;
          csat_comment?: string | null;
          first_response_at?: string | null;
          id?: string;
          org_id?: string | null;
          priority?: string;
          reference?: string;
          requester_email?: string;
          requester_id?: string | null;
          requester_name?: string | null;
          resolved_at?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'support_cases_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'support_cases_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'support_cases_requester_id_fkey';
            columns: ['requester_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
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
      org_smtp_settings_safe: {
        Row: {
          created_at: string | null;
          from_email: string | null;
          from_name: string | null;
          org_id: string | null;
          smtp_host: string | null;
          smtp_port: number | null;
          smtp_user: string | null;
          updated_at: string | null;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          org_id?: string | null;
          smtp_host?: string | null;
          smtp_port?: number | null;
          smtp_user?: string | null;
          updated_at?: string | null;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          org_id?: string | null;
          smtp_host?: string | null;
          smtp_port?: number | null;
          smtp_user?: string | null;
          updated_at?: string | null;
          verified_at?: string | null;
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
    };
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      add_incident_update: {
        Args: { p_body: string; p_incident: string; p_status: string };
        Returns: string;
      };
      admin_create_organisation_with_invite: {
        Args: {
          p_name: string;
          p_owner_email: string;
          p_plan: string;
          p_price_pence?: number;
          p_slug: string;
        };
        Returns: {
          invite_expires_at: string;
          invite_token: string;
          org_id: string;
        }[];
      };
      anonymize_staff_member: {
        Args: { p_org: string; p_staff_profile_id: string };
        Returns: undefined;
      };
      apply_swap_reassignment: {
        Args: { p_swap_id: string };
        Returns: Database['public']['Tables']['shifts']['Row'];
      };
      begin_rota_revision: {
        Args: { p_rota_id: string };
        Returns: Database['public']['Tables']['rotas']['Row'];
      };
      discard_rota_revision: {
        Args: { p_rota_id: string };
        Returns: Database['public']['Tables']['rotas']['Row'];
      };
      publish_rota: {
        Args: { p_rota_id: string };
        Returns: Database['public']['Tables']['rotas']['Row'];
      };
      unpublish_rota: {
        Args: { p_rota_id: string };
        Returns: Database['public']['Tables']['rotas']['Row'];
      };
      delete_organisation: {
        Args: { p_confirm_name: string; p_org: string };
        Returns: undefined;
      };
      organisation_deletion_preview: {
        Args: { p_org: string };
        Returns: {
          clock_events: number;
          documents: number;
          leave_requests: number;
          locations: number;
          members: number;
          rotas: number;
          shifts: number;
          staff_profiles: number;
        }[];
      };
      assign_support_case: {
        Args: { p_agent?: string; p_case: string };
        Returns: undefined;
      };
      audit_write: {
        Args: {
          p_action: string;
          p_entity_id: string;
          p_entity_type: string;
          p_metadata: Json;
          p_org: string;
          p_severity: string;
          p_visibility?: string;
        };
        Returns: undefined;
      };
      connect_integration: {
        Args: { p_connector: string; p_org: string; p_ref?: string };
        Returns: string;
      };
      create_invite: {
        Args: { p_email: string; p_org: string; p_role?: string };
        Returns: {
          expires_at: string;
          invite_id: string;
          token: string;
        }[];
      };
      create_platform_announcement: {
        Args: {
          p_audience?: string;
          p_body: string;
          p_channel?: string;
          p_kind?: string;
          p_plans?: string[];
          p_scheduled_for?: string;
          p_title: string;
        };
        Returns: string;
      };
      declare_incident: {
        Args: {
          p_impact: string;
          p_service: string;
          p_severity: string;
          p_started_at?: string;
          p_title: string;
        };
        Returns: string;
      };
      enforce_retention: {
        Args: { p_dry_run?: boolean };
        Returns: {
          cutoff: string;
          data_type: string;
          rows_removed: number;
        }[];
      };
      extend_gdpr_request: {
        Args: { p_reason: string; p_request: string };
        Returns: string;
      };
      flag_enabled_for_org: {
        Args: { p_key: string; p_org: string };
        Returns: boolean;
      };
      grant_platform_role: {
        Args: { p_role: string; p_user: string };
        Returns: undefined;
      };
      has_org_role: {
        Args: { p_org: string; p_roles: string[] };
        Returns: boolean;
      };
      has_platform_role: { Args: { p_roles: string[] }; Returns: boolean };
      has_support_access: {
        Args: { p_org: string; p_write?: boolean };
        Returns: boolean;
      };
      is_org_member: { Args: { p_org: string }; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      issue_invoice: {
        Args: {
          p_amount_pence?: number;
          p_org: string;
          p_period_end: string;
          p_period_start: string;
        };
        Returns: string;
      };
      log_audit_event: {
        Args: {
          p_action: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_metadata?: Json;
          p_org: string;
        };
        Returns: undefined;
      };
      log_gdpr_request: {
        Args: {
          p_kind: string;
          p_org?: string;
          p_received_on?: string;
          p_subject_email: string;
          p_subject_name: string;
        };
        Returns: string;
      };
      mark_announcement_read: {
        Args: { p_announcement: string };
        Returns: undefined;
      };
      my_active_org_ids: { Args: never; Returns: string[] };
      my_feature_access: {
        Args: { p_org: string };
        Returns: {
          feature: string;
          source: string;
        }[];
      };
      my_platform_role: { Args: never; Returns: string };
      my_staff_profile_id: { Args: { p_org: string }; Returns: string };
      open_support_case: {
        Args: {
          p_body: string;
          p_category?: string;
          p_org?: string;
          p_priority?: string;
          p_requester_email?: string;
          p_subject: string;
        };
        Returns: string;
      };
      org_has_feature: {
        Args: { p_feature: string; p_org: string };
        Returns: boolean;
      };
      platform_auth_facts_summary: {
        Args: never;
        Returns: {
          active_30d: number;
          banned: number;
          inactive_90d: number;
          mfa_enrolled: number;
          total_accounts: number;
          unverified: number;
        }[];
      };
      platform_location_counts: {
        Args: never;
        Returns: {
          locations: number;
          org_id: string;
        }[];
      };
      platform_tenant_counts: {
        Args: { p_org: string };
        Returns: {
          departments: number;
          locations: number;
          published_rotas: number;
          shifts_month: number;
          staff_active: number;
          staff_total: number;
        }[];
      };
      platform_totals: {
        Args: never;
        Returns: {
          active_orgs: number;
          organisations: number;
          profiles: number;
          published_rotas: number;
          shifts_month: number;
          staff_profiles: number;
        }[];
      };
      platform_user_auth_facts: {
        Args: { p_user: string };
        Returns: {
          banned_until: string;
          email_confirmed_at: string;
          last_sign_in_at: string;
          mfa_enrolled: boolean;
        }[];
      };
      preview_invite: {
        Args: { p_token: string };
        Returns: {
          email: string;
          expires_at: string;
          org_name: string;
          role: string;
        }[];
      };
      publish_platform_announcement: {
        Args: { p_announcement: string };
        Returns: number;
      };
      rate_support_case: {
        Args: { p_case: string; p_comment?: string; p_score: number };
        Returns: undefined;
      };
      record_health_sample: {
        Args: {
          p_latency_ms?: number;
          p_service: string;
          p_source?: string;
          p_status: string;
        };
        Returns: undefined;
      };
      reply_to_support_case: {
        Args: { p_body: string; p_case: string; p_internal?: boolean };
        Returns: string;
      };
      request_support_access: {
        Args: {
          p_case_ref: string;
          p_minutes: number;
          p_org: string;
          p_reason: string;
          p_scope: string;
        };
        Returns: string;
      };
      resolve_incident: {
        Args: { p_incident: string; p_resolution: string };
        Returns: undefined;
      };
      revoke_platform_role: { Args: { p_user: string }; Returns: undefined };
      revoke_support_access: {
        Args: { p_reason?: string; p_session: string };
        Returns: undefined;
      };
      set_feature_flag: {
        Args: {
          p_enabled?: boolean;
          p_key: string;
          p_plans?: string[];
          p_rollout?: number;
        };
        Returns: undefined;
      };
      set_feature_flag_target: {
        Args: { p_key: string; p_org: string; p_targeted: boolean };
        Returns: undefined;
      };
      set_gdpr_request_status: {
        Args: { p_note?: string; p_request: string; p_status: string };
        Returns: undefined;
      };
      set_invoice_status: {
        Args: { p_invoice: string; p_reason?: string; p_status: string };
        Returns: undefined;
      };
      set_org_integration_status: {
        Args: { p_connector: string; p_org: string; p_status: string };
        Returns: undefined;
      };
      set_org_status: {
        Args: { p_org: string; p_reason?: string; p_status: string };
        Returns: undefined;
      };
      set_org_support_access: {
        Args: { p_allowed: boolean; p_org: string };
        Returns: undefined;
      };
      set_support_case_status: {
        Args: { p_case: string; p_note?: string; p_status: string };
        Returns: undefined;
      };
      slug_available: {
        Args: { p_slug: string; p_exclude_org_id?: string };
        Returns: boolean;
      };
      subscription_mrr_pence: { Args: { p_org: string }; Returns: number };
      support_access_status: {
        Args: {
          s: Database['public']['Tables']['support_access_sessions']['Row'];
        };
        Returns: string;
      };
      touch_org_activity: { Args: { p_org: string }; Returns: undefined };
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

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
