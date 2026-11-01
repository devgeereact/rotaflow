<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

/**
 * The source -> target map for the Supabase -> MariaDB data move, one entry per target table, in foreign-key order inside
 * each group; groups are applied in the order listed, one transaction each. Every source SELECT names its columns exactly
 * as the target table does; columns starting with "_" are helpers for transform() and the report, never written.
 * Macros, expanded by Mover: {ts:expr} formats a timestamptz as a UTC "YYYY-MM-DD HH:MM:SS.ffffff" string, {org:expr} is
 * the --exclude-org filter (true when the organisation is moved), {src:table.column;expr;default} is expr when the source
 * has that table or column and default when it does not (SourceSchema: production stopped at 0156, the repo is at 0164).
 * A mapped table the source does not have at all (storage_deletions before 0159, account_deletions before 0162) is left out
 * of the plan with one warning.
 *
 * Every public table of the source is either mapped here (via 'source') or listed in SKIPPED with the reason, and every
 * source column of a mapped table is either named in its SELECT or listed in 'dropped' with the reason: Mover checks both
 * against the live source and reports anything new as a problem, so a column added in production but not in the repo
 * cannot be lost silently.
 */
final class Map
{
    public const GROUPS = ['identity', 'places', 'rota', 'time', 'communication', 'compliance', 'billing', 'platform', 'gdpr', 'audit'];

    /** Source tables deliberately not moved, with the reason shown in the report. */
    public const SKIPPED = [
        'profiles' => 'merged into users (email, name, avatar); is_platform_admin is the legacy flag, platform_admins is the record',
        'calendar_feed_tokens' => 'feed URLs were Supabase-era (uuid tokens); the API only accepts its own 43-character tokens: people subscribe again from Account',
        'notification_outbox' => 'the old drain must be empty before the move (runbook step); pending rows would be re-sent in another payload shape',
        'notification_deliveries' => 'delivery log only (12-month retention); the new dispatcher keeps its own',
        'background_jobs' => 'Supabase queue; no reader in the API',
        'integration_connectors' => 'integrations are on the cut list (MERGE-TARGET)',
        'org_integrations' => 'integrations are on the cut list (MERGE-TARGET)',
        'integration_sync_runs' => 'integrations are on the cut list (MERGE-TARGET)',
        'platform_health_probes' => 'Supabase health probe; replaced by an external uptime check',
        'platform_health_samples' => 'Supabase health probe; replaced by an external uptime check',
        'platform_ip_allowlist' => 'IP allow-list is on the cut list (MERGE-TARGET)',
        'rate_limit_events' => 'short-lived abuse counters',
        'retention_runs' => 'run log of the old retention job',
    ];

    /** @return list<array<string,mixed>> */
    public static function tables(): array
    {
        return [
            // ---- identity ----
            [
                'table' => 'users', 'group' => 'identity', 'key' => ['id'], 'source' => 'profiles', 'transform' => 'users',
                'sql' => "SELECT u.id::text AS id, lower(btrim(coalesce(u.email, p.email))) AS email,
                    nullif(btrim(coalesce(nullif(p.full_name, ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '') AS full_name,
                    p.avatar_url AS avatar_url, {ts:u.last_sign_in_at} AS last_seen_at,
                    {ts:coalesce(p.created_at, u.created_at)} AS created_at, {ts:coalesce(p.updated_at, u.updated_at, u.created_at)} AS updated_at,
                    (p.id IS NOT NULL) AS _has_profile, {ts:u.deleted_at} AS _deleted_at, (u.email_confirmed_at IS NOT NULL) AS _confirmed,
                    (u.banned_until IS NOT NULL AND u.banned_until > now()) AS _banned, coalesce(u.is_anonymous, false) AS _anonymous,
                    lower(btrim(p.email)) AS _profile_email, coalesce(p.is_platform_admin, false) AS _legacy_admin,
                    {src:account_deletions;EXISTS (SELECT 1 FROM public.account_deletions d WHERE d.user_id = u.id AND d.status <> 'done');false} AS _pending_erasure,
                    EXISTS (SELECT 1 FROM public.gdpr_requests g WHERE g.kind = 'erasure' AND g.status = 'completed'
                      AND lower(btrim(g.subject_email)) = lower(btrim(u.email)) AND u.created_at < coalesce(g.closed_at, g.updated_at)) AS _erasure_closed,
                    EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = u.id AND m.role = 'owner' AND m.status = 'active') AS _owner,
                    EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id) AS _platform_admin,
                    (SELECT string_agg(DISTINCT i.provider, ',' ORDER BY i.provider) FROM auth.identities i WHERE i.user_id = u.id) AS _providers
                  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
                  WHERE p.id IS NOT NULL OR u.id IN (
                    SELECT created_by FROM public.rotas UNION SELECT published_by FROM public.rotas UNION SELECT approved_by FROM public.timesheets
                    UNION SELECT actor_user_id FROM public.clock_event_corrections UNION SELECT created_by FROM public.invoice_credits)",
                'order' => 'u.id', 'dropped' => [],
            ],
            [
                'table' => 'organisations', 'group' => 'identity', 'key' => ['id'], 'source' => 'organisations', 'transform' => 'organisations',
                'sql' => "SELECT o.id::text AS id, o.name, o.slug, o.plan, o.status, {ts:o.suspended_at} AS suspended_at, o.suspended_reason,
                    o.support_access_allowed, {ts:o.trial_ends_at} AS trial_ends_at, o.settings::text AS settings, o.created_by::text AS created_by,
                    {ts:o.created_at} AS created_at, {ts:o.updated_at} AS updated_at, {ts:o.onboarding_completed_at} AS onboarding_completed_at,
                    o.industry, o.country, o.timezone, o.contact_email, o.contact_phone, o.is_demo AS _is_demo
                  FROM public.organisations o WHERE {org:o.id}",
                'order' => 'o.id',
                'dropped' => ['last_activity_at' => 'derived; the console computes activity from the audit trail', 'is_demo' => 'reported; demo organisations move unless --exclude-demo-orgs'],
            ],
            self::plain('memberships', 'identity', 'm', 'id, org_id, user_id, role, status, {ts:created_at}, {ts:updated_at}'),
            [
                'table' => 'platform_admins', 'group' => 'identity', 'key' => ['user_id'], 'source' => 'platform_admins',
                'sql' => "SELECT a.user_id::text AS user_id, a.role, a.granted_by::text AS granted_by, {ts:a.granted_at} AS granted_at,
                    a.revoked_by::text AS revoked_by, {ts:a.revoked_at} AS revoked_at, a.note FROM public.platform_admins a",
                'order' => 'a.user_id', 'dropped' => ['created_at' => 'granted_at is the record', 'updated_at' => 'not kept by the target'],
            ],
            self::plain('role_delegations', 'identity', 'r', 'id, org_id, from_user_id, to_user_id, {ts:starts_at}, {ts:ends_at}, {ts:revoked_at}, note, {ts:created_at}'),
            [
                'table' => 'app_settings', 'group' => 'identity', 'key' => ['user_id'], 'source' => 'app_settings',
                'sql' => "SELECT s.user_id::text AS user_id, s.theme, {src:app_settings.time_format;s.time_format;'24h'::text} AS time_format,
                    {src:app_settings.week_start;s.week_start;'monday'::text} AS week_start,
                    {src:app_settings.digest_frequency;s.digest_frequency;'immediate'::text} AS digest_frequency, s.notifications_enabled,
                    {ts:s.updated_at} AS updated_at FROM public.app_settings s",
                'order' => 's.user_id', 'dropped' => ['id' => 'the target keys app_settings by user_id', 'created_at' => 'not kept by the target'],
            ],
            [
                'table' => 'push_subscriptions', 'group' => 'identity', 'key' => ['id'], 'source' => 'push_subscriptions',
                'sql' => "SELECT s.id::text AS id, s.user_id::text AS user_id, s.endpoint, encode(sha256(convert_to(s.endpoint, 'UTF8')), 'hex') AS endpoint_hash,
                    s.p256dh, s.auth_key, {ts:s.created_at} AS created_at FROM public.push_subscriptions s",
                'order' => 's.id', 'dropped' => [],
            ],
            [
                'table' => 'invites', 'group' => 'identity', 'key' => ['id'], 'source' => 'invites', 'transform' => 'invites',
                'sql' => "SELECT i.id::text AS id, i.org_id::text AS org_id, i.email, i.role, i.token_hash, {ts:i.expires_at} AS expires_at,
                    {ts:i.accepted_at} AS accepted_at, {ts:i.revoked_at} AS revoked_at, i.invited_by::text AS invited_by, {ts:i.last_sent_at} AS last_sent_at,
                    i.send_error, {ts:i.created_at} AS created_at, i.department_id::text AS department_id, i.location_id::text AS location_id
                  FROM public.invites i WHERE {org:i.org_id}",
                'order' => 'i.id', 'dropped' => ['accepted_by' => 'the membership created on acceptance is the record', 'updated_at' => 'not kept by the target'],
            ],
            // ---- people and places ----
            self::plain('locations', 'places', 'l', 'id, org_id, name, address, latitude, longitude, timezone, geofence_radius_m, location_type, status, {ts:created_at}, {ts:updated_at}'),
            self::plain('departments', 'places', 'd', 'id, org_id, location_id, name, {ts:created_at}, {ts:updated_at}'),
            self::plain('job_titles', 'places', 'j', 'id, org_id, name, colour, active, {ts:created_at}, {ts:updated_at}', ['name_normalised' => 'generated by the target from name']),
            [
                'table' => 'staff_profiles', 'group' => 'places', 'key' => ['id'], 'source' => 'staff_profiles', 'transform' => 'staffProfiles',
                'sql' => "SELECT s.id::text AS id, s.org_id::text AS org_id, s.user_id::text AS user_id, s.email, s.first_name, s.last_name, s.job_title,
                    s.job_title_id::text AS job_title_id, s.department_id::text AS department_id, s.contract_type, s.weekly_hours::text AS weekly_hours,
                    s.holiday_allowance::text AS holiday_allowance, to_json(s.skills)::text AS skills, s.payroll_id, s.start_date::text AS start_date,
                    s.phone, s.photo_url, {src:staff_profiles.photo_path;s.photo_path;NULL::text} AS photo_path, s.active, {ts:s.created_at} AS created_at, {ts:s.updated_at} AS updated_at
                  FROM public.staff_profiles s WHERE {org:s.org_id}",
                'order' => 's.id', 'dropped' => [],
            ],
            [
                'table' => 'staff_locations', 'group' => 'places', 'key' => ['staff_profile_id', 'location_id'], 'source' => 'staff_locations',
                'sql' => "SELECT x.staff_profile_id::text AS staff_profile_id, x.location_id::text AS location_id, x.org_id::text AS org_id,
                    {ts:x.created_at} AS created_at FROM public.staff_locations x WHERE {org:x.org_id}",
                'order' => 'x.staff_profile_id, x.location_id', 'dropped' => [],
            ],
            [
                'table' => 'staff_pay_rates', 'group' => 'places', 'key' => ['id'], 'source' => 'staff_pay_rates', 'transform' => 'payRates',
                'sql' => "SELECT r.id::text AS id, r.org_id::text AS org_id, r.staff_profile_id::text AS staff_profile_id, r.hourly_rate_pence,
                    r.effective_from::text AS effective_from, {ts:r.created_at} AS created_at, (r.note IS NOT NULL AND btrim(r.note) <> '') AS _has_note
                  FROM public.staff_pay_rates r WHERE {org:r.org_id}",
                'order' => 'r.id', 'dropped' => ['note' => 'LOSSY: the target keeps no note on a pay rate (counted in the report)', 'created_by' => 'LOSSY: who entered a rate is in the audit trail only'],
            ],
            self::plain('emergency_contacts', 'places', 'e', 'id, org_id, staff_profile_id, name, relationship, phone, secondary_phone, {ts:created_at}, {ts:updated_at}',
                ['medical_notes' => 'NEVER moved: Article 9 data about someone with no rights channel here; 0164 purges it on Supabase (decision D5, docs/AUDIT.md A-DM-2). Present only at a source before 0164; the plan counts the non-blank ones']),
            // ---- the rota ----
            self::plain('shift_types', 'rota', 't', 'id, org_id, name, colour, default_start, default_end, is_paid, category, {ts:created_at}, {ts:updated_at}'),
            [
                'table' => 'rotas', 'group' => 'rota', 'key' => ['id'], 'source' => 'rotas',
                'sql' => "SELECT r.id::text AS id, r.org_id::text AS org_id, r.location_id::text AS location_id, r.name, r.period_start::text AS period_start,
                    r.period_end::text AS period_end, r.status, {ts:r.published_at} AS published_at, r.published_by::text AS published_by,
                    {ts:r.archived_at} AS archived_at, r.supersedes_rota_id::text AS supersedes_rota_id, r.created_by::text AS created_by,
                    {ts:r.created_at} AS created_at, {ts:r.updated_at} AS updated_at, coalesce(r.location_id::text, '-') AS site_key
                  FROM public.rotas r WHERE {org:r.org_id}",
                'order' => 'r.id', 'dropped' => [],
            ],
            self::plain('shifts', 'rota', 's', 'id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, {ts:starts_at}, {ts:ends_at}, break_minutes, status, colour, notes, {ts:created_at}, {ts:updated_at}'),
            self::plain('availability', 'rota', 'a', 'id, org_id, staff_profile_id, weekday, date, start_time, end_time, status, recurring, {ts:created_at}, {ts:updated_at}'),
            self::plain('minimum_cover_rules', 'rota', 'c', 'id, org_id, location_id, weekday, min_staff, {ts:created_at}, {ts:updated_at}'),
            // ---- time and requests ----
            self::plain('clock_events', 'time', 'c', 'id, org_id, staff_profile_id, shift_id, type, {ts:event_at}, {ts:event_at_reported}, latitude, longitude, accuracy, method, location_name, synced, client_event_id, {ts:created_at}, {ts:updated_at}'),
            self::plain('clock_event_corrections', 'time', 'c', 'id, org_id, clock_event_id, staff_profile_id, actor_user_id, actor_name, reason, before_value, after_value, {ts:created_at}'),
            self::plain('leave_requests', 'time', 'l', 'id, org_id, staff_profile_id, type, start_date, end_date, starts_half, ends_half, status, reason, reviewed_by, {ts:reviewed_at}, client_event_id, {ts:created_at}, {ts:updated_at}'),
            self::plain('overtime_requests', 'time', 'o', 'id, org_id, staff_profile_id, date, hours, status, note, reviewed_by, {ts:reviewed_at}, {ts:created_at}, {ts:updated_at}'),
            self::plain('shift_swaps', 'time', 'w', 'id, org_id, shift_id, requested_by, target_staff_profile_id, status, note, reviewed_by, {ts:reviewed_at}, {ts:applied_at}, applied_shift_id, applied_from_staff_profile_id, client_event_id, {ts:created_at}, {ts:updated_at}'),
            self::plain('timesheets', 'time', 't', 'id, org_id, staff_profile_id, period_start, period_end, total_minutes, status, approved_by, {ts:approved_at}, version, {ts:recalculation_required_at}, {ts:created_at}, {ts:updated_at}'),
            // ---- communication ----
            [
                'table' => 'notification_templates', 'group' => 'communication', 'key' => ['id'], 'source' => 'notification_templates',
                'sql' => "SELECT n.id::text AS id, n.org_id::text AS org_id, coalesce(n.org_id::text, '-') AS org_key, n.key, n.channel, n.subject, n.body,
                    {ts:n.updated_at} AS updated_at FROM public.notification_templates n WHERE {org:n.org_id}",
                'order' => 'n.id', 'dropped' => [],
            ],
            self::plain('notifications', 'communication', 'n', 'id, org_id, user_id, type, title, body, channel, {ts:read_at}, {ts:created_at}, {ts:updated_at}'),
            self::plain('announcements', 'communication', 'a', 'id, org_id, author_user_id, scope, location_id, department_id, title, body, urgent, {ts:published_at}, {ts:created_at}, {ts:updated_at}'),
            [
                'table' => 'announcement_reads', 'group' => 'communication', 'key' => ['announcement_id', 'staff_profile_id'], 'source' => 'announcement_reads',
                'sql' => "SELECT r.announcement_id::text AS announcement_id, r.staff_profile_id::text AS staff_profile_id, r.org_id::text AS org_id,
                    {ts:r.read_at} AS read_at FROM public.announcement_reads r WHERE {org:r.org_id}",
                'order' => 'r.announcement_id, r.staff_profile_id', 'dropped' => ['id' => 'the target keys a read by (announcement, person)'],
            ],
            [
                'table' => 'org_smtp_settings', 'group' => 'communication', 'key' => ['org_id'], 'source' => 'org_smtp_settings', 'transform' => 'smtp',
                'secret' => ['smtp_pass_enc' => '_smtp_pass'],
                'sql' => "SELECT s.org_id::text AS org_id, s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass AS _smtp_pass, s.from_email, s.from_name,
                    {ts:s.verified_at} AS verified_at, {ts:s.created_at} AS created_at, {ts:s.updated_at} AS updated_at
                  FROM public.org_smtp_settings s WHERE {org:s.org_id}",
                'order' => 's.org_id', 'dropped' => [],
            ],
            // ---- compliance ----
            [
                'table' => 'documents', 'group' => 'compliance', 'key' => ['id'], 'source' => 'documents', 'transform' => 'documents',
                'sql' => "SELECT d.id::text AS id, d.org_id::text AS org_id, d.staff_profile_id::text AS staff_profile_id, d.type, d.name, d.file_url,
                    {src:documents.storage_path;d.storage_path;NULL::text} AS storage_path,
                    (SELECT o.metadata->>'mimetype' FROM storage.objects o WHERE o.bucket_id = 'staff-documents' AND o.name = {src:documents.storage_path;d.storage_path;NULL::text}) AS mime,
                    d.issued_at::text AS issued_at, d.expires_at::text AS expires_at, 'approved' AS status, {ts:d.created_at} AS created_at, {ts:d.updated_at} AS updated_at
                  FROM public.documents d WHERE {org:d.org_id}",
                'order' => 'd.id', 'dropped' => [],
            ],
            // ---- billing ----
            [
                'table' => 'plans', 'group' => 'billing', 'key' => ['code'], 'source' => 'plans', 'mode' => 'reference',
                'update' => ['stripe_price_id', 'stripe_test_price_id'], 'compare' => ['name', 'monthly_price_pence', 'currency', 'seat_limit', 'location_limit', 'features'],
                'sql' => "SELECT p.code, p.name, p.monthly_price_pence, p.currency, p.seat_limit, p.location_limit, to_json(p.features)::text AS features,
                    p.stripe_price_id, p.stripe_test_price_id FROM public.plans p",
                'order' => 'p.code', 'dropped' => ['description' => 'the target seeds its own wording', 'sort_order' => 'the target seeds its own order', 'created_at' => 'reference row', 'updated_at' => 'reference row'],
            ],
            self::plain('subscriptions', 'billing', 's', 'id, org_id, plan, status, provider, provider_ref, stripe_customer_id, stripe_mode, price_pence, currency, {ts:started_at}, {ts:current_period_end}, {ts:trial_ends_at}, {ts:canceled_at}, {ts:past_due_since}, {ts:grace_until}, {ts:created_at}, {ts:updated_at}'),
            self::plain('invoices', 'billing', 'i', 'id, org_id, number, period_start, period_end, amount_pence, tax_pence, currency, status, issued_on, due_on, {ts:paid_at}, {ts:refunded_at}, failure_reason, attempts, provider, provider_ref, hosted_invoice_url, invoice_pdf, {ts:created_at}, {ts:updated_at}'),
            self::plain('invoice_credits', 'billing', 'c', 'id, invoice_id, org_id, amount_pence, currency, reason, idempotency_key, created_by, {ts:created_at}'),
            [
                'table' => 'billing_events', 'group' => 'billing', 'key' => ['id'], 'source' => 'billing_events',
                'sql' => "SELECT b.id::text AS id, b.provider, b.mode, b.event_id, b.event_type, b.org_id::text AS org_id, {ts:b.event_created_at} AS event_created_at,
                    {ts:b.received_at} AS received_at, {ts:b.processed_at} AS processed_at, b.deliveries, b.last_error
                  FROM public.billing_events b WHERE b.org_id IS NULL OR {org:b.org_id}",
                'order' => 'b.id', 'dropped' => [],
            ],
            // ---- platform ----
            [
                'table' => 'platform_settings', 'group' => 'platform', 'key' => ['id'], 'source' => 'platform_settings', 'mode' => 'reference', 'transform' => 'platformSettings',
                'update' => ['platform_name', 'support_email', 'platform_url', 'default_timezone', 'registration_enabled', 'updated_by'],
                'compare' => ['maintenance_mode'],
                'sql' => "SELECT 1 AS id, s.platform_name, s.support_email, s.platform_url, s.default_timezone, s.registration_enabled, s.maintenance_mode,
                    s.updated_by::text AS updated_by FROM public.platform_settings s",
                'order' => 's.id',
                'dropped' => [
                    'maintenance_message' => 'never copied: the old site is frozen for the move; the new one must not start in maintenance',
                    'created_at' => 'reference row', 'updated_at' => 'reference row', 'logo_url' => 'LOSSY: no branding settings in the target', 'favicon_url' => 'LOSSY: no branding settings',
                    'primary_colour' => 'LOSSY: no branding settings', 'support_branding' => 'LOSSY: no branding settings', 'require_mfa' => 'two-step sign-in is set in Clerk',
                    'admin_session_minutes' => 'sessions are Clerk\'s', 'max_concurrent_sessions' => 'sessions are Clerk\'s', 'signin_alerts' => 'sign-in is Clerk\'s',
                    'reauth_for_critical' => 'sign-in is Clerk\'s', 'email_sender_name' => 'the platform mail account is private config (smtp)',
                    'email_sender_address' => 'the platform mail account is private config (smtp)', 'email_provider' => 'the platform mail account is private config (smtp)',
                    'max_upload_mb' => 'upload limits are in the API code', 'permitted_file_types' => 'upload types are in the API code',
                    'public_api_enabled' => 'no public API in the target', 'api_rate_limit_per_min' => 'rate limits are in the API code', 'webhook_max_attempts' => 'no outgoing webhooks in the target',
                ],
            ],
            [
                'table' => 'feature_flags', 'group' => 'platform', 'key' => ['flag_key'], 'source' => 'feature_flags', 'mode' => 'reference',
                'update' => ['enabled', 'rollout', 'target_plans', 'environment', 'critical', 'updated_by', 'retired_at', 'retired_reason'], 'compare' => [],
                'sql' => "SELECT f.key AS flag_key, f.enabled, f.rollout, to_json(f.target_plans)::text AS target_plans, f.environment, f.critical,
                    f.updated_by::text AS updated_by, {ts:f.retired_at} AS retired_at, f.retired_reason FROM public.feature_flags f",
                'order' => 'f.key',
                'dropped' => ['name' => 'the target seeds its own', 'description' => 'the target seeds its own', 'created_at' => 'reference row', 'updated_at' => 'reference row'],
            ],
            [
                'table' => 'feature_flag_targets', 'group' => 'platform', 'key' => ['flag_key', 'org_id'], 'source' => 'feature_flag_targets', 'transform' => 'flagChild',
                'sql' => "SELECT t.flag_key, t.org_id::text AS org_id, {ts:t.created_at} AS created_at FROM public.feature_flag_targets t WHERE {org:t.org_id}",
                'order' => 't.flag_key, t.org_id', 'dropped' => [],
            ],
            [
                'table' => 'feature_flag_changes', 'group' => 'platform', 'key' => ['id'], 'source' => 'feature_flag_changes', 'transform' => 'flagChild',
                'sql' => "SELECT c.id::text AS id, c.flag_key, c.actor_id::text AS actor_id, c.actor_name, c.field AS field_name, c.before_value, c.after_value,
                    {ts:c.created_at} AS created_at FROM public.feature_flag_changes c",
                'order' => 'c.id', 'dropped' => [],
            ],
            [
                'table' => 'support_sla_targets', 'group' => 'platform', 'key' => ['priority'], 'source' => 'support_sla_targets', 'mode' => 'reference',
                'update' => ['first_response_minutes', 'resolution_minutes'], 'compare' => [],
                'sql' => 'SELECT t.priority, t.first_response_minutes, t.resolution_minutes FROM public.support_sla_targets t', 'order' => 't.priority',
                'dropped' => ['updated_at' => 'reference row'],
            ],
            [
                'table' => 'retention_policies', 'group' => 'platform', 'key' => ['data_type'], 'source' => 'retention_policies', 'mode' => 'reference',
                'update' => [], 'compare' => ['retain_months', 'enforced'],
                'sql' => 'SELECT r.data_type, r.retain_months, r.enforced FROM public.retention_policies r', 'order' => 'r.data_type',
                'dropped' => ['label' => 'the target seeds its own', 'note' => 'the target seeds its own', 'updated_at' => 'reference row'],
            ],
            self::plain('support_access_sessions', 'platform', 's', 'id, org_id, admin_user_id, reason, case_ref, scope, {ts:granted_at}, {ts:expires_at}, {ts:revoked_at}, revoked_by, revoke_reason'),
            [
                'table' => 'support_cases', 'group' => 'platform', 'key' => ['id'], 'source' => 'support_cases',
                'sql' => "SELECT c.id::text AS id, c.reference, c.org_id::text AS org_id, c.requester_id::text AS requester_id, c.requester_name, c.requester_email,
                    c.subject, c.category, c.priority, c.status, c.assigned_to::text AS assigned_to, {ts:c.first_response_at} AS first_response_at,
                    {ts:c.resolved_at} AS resolved_at, c.csat, c.csat_comment,
                    {ts:coalesce(c.first_response_due_at, c.created_at + make_interval(mins => (SELECT t.first_response_minutes FROM public.support_sla_targets t WHERE t.priority = c.priority)))} AS first_response_due_at,
                    {ts:coalesce(c.resolution_due_at, c.created_at + make_interval(mins => (SELECT t.resolution_minutes FROM public.support_sla_targets t WHERE t.priority = c.priority)))} AS resolution_due_at,
                    {ts:c.created_at} AS created_at, {ts:c.updated_at} AS updated_at, (c.first_response_due_at IS NULL OR c.resolution_due_at IS NULL) AS _due_filled
                  FROM public.support_cases c WHERE c.org_id IS NULL OR {org:c.org_id}",
                'order' => 'c.id', 'dropped' => [], 'transform' => 'supportCases',
            ],
            [
                'table' => 'support_case_messages', 'group' => 'platform', 'key' => ['id'], 'source' => 'support_case_messages',
                'sql' => "SELECT m.id::text AS id, m.case_id::text AS case_id, m.author_id::text AS author_id, m.author_name, m.author_side, m.body, m.is_internal,
                    {ts:m.created_at} AS created_at FROM public.support_case_messages m JOIN public.support_cases c ON c.id = m.case_id
                  WHERE c.org_id IS NULL OR {org:c.org_id}",
                'order' => 'm.id', 'dropped' => [],
            ],
            self::plain('incidents', 'platform', 'i', 'id, reference, title, impact, severity, status, service, {ts:started_at}, {ts:detected_at}, {ts:resolved_at}, owner_id, resolution, {ts:created_at}, {ts:updated_at}', ['is_public' => 'LOSSY: the target has no public status page'], false),
            self::plain('incident_updates', 'platform', 'u', 'id, incident_id, author_id, status, body, {ts:created_at}', [], false),
            [
                'table' => 'enquiries', 'group' => 'platform', 'key' => ['id'], 'source' => 'enquiries',
                'sql' => "SELECT e.id::text AS id, e.name, e.work_email, e.organisation, e.team_size, e.sector, e.message, e.wants_demo, e.marketing_consent,
                    e.status, e.ip_hash, e.user_agent, {ts:e.created_at} AS notified_at, {ts:e.created_at} AS created_at, {ts:e.updated_at} AS updated_at
                  FROM public.enquiries e",
                'order' => 'e.id', 'dropped' => [],
            ],
            [
                'table' => 'platform_announcements', 'group' => 'platform', 'key' => ['id'], 'source' => 'platform_announcements',
                'sql' => "SELECT a.id::text AS id, a.title, a.body, a.kind, a.audience, to_json(a.audience_plans)::text AS audience_plans, a.status,
                    {ts:a.scheduled_for} AS scheduled_for, {ts:a.sent_at} AS sent_at, a.created_by::text AS created_by, {ts:a.created_at} AS created_at,
                    {ts:a.updated_at} AS updated_at, a.channel AS _channel FROM public.platform_announcements a",
                'order' => 'a.id', 'dropped' => ['channel' => 'LOSSY: the target delivers in-app through the outbox; email/both is not kept (counted)'], 'transform' => 'platformAnnouncements',
            ],
            [
                'table' => 'platform_announcement_deliveries', 'group' => 'platform', 'key' => ['id'], 'source' => 'platform_announcement_deliveries',
                'sql' => "SELECT d.id::text AS id, d.announcement_id::text AS announcement_id, d.org_id::text AS org_id, {ts:d.sent_at} AS sent_at,
                    {ts:d.failed_at} AS failed_at, d.failure_reason, {ts:d.read_at} AS read_at, d.read_by::text AS read_by, {ts:d.created_at} AS created_at
                  FROM public.platform_announcement_deliveries d WHERE {org:d.org_id}",
                'order' => 'd.id', 'dropped' => ['outbox_id' => 'the old outbox is not moved'],
            ],
            [
                'table' => 'platform_announcement_optouts', 'group' => 'platform', 'key' => ['org_id'], 'source' => 'platform_announcement_optouts',
                'sql' => "SELECT o.org_id::text AS org_id, o.opted_out_by::text AS opted_out_by, {ts:o.created_at} AS created_at
                  FROM public.platform_announcement_optouts o WHERE {org:o.org_id}",
                'order' => 'o.org_id', 'dropped' => [],
            ],
            // ---- data protection ----
            [
                'table' => 'gdpr_requests', 'group' => 'gdpr', 'key' => ['id'], 'source' => 'gdpr_requests',
                'sql' => "SELECT g.id::text AS id, g.org_id::text AS org_id, g.subject_email, g.subject_name, g.kind, g.status, g.received_on::text AS received_on,
                    g.due_on::text AS due_on, g.extended_to::text AS extended_to, g.extension_reason, g.assigned_to::text AS assigned_to,
                    {ts:g.closed_at} AS closed_at, g.outcome_note, {ts:g.created_at} AS created_at, {ts:g.updated_at} AS updated_at
                  FROM public.gdpr_requests g WHERE g.org_id IS NULL OR {org:g.org_id}",
                'order' => 'g.id', 'dropped' => [],
            ],
            [
                'table' => 'account_deletions', 'group' => 'gdpr', 'key' => ['id'], 'source' => 'account_deletions', 'transform' => 'accountDeletions',
                'sql' => "SELECT a.id::text AS id, a.user_id::text AS user_id, a.gdpr_request_id::text AS gdpr_request_id, a.status, a.attempts, a.last_error,
                    {ts:a.created_at} AS created_at, {ts:a.completed_at} AS completed_at FROM public.account_deletions a",
                'order' => 'a.id', 'dropped' => ['request_id' => 'pg_net request id', 'dispatched_at' => 'pg_net dispatch time'],
            ],
            [
                'table' => 'storage_deletions', 'group' => 'gdpr', 'key' => ['id'], 'source' => 'storage_deletions', 'transform' => 'storageDeletions',
                'sql' => "SELECT s.id::text AS id, s.org_id::text AS org_id, s.bucket, s.path, s.is_folder, s.reason, s.status, s.attempts, s.last_error,
                    {ts:s.created_at} AS created_at, {ts:s.completed_at} AS completed_at FROM public.storage_deletions s",
                'order' => 's.id', 'dropped' => ['request_id' => 'pg_net request id', 'dispatched_at' => 'pg_net dispatch time'],
            ],
            // ---- audit (append-only; the target id is a new number, the source uuid is kept in metadata._moved.source_id) ----
            [
                'table' => 'audit_logs', 'group' => 'audit', 'key' => ['_source_id'], 'source' => 'audit_logs', 'mode' => 'audit', 'transform' => 'audit',
                'sql' => "SELECT a.id::text AS _source_id, a.org_id::text AS org_id, a.org_name, a.actor_user_id::text AS actor_user_id, a.action,
                    coalesce(nullif(a.entity_type, ''), 'unknown') AS entity_type, a.entity_id::text AS entity_id,
                    jsonb_set(CASE WHEN jsonb_typeof(a.metadata) = 'object' THEN a.metadata ELSE jsonb_build_object('value', a.metadata) END, '{_moved}',
                      jsonb_strip_nulls(jsonb_build_object('source_id', a.id, 'scope', a.scope, 'actor_email', a.actor_email, 'actor_name', a.actor_name,
                        'user_agent', a.user_agent, 'before', a.before_value, 'after', a.after_value,
                        'severity', CASE WHEN a.severity = 'notice' THEN 'notice' END, 'visibility', CASE WHEN a.visibility = 'both' THEN 'both' END)))::text AS metadata,
                    CASE a.severity WHEN 'notice' THEN 'info' ELSE a.severity END AS severity,
                    CASE a.visibility WHEN 'both' THEN 'org' ELSE a.visibility END AS visibility,
                    host(a.ip_address) AS ip_address, {ts:a.created_at} AS created_at
                  FROM public.audit_logs a WHERE {org:a.org_id}",
                'order' => 'a.created_at, a.id', 'dropped' => [],
            ],
        ];
    }

    /**
     * A table whose columns carry over one for one. $cols lists target = source names; "{ts:x}" marks a timestamptz.
     * uuid columns are cast to text; arrays and jsonb are not used by plain tables.
     * @param array<string,string> $dropped
     * @return array<string,mixed>
     */
    private static function plain(string $table, string $group, string $alias, string $cols, array $dropped = [], bool $orgScoped = true): array
    {
        $out = [];
        foreach (array_map('trim', explode(',', $cols)) as $c) {
            if (preg_match('/^\{ts:(\w+)\}$/', $c, $m) === 1) {
                $out[] = "{ts:$alias.{$m[1]}} AS {$m[1]}";
            } else {
                $out[] = "$alias.$c" . (str_ends_with($c, '_id') || $c === 'id' || in_array($c, ['requested_by', 'reviewed_by', 'approved_by', 'created_by', 'revoked_by'], true)
                    ? "::text AS $c" : (in_array($c, ['hours', 'date', 'start_date', 'end_date', 'period_start', 'period_end', 'issued_on', 'due_on', 'default_start', 'default_end', 'start_time', 'end_time', 'before_value', 'after_value'], true) ? "::text AS $c" : ''));
            }
        }
        $where = $orgScoped ? " WHERE {org:$alias.org_id}" : '';
        return ['table' => $table, 'group' => $group, 'key' => ['id'], 'source' => $table,
            'sql' => 'SELECT ' . implode(', ', $out) . " FROM public.$table $alias$where", 'order' => "$alias.id", 'dropped' => $dropped];
    }
}
