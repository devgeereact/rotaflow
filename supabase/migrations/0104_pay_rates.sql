-- =====================================================================
-- 0104_pay_rates.sql — what a rostered week costs (docs/SAAS.md CAP-086)
--
-- There is no rate column anywhere in this schema, so every number the
-- product reports about a rota is a number of hours. Hours are what a
-- manager schedules; money is what they are held to. "Is this week
-- within budget" is the question a rota is actually approved against,
-- and the product could not answer it at all.
--
-- ## Why this is NOT a column on staff_profiles
--
-- `staff_profiles_select` is `is_org_member(org_id)` — every colleague
-- can read every row. A rate column there would publish everybody's pay
-- to everybody in the organisation, which is a data breach delivered by
-- a schema decision rather than a bug. It goes in its own table with its
-- own policies: managers and owners see the organisation's rates, and a
-- person sees their own and nobody else's.
--
-- ## Why it is a history rather than a value
--
-- A rate that is overwritten rewrites the past: raise somebody in April
-- and every week they worked in March silently costs more, so last
-- quarter's figure changes after it was reported. Each row carries the
-- date it takes effect, and a cost is computed against the rate that was
-- in force on the day of the shift.
--
-- ## Integer pence
--
-- The rest of this schema prices in pence (`plans.monthly_price_pence`,
-- `subscriptions.price_pence`) and so does this. £12.34 stored as a
-- float is 12.339999999999999, and a labour cost is a sum of thousands
-- of them.
-- =====================================================================

create table if not exists public.staff_pay_rates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  hourly_rate_pence integer not null check (hourly_rate_pence >= 0),
  effective_from   date not null,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default timezone('utc', now())
);

comment on table public.staff_pay_rates is
  'Hourly rates, as a history rather than a value: a rate that is overwritten rewrites the cost of every week already worked (CAP-086).';

-- One rate per person per start date. A correction replaces the row for that
-- date rather than adding a second one nothing can choose between.
create unique index if not exists staff_pay_rates_one_per_date_idx
  on public.staff_pay_rates (staff_profile_id, effective_from);

create index if not exists staff_pay_rates_org_idx
  on public.staff_pay_rates (org_id, effective_from desc);

alter table public.staff_pay_rates enable row level security;

-- A manager or owner sees the organisation's rates; anybody else sees their
-- own row and nothing else. `my_staff_profile_id` is the same predicate the
-- rest of the schema uses for "this is mine".
drop policy if exists staff_pay_rates_select on public.staff_pay_rates;
create policy staff_pay_rates_select
  on public.staff_pay_rates for select
  using (
    public.has_org_role(org_id, array['owner', 'manager'])
    or staff_profile_id = public.my_staff_profile_id(org_id)
  );

-- Writing is managerial. Deliberately no self-service: a person setting their
-- own pay rate is not a feature.
drop policy if exists staff_pay_rates_write on public.staff_pay_rates;
create policy staff_pay_rates_write
  on public.staff_pay_rates for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.staff_pay_rates from anon, authenticated;
grant select, insert, update, delete on public.staff_pay_rates to authenticated;

-- ── what a period costs ───────────────────────────────────────────────
--
-- SECURITY DEFINER and role-gated inside, rather than a client-side join.
-- Two reasons, and the second is the important one:
--
--   1. the rate in force on the day of a shift is a lateral lookup per row,
--      which is one query here and N+1 in a browser;
--   2. a client computing this would have to READ every rate to multiply by
--      it, and the whole point of the policy above is that most people
--      cannot. The function returns money without ever handing out the rates
--      it used.
--
-- Hours are taken from the roster, not the clock. A cost forecast is about
-- what has been committed to, and a manager approving next week's rota has no
-- clock events to work from. `break_minutes` comes out, because a break is
-- unpaid unless the organisation says otherwise — and where it says otherwise
-- (`breaks_are_paid`) the caller passes `p_paid_breaks`.
create or replace function public.labour_cost(
  p_org         uuid,
  p_from        date,
  p_to          date,
  p_paid_breaks boolean default false
)
returns table (
  location_id   uuid,
  location_name text,
  scheduled_minutes bigint,
  cost_pence    bigint,
  unrated_staff integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_org_role(p_org, array['owner', 'manager']) then
    raise exception 'Only an owner or manager may see labour cost'
      using errcode = '42501';
  end if;

  return query
  with paid as (
    select s.location_id,
           s.staff_profile_id,
           greatest(
             0,
             (extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer
               - case when p_paid_breaks then 0 else coalesce(s.break_minutes, 0) end
           ) as minutes,
           (s.starts_at at time zone 'UTC')::date as worked_on
      from public.shifts s
      join public.rotas r on r.id = s.rota_id
     where s.org_id = p_org
       and s.status <> 'cancelled'
       and r.status in ('published', 'archived')
       and (s.starts_at at time zone 'UTC')::date between p_from and p_to
  ),
  costed as (
    select p.location_id,
           p.minutes,
           -- The rate in force on the DAY OF THE SHIFT, not today's. This is
           -- the whole reason the table is a history.
           (select pr.hourly_rate_pence
              from public.staff_pay_rates pr
             where pr.staff_profile_id = p.staff_profile_id
               and pr.effective_from <= p.worked_on
             order by pr.effective_from desc
             limit 1) as rate,
           p.staff_profile_id
      from paid p
  )
  select c.location_id,
         l.name,
         sum(c.minutes)::bigint,
         -- Rounded per shift rather than at the end: a half-penny left on
         -- every one of a thousand shifts is £5 of invented money.
         coalesce(sum(round(c.minutes * c.rate / 60.0))::bigint, 0),
         -- Named, because a total that quietly treats an unrated person as
         -- free is worse than no total. The screen says how many are missing.
         count(distinct c.staff_profile_id) filter (where c.rate is null)::integer
    from costed c
    left join public.locations l on l.id = c.location_id
   group by c.location_id, l.name
   order by l.name nulls last;
end;
$$;

comment on function public.labour_cost(uuid, date, date, boolean) is
  'Rostered cost per location for a period, using the rate in force on the day of each shift. Returns money without handing out the rates it used, and counts the people it could not price (CAP-086).';

revoke all on function public.labour_cost(uuid, date, date, boolean) from public, anon;
grant execute on function public.labour_cost(uuid, date, date, boolean) to authenticated;

-- ── the current rate, for the staff screen ────────────────────────────
create or replace function public.current_pay_rates(p_org uuid)
returns table (
  staff_profile_id  uuid,
  hourly_rate_pence integer,
  effective_from    date
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (pr.staff_profile_id)
         pr.staff_profile_id, pr.hourly_rate_pence, pr.effective_from
    from public.staff_pay_rates pr
   where pr.org_id = p_org
     and pr.effective_from <= current_date
     -- The same rule as the policy above, restated here because a definer
     -- function does not get RLS for free: managers see everybody, everybody
     -- else sees themselves.
     and (
       public.has_org_role(p_org, array['owner', 'manager'])
       or pr.staff_profile_id = public.my_staff_profile_id(p_org)
     )
   order by pr.staff_profile_id, pr.effective_from desc;
$$;

comment on function public.current_pay_rates(uuid) is
  'Today''s rate per person. Managers see everyone; anybody else sees only their own (CAP-086).';

revoke all on function public.current_pay_rates(uuid) from public, anon;
grant execute on function public.current_pay_rates(uuid) to authenticated;
