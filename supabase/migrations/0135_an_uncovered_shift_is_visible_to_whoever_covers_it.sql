-- =====================================================================
-- 0135_an_uncovered_shift_is_visible_to_whoever_covers_it.sql —
-- `open_shifts` returned nothing to a reader with no staff record
-- (docs/SAAS.md BUG-086, CAP-010)
--
-- ## What was wrong
--
-- `0103` gated the whole result on the caller having a staff profile:
--
--     and (select staff_id from me) is not null
--
-- That is right for the question the function was written to answer —
-- "which uncovered shifts could I take" — and wrong for the screen it
-- feeds. `/app/open-shifts` is in an owner's and a manager's rail because
-- an uncovered shift is a coverage problem before it is an opportunity,
-- and `0121` only gives a staff record to whoever FOUNDS an organisation.
-- An owner invited into an existing organisation, an owner whose staff
-- record was archived, and a manager who does not work shifts all had the
-- board answer "Nothing needs covering. Every published shift has
-- somebody on it" while a night shift sat open in front of them.
--
-- A false negative on a coverage screen is the worst shape this defect
-- could take. An empty state is not read as a failure; it is read as good
-- news, so nobody investigates.
--
-- Found by opening the screen (7 September 2026), not by reading it. The
-- browser said "Nothing needs covering" with an open 22:00-06:00 shift in
-- the database, which is a thing no test in this repository was asking.
--
-- ## The rule now
--
-- A member of the organisation sees every uncovered shift. Whether they
-- could take one is a separate question, answered separately:
--
--   * `clashes_with_mine` is FALSE when the caller has no staff record.
--     It means "this overlaps something I already work", and somebody who
--     works nothing overlaps nothing. It does not mean "you may claim
--     this" and never did.
--   * Claiming is still `claim_open_shift`, which writes a
--     `staff_profile_id` and therefore still refuses a caller who has
--     none. Nothing about who may CLAIM changes here.
--
-- `is_org_member(p_org)` is unchanged and is what keeps this tenant-safe:
-- the function is SECURITY DEFINER, so that check is the boundary, not
-- the profile lookup that is being relaxed.
--
-- ## Migration risk
--
-- `create or replace` on one STABLE function. No table altered, no row
-- rewritten, no grant changed. Reversible by replaying `0103`'s body.
-- The result set only ever grows, and only for callers who already pass
-- `is_org_member`.
-- =====================================================================

create or replace function public.open_shifts(p_org uuid)
returns table (
  shift_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  break_minutes integer,
  notes text,
  shift_type text,
  location_name text,
  clashes_with_mine boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_staff_profile_id(p_org) as staff_id)
  select s.id,
         s.starts_at,
         s.ends_at,
         coalesce(s.break_minutes, 0),
         s.notes,
         st.name,
         l.name,
         -- False, not null, when the reader has no staff record: the column
         -- is a boolean the client renders as a badge, and a null would make
         -- "unknown" look like "clashes" at the first `?? true` somebody adds.
         (select staff_id from me) is not null
           and exists (
             select 1
               from public.shifts mine
              where mine.staff_profile_id = (select staff_id from me)
                and mine.status <> 'cancelled'
                -- Half-open overlap: a shift ending at 14:00 and one starting
                -- at 14:00 do not clash, which is the normal back-to-back
                -- handover this product's users work.
                and mine.starts_at < s.ends_at
                and mine.ends_at   > s.starts_at
           )
    from public.shifts s
    join public.rotas r on r.id = s.rota_id
    left join public.shift_types st on st.id = s.shift_type_id
    left join public.locations l on l.id = s.location_id
   where s.org_id = p_org
     and public.is_org_member(p_org)
     and s.status = 'open'
     and s.staff_profile_id is null
     and r.status = 'published'
     and s.starts_at > timezone('utc', now())
   order by s.starts_at;
$$;

comment on function public.open_shifts(uuid) is
  'Uncovered published shifts in the future for one organisation. Visible to '
  'every member, because an uncovered shift is a coverage problem before it is '
  'an opportunity; clashes_with_mine is false for a caller with no staff '
  'record. Claiming remains claim_open_shift, which still requires one (0135).';

revoke all on function public.open_shifts(uuid) from public, anon;
grant execute on function public.open_shifts(uuid) to authenticated;
