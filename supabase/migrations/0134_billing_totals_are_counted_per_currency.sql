-- =====================================================================
-- 0134_billing_totals_are_counted_per_currency.sql — the billing
-- console's money figures are summed in the database, per currency, and
-- its invoice list is paged
--
-- ## Two problems, and they compound
--
-- **1. The totals were sums over a bounded list.** `listInvoices(300)`
-- is honestly bounded and its comment says so; what nothing said is that
-- Collected, Outstanding, Past due and Refunds are sums over those three
-- hundred rows, printed as platform totals. `invoices` grows once per
-- customer per month, so the three-hundredth row is roughly twenty-five
-- customers back — and after that, "outstanding" quietly means
-- "outstanding among the most recent three hundred invoices", which is
-- not a debt figure at all.
--
-- **2. Currency was ignored.** Every function in `src/lib/revenue.ts`
-- adds `amount_pence` to `amount_pence` and the screen prints the result
-- with a pound sign, because `formatMoney` defaults to GBP. That is
-- correct for one currency and nonsense for two. Today every row is GBP
-- — the column defaults to it and nothing has written otherwise — so the
-- arithmetic is right by accident, and the accident survives exactly
-- until the first customer is billed in euros.
--
-- Exchange rates are a product decision with a rate source and a date
-- behind them. So this does not convert: it groups. One currency, one
-- row, and a console that has two rows shows two totals instead of one
-- wrong one.
--
-- ## Why MRR is here and not in the view
--
-- `subscription_mrr_pence` (0023) exists and answers for one
-- organisation. The platform figure is the same arithmetic across every
-- tenant, and it needs the plan price as a fallback where
-- `price_pence` is null — which is the negotiated-price column, null for
-- everybody on list price.
--
-- SAFETY(none): additive. Two new functions, no table altered, no policy
-- changed, no grant widened beyond EXECUTE to `authenticated` on
-- functions that refuse a caller without a billing platform role.
-- =====================================================================

create or replace function public.platform_billing_summary()
returns table (
  currency                  text,
  mrr_pence                 bigint,
  paying_orgs               bigint,
  collected_month_pence     bigint,
  collected_prev_month_pence bigint,
  outstanding_pence         bigint,
  past_due_pence            bigint,
  refunded_month_pence      bigint,
  open_invoices             bigint,
  past_due_invoices         bigint,
  refunded_invoices         bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month      timestamptz := date_trunc('month', timezone('utc', now()));
  v_prev_month timestamptz := date_trunc('month', timezone('utc', now())) - interval '1 month';
begin
  -- Billing roles, which includes finance: this is exactly the data that
  -- role exists to read.
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_finance']) then
    raise exception 'Only a billing platform role can read the billing summary'
      using errcode = '42501';
  end if;

  return query
  with subs as (
    select
      upper(coalesce(s.currency, 'GBP')) as currency,
      -- Active AND past due. A past-due subscription is still a customer
      -- with a contract; writing it out the day a card fails makes the
      -- headline swing on payment retries rather than on customers. Same
      -- rule as monthlyRecurringPence in src/lib/revenue.ts.
      sum(coalesce(s.price_pence, p.monthly_price_pence, 0))::bigint as mrr_pence,
      count(*)::bigint as paying_orgs
      from public.subscriptions s
      left join public.plans p on p.code = s.plan
     where s.status in ('active', 'past_due')
     group by 1
  ),
  inv as (
    select
      upper(coalesce(i.currency, 'GBP')) as currency,
      -- Collected by PAYMENT date, not by issue date: an invoice issued in
      -- March and paid in April is April's money.
      coalesce(sum(i.amount_pence) filter (
        where i.paid_at >= v_month), 0)::bigint as collected_month_pence,
      coalesce(sum(i.amount_pence) filter (
        where i.paid_at >= v_prev_month and i.paid_at < v_month), 0)::bigint
        as collected_prev_month_pence,
      -- Outstanding is not scoped to a month. An invoice from March that is
      -- still open is money owed today, and dropping it because the month
      -- has passed is how a debt vanishes from a dashboard.
      coalesce(sum(i.amount_pence) filter (
        where i.status in ('open', 'past_due')), 0)::bigint as outstanding_pence,
      coalesce(sum(i.amount_pence) filter (
        where i.status = 'past_due'), 0)::bigint as past_due_pence,
      coalesce(sum(i.amount_pence) filter (
        where i.refunded_at >= v_month), 0)::bigint as refunded_month_pence,
      count(*) filter (where i.status in ('open', 'past_due'))::bigint as open_invoices,
      count(*) filter (where i.status = 'past_due')::bigint as past_due_invoices,
      count(*) filter (where i.refunded_at >= v_month)::bigint as refunded_invoices
      from public.invoices i
     group by 1
  )
  select
    coalesce(subs.currency, inv.currency),
    coalesce(subs.mrr_pence, 0),
    coalesce(subs.paying_orgs, 0),
    coalesce(inv.collected_month_pence, 0),
    coalesce(inv.collected_prev_month_pence, 0),
    coalesce(inv.outstanding_pence, 0),
    coalesce(inv.past_due_pence, 0),
    coalesce(inv.refunded_month_pence, 0),
    coalesce(inv.open_invoices, 0),
    coalesce(inv.past_due_invoices, 0),
    coalesce(inv.refunded_invoices, 0)
    -- A full join, because a currency can appear on one side only: a
    -- brand-new customer has a subscription and no invoice yet, and a
    -- cancelled one has invoices and no subscription.
    from subs full join inv on inv.currency = subs.currency
   order by coalesce(subs.mrr_pence, 0) + coalesce(inv.collected_month_pence, 0) desc;
end;
$$;

comment on function public.platform_billing_summary() is
  'Recurring revenue, collections, debt and refunds across every tenant, '
  'grouped by currency and never converted between them. One row per '
  'currency, so a console with two rows shows two totals rather than one '
  'wrong one. See 0134.';

revoke execute on function public.platform_billing_summary() from public, anon;
grant execute on function public.platform_billing_summary() to authenticated;

-- ---------------------------------------------------------------------
-- The invoice list, filtered, counted and paged in the database.
-- ---------------------------------------------------------------------
create or replace function public.platform_invoice_directory(
  p_search    text        default null,
  p_status    text[]      default null,
  p_org       uuid[]      default null,
  p_currency  text[]      default null,
  p_from      date        default null,
  p_to        date        default null,
  p_sort      text        default 'issued_on',
  p_direction text        default 'desc',
  p_limit     integer     default 25,
  p_offset    integer     default 0
)
returns table (
  id             uuid,
  org_id         uuid,
  org_name       text,
  number         text,
  period_start   date,
  period_end     date,
  amount_pence   integer,
  tax_pence      integer,
  currency       text,
  status         text,
  issued_on      date,
  due_on         date,
  paid_at        timestamptz,
  refunded_at    timestamptz,
  failure_reason text,
  attempts       integer,
  provider       text,
  provider_ref   text,
  total_count    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_limit   integer;
  v_offset  integer;
  v_sort    text;
  v_desc    boolean;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_finance']) then
    raise exception 'Only a billing platform role can read the invoice directory'
      using errcode = '42501';
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  v_sort := case coalesce(p_sort, '')
              when 'number'       then 'number'
              when 'amount_pence' then 'amount_pence'
              when 'status'       then 'status'
              when 'org_name'     then 'org_name'
              when 'due_on'       then 'due_on'
              when 'paid_at'      then 'paid_at'
              else 'issued_on'
            end;
  v_desc := lower(coalesce(p_direction, 'desc')) = 'desc';

  v_pattern := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  return query
  with directory as (
    select
      i.id, i.org_id, o.name as org_name, i.number,
      i.period_start, i.period_end, i.amount_pence, i.tax_pence,
      upper(coalesce(i.currency, 'GBP')) as currency,
      i.status, i.issued_on, i.due_on, i.paid_at, i.refunded_at,
      i.failure_reason, i.attempts, i.provider, i.provider_ref
      from public.invoices i
      -- Left join: `organisations.id` is `on delete cascade` from invoices,
      -- but a name is still nullable in the join if the row is mid-delete.
      -- A nameless invoice is better than a missing one on a debt screen.
      left join public.organisations o on o.id = i.org_id
     where (p_status is null or array_length(p_status, 1) is null
            or i.status = any (p_status))
       and (p_org is null or array_length(p_org, 1) is null
            or i.org_id = any (p_org))
       and (p_currency is null or array_length(p_currency, 1) is null
            or upper(coalesce(i.currency, 'GBP')) = any (p_currency))
       and (p_from is null or i.issued_on >= p_from)
       and (p_to   is null or i.issued_on <  p_to)
       and (v_pattern is null
            or i.number ilike v_pattern
            or o.name ilike v_pattern
            or i.provider_ref ilike v_pattern)
  )
  select d.*, count(*) over () as total_count
    from directory d
   order by
     case when v_desc then null else
       case v_sort
         when 'number'   then d.number
         when 'status'   then d.status
         when 'org_name' then lower(coalesce(d.org_name, ''))
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'number'   then d.number
         when 'status'   then d.status
         when 'org_name' then lower(coalesce(d.org_name, ''))
       end end desc nulls last,
     case when v_desc then null else
       case v_sort when 'amount_pence' then d.amount_pence end end asc nulls last,
     case when v_desc then
       case v_sort when 'amount_pence' then d.amount_pence end end desc nulls last,
     case when v_desc then null else
       case v_sort
         when 'issued_on' then d.issued_on
         when 'due_on'    then d.due_on
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'issued_on' then d.issued_on
         when 'due_on'    then d.due_on
       end end desc nulls last,
     case when v_desc then null else
       case v_sort when 'paid_at' then d.paid_at end end asc nulls last,
     case when v_desc then
       case v_sort when 'paid_at' then d.paid_at end end desc nulls last,
     -- The tie-break. Several invoices share an issue date every month.
     d.id asc
   limit v_limit offset v_offset;
end;
$$;

comment on function public.platform_invoice_directory(text, text[], uuid[], text[], date, date, text, text, integer, integer) is
  'One page of invoices across every tenant, filtered, sorted and counted in '
  'the database. total_count is the whole matching set. Billing platform roles '
  'only. See 0134.';

revoke execute on function public.platform_invoice_directory(text, text[], uuid[], text[], date, date, text, text, integer, integer)
  from public, anon;
grant execute on function public.platform_invoice_directory(text, text[], uuid[], text[], date, date, text, text, integer, integer)
  to authenticated;
