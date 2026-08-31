-- =====================================================================
-- 0105_staff_locations.sql — somebody who works at more than one site
-- (docs/SAAS.md CAP-089)
--
-- ## The register's diagnosis was nearly right, and the fix it implied
-- would have been wrong
--
-- The row read "`staff_profiles` has no `location_id`". True, and adding
-- one is exactly what must not happen: a single column cannot express a
-- multi-location worker at all, which is the thing being asked for.
--
-- What actually happens today is subtler. A person's site is inherited
-- from their DEPARTMENT — `teamRows.ts` looks up
-- `departments.location_id` — so a person has exactly one site, by
-- construction, and the only way to give somebody a second one is to
-- invent a second department. That is why the team filter cannot answer
-- "who can cover at Ward B tonight" for anybody whose department lives
-- at Ward A.
--
-- ## A join table, and only where it is needed
--
-- `shifts` already carries `location_id`, so a person can be ROSTERED
-- anywhere — nothing here changes that, and nothing here restricts it.
-- This records where somebody *works*, which is a different fact and is
-- used for finding cover and filtering a directory, not for refusing an
-- assignment. A manager who needs to roster somebody at a site they do
-- not normally work has a reason, and the database is not the place to
-- argue with them.
--
-- Absence means "no answer recorded", not "works nowhere". Every read
-- falls back to the department's site, so an organisation that never
-- touches this sees exactly what it saw before.
-- =====================================================================

create table if not exists public.staff_locations (
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  location_id      uuid not null references public.locations(id) on delete cascade,
  org_id           uuid not null references public.organisations(id) on delete cascade,
  created_at       timestamptz not null default timezone('utc', now()),
  primary key (staff_profile_id, location_id)
);

comment on table public.staff_locations is
  'Where a person works, as a set rather than a single inherited department site. Used to find cover and filter a directory — never to refuse an assignment (CAP-089).';

create index if not exists staff_locations_location_idx
  on public.staff_locations (location_id);

alter table public.staff_locations enable row level security;

-- Readable by the whole organisation, like `staff_profiles` itself. Which
-- sites a colleague works is roster information, not personal data in the way
-- a pay rate is — everybody can already see who is on the rota at each site.
drop policy if exists staff_locations_select on public.staff_locations;
create policy staff_locations_select
  on public.staff_locations for select
  using (public.is_org_member(org_id));

drop policy if exists staff_locations_write on public.staff_locations;
create policy staff_locations_write
  on public.staff_locations for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.staff_locations from anon, authenticated;
grant select, insert, delete on public.staff_locations to authenticated;

-- No UPDATE grant, deliberately: the table is two foreign keys and a
-- primary key over both, so there is nothing to update. Changing where
-- somebody works is adding a row or removing one, and an UPDATE would only
-- offer a way to rewrite a row into a duplicate of another.

-- ── the org_id has to agree with both parents ─────────────────────────
--
-- Belt and braces against a cross-tenant row: the policy above checks the
-- caller's role in `org_id`, but nothing stops a manager writing their OWN
-- org_id beside somebody else's staff id. This trigger is what makes that
-- impossible rather than merely unlikely.
create or replace function public.staff_locations_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.staff_profiles sp
     where sp.id = new.staff_profile_id and sp.org_id = new.org_id
  ) then
    raise exception 'That staff member is not in this organisation'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.locations l
     where l.id = new.location_id and l.org_id = new.org_id
  ) then
    raise exception 'That site is not in this organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_locations_same_org on public.staff_locations;
create trigger staff_locations_same_org
  before insert or update on public.staff_locations
  for each row execute function public.staff_locations_same_org();

-- ── who can work at a site ────────────────────────────────────────────
--
-- The question the team screen and the cover search actually ask. Includes
-- the department fallback, so a person nobody has assigned sites to still
-- appears at the site their department lives at — an organisation that never
-- opens the new control sees no change.
create or replace function public.staff_at_location(p_location uuid)
returns table (staff_profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sp.id
    from public.staff_profiles sp
    left join public.departments d on d.id = sp.department_id
   where sp.active
     and public.is_org_member(sp.org_id)
     and (
       exists (
         select 1 from public.staff_locations sl
          where sl.staff_profile_id = sp.id and sl.location_id = p_location
       )
       or (
         -- Fallback, and only when nothing has been recorded: once somebody
         -- has explicit sites, the department must not add a silent extra
         -- one they were never given.
         not exists (select 1 from public.staff_locations sl where sl.staff_profile_id = sp.id)
         and d.location_id = p_location
       )
     );
$$;

comment on function public.staff_at_location(uuid) is
  'Who works at a site: explicit assignments, or the department''s site for anybody with none recorded (CAP-089).';

revoke all on function public.staff_at_location(uuid) from public, anon;
grant execute on function public.staff_at_location(uuid) to authenticated;
