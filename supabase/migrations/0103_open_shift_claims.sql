-- =====================================================================
-- 0103_open_shift_claims.sql — an open shift somebody can actually
-- take (docs/SAAS.md CAP-010)
--
-- `shifts.status` has accepted `'open'` since `0002`, the rota builder
-- creates open shifts, and no staff-facing screen has ever shown one.
-- So the state means "a manager knows this is uncovered" and nothing
-- more: the person who could cover it never learns it exists, and the
-- manager rings round instead. That is the gap this closes, and it is
-- the cheapest cover the product can offer — the shift is already
-- published, the person is already rostered elsewhere that week.
--
-- ## Claiming has to be a function, not a client write
--
-- `shifts_write` is `owner`/`manager` only, correctly: a staff member
-- who could UPDATE a shift could assign themselves anything, or unassign
-- a colleague. So the claim happens in one SECURITY DEFINER function
-- that decides everything and writes exactly one row.
--
-- ## The conditional update is the concurrency control
--
-- Two people on the same ward will tap the same shift within a second of
-- each other. The UPDATE carries `and status = 'open' and
-- staff_profile_id is null` in its WHERE, so the second one changes zero
-- rows and is told so. Checking first and updating second would let both
-- pass the check.
--
-- ## What it refuses, and what it only warns about
--
-- Refused: an unpublished rota (a draft is a manager's working copy),
-- a shift in the past, a cancelled one, one already taken, and one that
-- OVERLAPS a shift the claimer already has. That last is the hard
-- invariant — a person cannot be in two places, and no policy setting
-- makes that acceptable.
--
-- Not refused: minimum rest, consecutive days, weekly hours. Those are
-- organisation policies with legitimate exceptions, and a rota where
-- somebody covers a short-rest shift knowingly is better than one where
-- nobody covers it at all. The screen shows the warning; the person
-- decides. Refusing them here would make the board useless on exactly
-- the days it matters.
-- =====================================================================

-- ── what is claimable ─────────────────────────────────────────────────
--
-- A view function rather than a client query, so "open" means one thing in
-- one place. The client could express most of this — `shifts_select` lets a
-- member read every shift in their organisation — but not the "does not clash
-- with mine" part without pulling their own roster down and comparing in the
-- browser, which is the sort of thing that is right in the demo and wrong on
-- a Sunday night.
create or replace function public.open_shifts(p_org uuid)
returns table (
  shift_id       uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  break_minutes  integer,
  notes          text,
  shift_type     text,
  location_name  text,
  clashes_with_mine boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.my_staff_profile_id(p_org) as staff_id)
  select s.id,
         s.starts_at,
         s.ends_at,
         coalesce(s.break_minutes, 0),
         s.notes,
         st.name,
         l.name,
         exists (
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
     and (select staff_id from me) is not null
     and s.status = 'open'
     and s.staff_profile_id is null
     and r.status = 'published'
     and s.starts_at > timezone('utc', now())
   order by s.starts_at;
$$;

comment on function public.open_shifts(uuid) is
  'Published, unclaimed, future shifts in an organisation, flagged with whether each clashes with the caller''s own roster (CAP-010).';

revoke all on function public.open_shifts(uuid) from public, anon;
grant execute on function public.open_shifts(uuid) to authenticated;

-- ── taking one ────────────────────────────────────────────────────────
create or replace function public.claim_open_shift(p_shift uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift  public.shifts%rowtype;
  v_staff  uuid;
  v_rota   text;
  v_taken  integer;
begin
  select * into v_shift from public.shifts where id = p_shift;
  if not found then
    raise exception 'That shift no longer exists' using errcode = 'P0002';
  end if;

  -- Membership first, so somebody probing shift ids in another organisation
  -- gets the same answer whatever the shift's state is.
  if not public.is_org_member(v_shift.org_id) then
    raise exception 'That shift no longer exists' using errcode = 'P0002';
  end if;

  v_staff := public.my_staff_profile_id(v_shift.org_id);
  if v_staff is null then
    raise exception 'You do not have a staff record in this organisation'
      using errcode = '42501';
  end if;

  select r.status into v_rota from public.rotas r where r.id = v_shift.rota_id;
  if v_rota is distinct from 'published' then
    raise exception 'That shift is on a rota that has not been published'
      using errcode = '42501';
  end if;

  if v_shift.starts_at <= timezone('utc', now()) then
    raise exception 'That shift has already started' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.shifts mine
     where mine.staff_profile_id = v_staff
       and mine.status <> 'cancelled'
       and mine.starts_at < v_shift.ends_at
       and mine.ends_at   > v_shift.starts_at
  ) then
    raise exception 'You are already working at that time' using errcode = '42501';
  end if;

  -- `0061`'s `shifts_guard_immutable_rota` refuses any edit to a shift on a
  -- published rota, and every claimable shift is on one. The exemption exists
  -- for exactly this shape and `0061` says so: a SECURITY DEFINER function
  -- that has already checked who is asking and what they are changing, where
  -- forcing it through an amendment would be wrong rather than safer. Swap
  -- approval is the other user of it. Nobody's existing shift changes here —
  -- an unassigned slot gets a name.
  --
  -- Set true, so it is transaction-local, and cleared straight after: an
  -- exemption left standing would apply to whatever else the transaction
  -- touched.
  perform set_config('rotaflow.shift_transition', 'on', true);

  -- The concurrency control. The WHERE repeats the conditions rather than
  -- trusting the read above: between that SELECT and this UPDATE somebody
  -- else on the same ward may have taken it.
  update public.shifts
     set staff_profile_id = v_staff,
         status           = 'assigned',
         updated_at       = timezone('utc', now())
   where id = p_shift
     and status = 'open'
     and staff_profile_id is null;

  get diagnostics v_taken = row_count;

  perform set_config('rotaflow.shift_transition', '', true);

  if v_taken = 0 then
    raise exception 'Somebody else has just taken that shift' using errcode = '40001';
  end if;

  perform public.audit_write(
    v_shift.org_id,
    'shift.claimed',
    'shifts',
    p_shift,
    jsonb_build_object(
      'staff_profile_id', v_staff,
      'starts_at', v_shift.starts_at,
      'ends_at', v_shift.ends_at),
    'info');

  return p_shift;
end;
$$;

comment on function public.claim_open_shift(uuid) is
  'Takes an open shift for the caller. The UPDATE re-checks "still open" in its WHERE, so two people tapping at once cannot both succeed (CAP-010).';

revoke all on function public.claim_open_shift(uuid) from public, anon;
grant execute on function public.claim_open_shift(uuid) to authenticated;
