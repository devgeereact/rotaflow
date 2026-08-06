-- =====================================================================
-- platform_teardown.sql. Remove everything platform_seed.sql created
--
-- The seed attached invoices, support cases, incidents, announcements,
-- integrations, health samples and background jobs to whatever organisations
-- existed when it ran. On a demo environment that is useful. On the day a real
-- customer is onboarded it is fiction printed against their name, so this
-- takes it back out.
--
-- RUN IT:  paste into the Supabase SQL editor, POST to
--          /v1/projects/<ref>/database/query, or `supabase db push
--          --include-seed` with sql_paths pointed here.
--
-- SAFE: every id the seed wrote is derived from a key, so this deletes by the
-- same derivation and touches nothing else. Rows a human created through the
-- console survive, including incidents you declared and cases you answered.
-- Health samples are matched on `source = 'manual'`, which only the seed sets.
--
-- Deliberately NOT undone:
--   organisations.industry / country / timezone / contact_email
--   subscriptions.started_at / trial_ends_at / canceled_at
-- Those were filled in from data the tenant already had, or from its own
-- settings blob. They are the organisation's own details rather than invented
-- ones, and deleting them would lose real information.
-- =====================================================================

-- Deleting a parent cascades to its children: incident updates, case messages
-- and announcement deliveries all carry `on delete cascade`.
delete from public.incidents
 where id in (select md5('rotaflow-platform-seed-v1:' || 'incident:' || i)::uuid
                from generate_series(1, 12) i);

delete from public.support_cases
 where id in (select md5('rotaflow-platform-seed-v1:' || 'case:' || i)::uuid
                from generate_series(1, 20) i);

delete from public.platform_announcements
 where id in (select md5('rotaflow-platform-seed-v1:' || 'announcement:' || i)::uuid
                from generate_series(1, 8) i);

-- Invoice and integration ids are derived from a pair of keys, so the teardown
-- walks the same pairs the seed did.
delete from public.invoices
 where id in (select md5('rotaflow-platform-seed-v1:' || format('invoice:%s:%s', n, m))::uuid
                from generate_series(1, 50) n, generate_series(1, 12) m);

delete from public.org_integrations
 where id in (select md5('rotaflow-platform-seed-v1:' || format('orgint:%s:%s', n, k))::uuid
                from generate_series(1, 50) n,
                     (values ('sage_payroll'), ('xero'), ('google_calendar'),
                             ('brighthr'), ('slack')) as c(k));

delete from public.background_jobs
 where id in (select md5('rotaflow-platform-seed-v1:' || 'job:' || i)::uuid
                from generate_series(1, 60) i);

-- Only the seed writes 'manual'. A console probe writes 'console' and a
-- scheduled one writes 'scheduled', and both are real measurements.
delete from public.platform_health_samples where source = 'manual';

-- The placeholder allowlist entry, which permitted everything and therefore
-- restricted nothing.
delete from public.platform_ip_allowlist where cidr = '0.0.0.0/0'::cidr;

-- =====================================================================
-- What is left
-- =====================================================================
select 'incidents'      as table_name, count(*) from public.incidents
union all select 'support_cases',      count(*) from public.support_cases
union all select 'announcements',      count(*) from public.platform_announcements
union all select 'invoices',           count(*) from public.invoices
union all select 'org_integrations',   count(*) from public.org_integrations
union all select 'sync_runs',          count(*) from public.integration_sync_runs
union all select 'health_samples',     count(*) from public.platform_health_samples
union all select 'background_jobs',    count(*) from public.background_jobs;
