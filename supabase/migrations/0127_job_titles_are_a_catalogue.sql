-- =====================================================================
-- 0127 · A job title is an organisation's catalogue entry, not free text
--
-- `staff_profiles.job_title` is a nullable `text` column typed by hand on
-- the staff form. "Senior Carer", "senior carer", "Senior  Carer" and
-- "Snr Carer" are four occupations as far as every screen is concerned:
-- the team directory groups by none of them, a filter on one misses the
-- other three, and no rota chip can be coloured by occupation at all
-- because there is nothing stable to colour by. Renaming a title means
-- editing every staff record that carries it, and nothing stops two
-- tenants' spellings from diverging inside one organisation.
--
-- This makes the catalogue a table the organisation owns, with a stable
-- id, a managed colour, and an archive state so history stays readable
-- after a title stops being offered.
--
-- ## What this migration deliberately does NOT do
--
-- It does not drop `staff_profiles.job_title`. Both columns are live
-- after this: `job_title_id` is authoritative, `job_title` is kept in
-- step by the application and remains readable by any client bundle
-- still in a service-worker cache. Dropping it would break every
-- currently-installed PWA the moment this merged, and this project's
-- deployment model applies a migration to production the instant a pull
-- request lands. The retirement is a later migration, once
-- `docs/SCHEMA.md`'s stated condition is met: no read of `job_title`
-- remains in the tree and no cached bundle older than that release can
-- still be running.
--
-- ## Uniqueness, and why it is in the database
--
-- Two rules, both enforced here rather than only in the picker, because
-- two managers pressing Save at the same moment is exactly when a
-- client-side check does nothing:
--
--   * one title per organisation, compared case-insensitively and with
--     internal whitespace collapsed (`name_normalised`, a generated
--     column, so the comparison form cannot drift from the display name);
--   * one colour per ACTIVE title per organisation. Archived titles
--     release their colour back to the palette.
--
-- Both are scoped to `org_id`, so "Nurse" in indigo may exist
-- independently in every tenant.
--
-- ## Colour is a category, never a permission
--
-- `colour` holds a palette id from `src/lib/jobTitlePalette.ts` and is
-- CHECK-constrained to that list. It carries no authority: a title called
-- "Owner" is a description of work, and `memberships.role` remains the
-- only thing that decides what anybody may do.
--
-- ## Who may edit the catalogue
--
-- Owners always. Managers only where the organisation has said so, via
-- `organisations.settings ->> 'job_titles_managed_by' = 'managers'`,
-- which defaults to owner-only when absent. `can_manage_job_titles` is
-- the single predicate; the UI asks it the same question the policy does.
--
-- SAFETY(create_policy): the new policies are membership-scoped in the
-- same shape as every other tenant table (0002) — `is_org_member` reads,
-- an explicit predicate writes. Nothing is granted to `anon` or PUBLIC,
-- and the new function's EXECUTE is revoked from both per 0112.
-- SAFETY(update): the backfill writes `staff_profiles.job_title_id` only
-- where it is currently null, and only to a catalogue row created by this
-- same migration from that organisation's own existing text. No existing
-- value is overwritten, no row is deleted, and `job_title` is untouched.
-- =====================================================================

-- ── the catalogue ────────────────────────────────────────────────────
create table if not exists public.job_titles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations(id) on delete cascade,

  name       text not null check (length(btrim(name)) between 1 and 80),

  -- The comparison form. Generated, so it can never disagree with `name`
  -- the way a trigger-maintained or application-maintained copy would.
  name_normalised text generated always as (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  ) stored,

  -- A palette id from src/lib/jobTitlePalette.ts. Null is legitimate and
  -- means "no colour": the badge falls back to a neutral, labelled style
  -- rather than borrowing another title's swatch. The backfill leaves it
  -- null past the twelfth title in an organisation for that reason.
  colour     text check (colour in (
    'indigo','sky','teal','moss','olive','amber',
    'clay','rose','magenta','violet','slate','cocoa'
  )),

  -- Archive rather than delete. A shift worked two years ago by a Senior
  -- Carer must still say "Senior Carer" on the timesheet that paid it.
  active     boolean not null default true,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.job_titles is
  'An organisation''s catalogue of occupations. Colour is a category label from the fixed palette in src/lib/jobTitlePalette.ts and confers no authority — memberships.role is the only thing that does. Archived titles keep their history readable and release their colour.';
comment on column public.job_titles.name_normalised is
  'Generated: lower-cased, whitespace-collapsed name. The uniqueness key, so a case or spacing variant cannot become a second occupation.';
comment on column public.job_titles.colour is
  'Palette id, unique among ACTIVE titles in the organisation. Null means no colour and renders as a neutral labelled badge; it never means "pick one".';

create unique index if not exists job_titles_org_name_key
  on public.job_titles (org_id, name_normalised);

-- Active titles only. Archiving a title hands its colour back.
create unique index if not exists job_titles_org_active_colour_key
  on public.job_titles (org_id, colour)
  where active and colour is not null;

create index if not exists job_titles_org_idx on public.job_titles (org_id);

drop trigger if exists job_titles_set_updated_at on public.job_titles;
create trigger job_titles_set_updated_at
  before update on public.job_titles
  for each row execute function public.set_updated_at();

-- ── who may edit it ──────────────────────────────────────────────────
create or replace function public.can_manage_job_titles(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.has_org_role(p_org, array['owner'])
    or (
      public.has_org_role(p_org, array['manager'])
      and coalesce(
        (select o.settings ->> 'job_titles_managed_by'
           from public.organisations o
          where o.id = p_org),
        'owner'
      ) = 'managers'
    );
$$;

comment on function public.can_manage_job_titles(uuid) is
  'Owner always; manager only where organisations.settings.job_titles_managed_by = ''managers''. Absent setting means owner-only, so the permissive case has to be chosen deliberately.';

-- 0112: a new function is EXECUTE-able by PUBLIC (and therefore anon)
-- unless its own migration says otherwise.
revoke all on function public.can_manage_job_titles(uuid) from public, anon;
grant execute on function public.can_manage_job_titles(uuid) to authenticated;

-- ── row level security ───────────────────────────────────────────────
alter table public.job_titles enable row level security;

drop policy if exists job_titles_select on public.job_titles;
create policy job_titles_select
  on public.job_titles for select
  using (public.is_org_member(org_id));

drop policy if exists job_titles_write on public.job_titles;
create policy job_titles_write
  on public.job_titles for all
  using (public.can_manage_job_titles(org_id))
  with check (public.can_manage_job_titles(org_id));

-- Revoke first, then grant exactly what is needed.
--
-- The Supabase image's default ACL hands `authenticated` every privilege on a
-- new `public` table, TRUNCATE included. TRUNCATE is not subject to RLS, so
-- without this a member of any organisation could empty every tenant's
-- catalogue in one statement. `0075` took it away from the tables that
-- existed then and could not take it away from tables that did not.
revoke all on public.job_titles from authenticated;
grant select, insert, update, delete on public.job_titles to authenticated;

-- ── the reference on a staff record ──────────────────────────────────
alter table public.staff_profiles
  add column if not exists job_title_id uuid
    references public.job_titles(id) on delete set null;

comment on column public.staff_profiles.job_title_id is
  'The catalogue entry. Authoritative. `job_title` is the legacy free-text column, kept in step by the application until a later migration retires it — see 0127''s header for the condition.';

create index if not exists staff_profiles_job_title_idx
  on public.staff_profiles (job_title_id);

-- The FK alone would accept another tenant's title, which would put a
-- foreign organisation's occupation on a staff record. Constrained here
-- rather than trusted from the client.
create or replace function public.staff_profile_job_title_same_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_title_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.job_titles jt
     where jt.id = new.job_title_id
       and jt.org_id = new.org_id
  ) then
    raise exception 'Job title % does not belong to this organisation', new.job_title_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.staff_profile_job_title_same_org() from public, anon;

drop trigger if exists staff_profiles_job_title_same_org on public.staff_profiles;
create trigger staff_profiles_job_title_same_org
  before insert or update of job_title_id, org_id on public.staff_profiles
  for each row execute function public.staff_profile_job_title_same_org();

-- ── backfill ─────────────────────────────────────────────────────────
-- One catalogue row per distinct normalised title per organisation. The
-- display name kept is the one used by the most staff, ties broken
-- alphabetically, so a majority spelling wins rather than whichever row
-- the planner happened to read first.
--
-- Case and whitespace variants of the same string merge, because they
-- are the same string. Nothing else does: "Snr Carer" and "Senior Carer"
-- stay two titles, and reconciling them is a decision for the
-- organisation, not for a migration. `scripts/job-title-dry-run.mjs`
-- reports those near-duplicates so they can be looked at first.
with candidates as (
  select
    sp.org_id,
    lower(regexp_replace(btrim(sp.job_title), '\s+', ' ', 'g')) as normalised,
    btrim(sp.job_title)                                          as display,
    count(*)                                                     as uses
  from public.staff_profiles sp
  where sp.job_title is not null
    and btrim(sp.job_title) <> ''
  group by 1, 2, 3
),
chosen as (
  select distinct on (org_id, normalised)
    org_id, normalised, display
  from candidates
  order by org_id, normalised, uses desc, display asc
),
ranked as (
  select
    org_id,
    normalised,
    display,
    row_number() over (partition by org_id order by normalised) as position
  from chosen
),
palette as (
  select id, ordinality as position
  from unnest(array[
    'indigo','sky','teal','moss','olive','amber',
    'clay','rose','magenta','violet','slate','cocoa'
  ]) with ordinality as t(id, ordinality)
)
insert into public.job_titles (org_id, name, colour)
select r.org_id, r.display, p.id
  from ranked r
  -- LEFT JOIN, not INNER: past the twelfth title the colour is null and
  -- the badge is neutral. Reusing a swatch would make two occupations
  -- look like one, which is the failure the palette exists to prevent.
  left join palette p on p.position = r.position
on conflict (org_id, name_normalised) do nothing;

update public.staff_profiles sp
   set job_title_id = jt.id
  from public.job_titles jt
 where sp.job_title_id is null
   and sp.job_title is not null
   and jt.org_id = sp.org_id
   and jt.name_normalised =
       lower(regexp_replace(btrim(sp.job_title), '\s+', ' ', 'g'));

-- ── erasure coverage ─────────────────────────────────────────────────
-- `erasure_coverage.test.sql` fails the build on any column of
-- `staff_profiles` that anonymisation neither clears nor declares. That
-- gate exists because `email` survived an erasure for two months, and it
-- has just caught this column, which is exactly what it is for.
--
-- `job_title_id` is kept, for the same reason `job_title` already is: it
-- says what the work was, not who did it, and a historical rota that
-- cannot say a shift was covered by a Senior Carer is less useful and no
-- more private. The two must be declared together or they would disagree
-- about the same fact.
create or replace function public.erasure_retained_columns()
returns table (column_name text, reason text)
language sql
immutable
as $$
  select * from (values
    ('id',                'The row''s own key. Meaningless without the fields around it.'),
    ('org_id',            'Which organisation the anonymous record belongs to.'),
    ('department_id',     'Where the work happened, not who did it.'),
    ('job_title',         'What the role was. Identifying only in an organisation small enough that removing it would not help either.'),
    ('job_title_id',      'The catalogue entry behind job_title (0127). Same fact, same reason — dropping one and keeping the other would leave the record contradicting itself.'),
    ('contract_type',     'Employment shape, kept for what the rota and timesheets mean.'),
    ('weekly_hours',      'Same.'),
    ('holiday_allowance', 'Same — a leave balance that cannot be explained is worse than one attached to nobody.'),
    ('skills',            'What the shifts required. Attached to nobody once the identity is gone.'),
    ('start_date',        'When the employment began. Needed to make historical rotas make sense.'),
    ('active',            'Set false BY the erasure.'),
    ('created_at',        'When the record was made.'),
    ('updated_at',        'When it last changed.')
  ) as t(column_name, reason);
$$;

revoke all on function public.erasure_retained_columns() from public, anon;
grant execute on function public.erasure_retained_columns() to authenticated;
