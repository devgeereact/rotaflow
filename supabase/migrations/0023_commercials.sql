-- =====================================================================
-- 0023 — Plans, prices, invoices and the tenant profile
--
-- Everything the Subscriptions, Billing and Organisation screens report —
-- MRR, ARR, collected, outstanding, refunds, ARPO — is arithmetic over a
-- price. There has never been a price anywhere in this schema, which is why
-- every one of those figures was a constant in a demo module.
--
-- ## Why a plans table rather than a price column on the subscription
--
-- A price on the subscription is a price per customer, which is how you end up
-- unable to answer "what does Business cost". A plans table is the price list;
-- `subscriptions.price_pence` overrides it only where a deal was actually
-- struck, and is null everywhere else. MRR is then the sum of
-- `coalesce(subscription.price_pence, plan.monthly_price_pence)` over active
-- subscriptions, which is a definition anyone can check.
--
-- ## Enterprise
--
-- `organisations.plan` and `subscriptions.plan` have allowed three values
-- since 0002 while the console has shown four. Widening the CHECK is the whole
-- fix — nothing else refers to the list.
-- =====================================================================

-- ---------- Enterprise is a real plan ----------------------------------
alter table public.organisations drop constraint if exists organisations_plan_check;
alter table public.organisations
  add constraint organisations_plan_check
  check (plan in ('starter','professional','business','enterprise'));

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('starter','professional','business','enterprise'));

-- ---------- The price list ----------------------------------------------
create table if not exists public.plans (
  code               text primary key
                       check (code in ('starter','professional','business','enterprise')),
  name               text not null,
  -- Pence, integer. Never a float: 0.1 + 0.2 is not 0.3, and this number ends
  -- up on an invoice.
  monthly_price_pence integer not null check (monthly_price_pence >= 0),
  currency           text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- Null means uncapped. A zero would read as "no seats allowed".
  seat_limit         integer check (seat_limit is null or seat_limit > 0),
  location_limit     integer check (location_limit is null or location_limit > 0),
  description        text not null default '',
  sort_order         integer not null default 0,
  created_at         timestamptz not null default timezone('utc', now()),
  updated_at         timestamptz not null default timezone('utc', now())
);

comment on table public.plans is
  'The published price list. A subscription may override the price; the plan is what the plan costs.';

insert into public.plans (code, name, monthly_price_pence, seat_limit, location_limit, description, sort_order)
values
  ('starter',      'Starter',       2900,   15,    1, 'One site, up to 15 staff.',              1),
  ('professional', 'Professional', 12900,   60,    5, 'Up to five sites and 60 staff.',         2),
  ('business',     'Business',     29900,  200,   20, 'Up to twenty sites and 200 staff.',      3),
  ('enterprise',   'Enterprise',   79000,  null, null, 'Unlimited sites and staff, with SSO.',  4)
on conflict (code) do nothing;

-- ---------- What a subscription is actually charged --------------------
alter table public.subscriptions
  add column if not exists price_pence   integer check (price_pence is null or price_pence >= 0),
  add column if not exists currency      text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists canceled_at   timestamptz,
  add column if not exists started_at    timestamptz not null default timezone('utc', now());

comment on column public.subscriptions.price_pence is
  'Negotiated monthly price. Null means the plan price applies — most rows.';

-- The monthly value of one subscription, in pence. One definition, used by
-- every screen that says MRR, so Subscriptions and Billing cannot disagree.
create or replace function public.subscription_mrr_pence(p_org uuid)
returns integer language sql stable set search_path = public as $$
  select case when s.status in ('active','past_due')
              then coalesce(s.price_pence, p.monthly_price_pence)
              else 0 end
    from public.subscriptions s
    join public.plans p on p.code = s.plan
   where s.org_id = p_org;
$$;

grant execute on function public.subscription_mrr_pence(uuid) to authenticated;

-- ---------- Invoices ----------------------------------------------------
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,

  -- The number a customer quotes back at you. Unique, and generated by the
  -- issue function so two invoices cannot share one.
  number         text not null unique,

  period_start   date not null,
  period_end     date not null,

  amount_pence   integer not null check (amount_pence >= 0),
  tax_pence      integer not null default 0 check (tax_pence >= 0),
  currency       text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),

  status         text not null default 'open'
                   check (status in ('draft','open','paid','past_due','refunded','void')),

  issued_on      date not null default current_date,
  due_on         date not null,
  paid_at        timestamptz,
  refunded_at    timestamptz,

  -- Why a payment failed, in the words the provider used. Shown on Billing.
  failure_reason text,
  attempts       integer not null default 0 check (attempts >= 0),

  provider       text,
  provider_ref   text,

  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now()),

  constraint invoices_period_ordered check (period_end >= period_start),
  constraint invoices_due_after_issue check (due_on >= issued_on),
  constraint invoices_paid_has_time
    check (status <> 'paid' or paid_at is not null),
  constraint invoices_refunded_has_time
    check (status <> 'refunded' or refunded_at is not null)
);

comment on table public.invoices is
  'One billing period for one organisation. Collected, outstanding and refunds are all sums over this table.';

create index if not exists invoices_org_idx on public.invoices (org_id, issued_on desc);
create index if not exists invoices_status_idx on public.invoices (status, due_on);

create sequence if not exists public.invoice_number_seq start with 1041;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ---------- The tenant profile the console asks for --------------------
-- Industry, country and timezone were shown on every organisation and stored
-- for none. They are attributes of the customer, not of a rota, so they belong
-- on the organisation rather than in `settings`, where nothing can index them
-- and every reader has to guess the key.
alter table public.organisations
  add column if not exists industry         text,
  add column if not exists country          text not null default 'United Kingdom',
  add column if not exists timezone         text not null default 'Europe/London',
  add column if not exists contact_email    text,
  add column if not exists contact_phone    text,
  -- Maintained by `touch_org_activity()`, called from the writes that mean a
  -- human was present. Not `updated_at`: a nightly job touching a row is not
  -- activity, and "last seen" that a cron can fake is worthless.
  add column if not exists last_activity_at timestamptz;

comment on column public.organisations.last_activity_at is
  'Last time a human did something in this tenant. Updated by touch_org_activity(), never by a job.';

create or replace function public.touch_org_activity(p_org uuid)
returns void language sql security definer set search_path = public as $$
  update public.organisations
     set last_activity_at = timezone('utc', now())
   where id = p_org
     and (last_activity_at is null
          or last_activity_at < timezone('utc', now()) - interval '5 minutes');
$$;

comment on function public.touch_org_activity(uuid) is
  'Rate-limited to one write per five minutes so a busy tenant does not rewrite its own row on every request.';

grant execute on function public.touch_org_activity(uuid) to authenticated;

-- ---------- Issue and settle -------------------------------------------
create or replace function public.issue_invoice(
  p_org          uuid,
  p_period_start date,
  p_period_end   date,
  p_amount_pence integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_number text;
  v_amount integer;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_finance']) then
    raise exception 'Only platform finance staff can issue an invoice'
      using errcode = '42501';
  end if;

  v_amount := coalesce(p_amount_pence, public.subscription_mrr_pence(p_org));
  if v_amount is null then
    raise exception 'No subscription and no amount — nothing to invoice'
      using errcode = '22023';
  end if;

  v_number := 'INV-' || to_char(p_period_start, 'YYYY') || '-'
              || lpad(nextval('public.invoice_number_seq')::text, 4, '0');

  insert into public.invoices
    (org_id, number, period_start, period_end, amount_pence, due_on)
  values
    (p_org, v_number, p_period_start, p_period_end, v_amount,
     (p_period_end + interval '14 days')::date)
  returning id into v_id;

  perform public.audit_write(
    p_org, 'invoice.issued', 'invoice', v_id,
    jsonb_build_object('number', v_number, 'after', (v_amount / 100.0)::text),
    'info', 'platform_only');

  return v_id;
end;
$$;

revoke all on function public.issue_invoice(uuid, date, date, integer) from public, anon;
grant execute on function public.issue_invoice(uuid, date, date, integer) to authenticated;

create or replace function public.set_invoice_status(
  p_invoice uuid,
  p_status  text,
  p_reason  text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_finance']) then
    raise exception 'Only platform finance staff can change an invoice'
      using errcode = '42501';
  end if;

  select * into inv from public.invoices where id = p_invoice;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  if p_status = 'refunded'
     and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A refund needs a reason' using errcode = '23514';
  end if;

  update public.invoices
     set status         = p_status,
         paid_at        = case when p_status = 'paid'     then timezone('utc', now()) else paid_at end,
         refunded_at    = case when p_status = 'refunded' then timezone('utc', now()) else refunded_at end,
         failure_reason = case when p_status = 'past_due' then btrim(p_reason) else failure_reason end,
         attempts       = case when p_status = 'past_due' then attempts + 1 else attempts end
   where id = p_invoice;

  perform public.audit_write(
    inv.org_id, 'invoice.' || p_status, 'invoice', p_invoice,
    jsonb_build_object('number', inv.number, 'before', inv.status, 'after', p_status),
    case when p_status in ('past_due','refunded') then 'warning' else 'info' end,
    'platform_only');
end;
$$;

revoke all on function public.set_invoice_status(uuid, text, text) from public, anon;
grant execute on function public.set_invoice_status(uuid, text, text) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.plans    enable row level security;
alter table public.invoices enable row level security;

-- The price list is public to signed-in users: an upgrade screen has to be
-- able to say what the next plan costs.
drop policy if exists plans_select on public.plans;
create policy plans_select
  on public.plans for select
  using (auth.uid() is not null);

-- An organisation's own owner sees its invoices — they are the customer. Every
-- other tenant role does not: what the company pays is not staff information.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select
  on public.invoices for select
  using (
    public.has_platform_role(
      array['platform_owner','platform_admin','platform_finance'])
    or public.has_org_role(org_id, array['owner'])
  );

revoke insert, update, delete on public.plans    from anon, authenticated;
revoke insert, update, delete on public.invoices from anon, authenticated;
