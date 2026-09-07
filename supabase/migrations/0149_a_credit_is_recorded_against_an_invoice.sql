-- =====================================================================
-- 0149_a_credit_is_recorded_against_an_invoice.sql (GAP-080)
--
-- The billing console had a "Credit" button, disabled since it shipped, and
-- `0138`'s pass removed it rather than leave a promise. GAP-080 recorded why
-- completing it was not a UI task: no credit-note table, no RPC that could
-- write one, and no documented policy about who may credit what and up to how
-- much.
--
-- This builds the mechanism. It deliberately does NOT invent the parts that
-- are somebody's commercial decision, and says which those are.
--
-- ## What this is, and firmly is not
--
-- A credit RECORDED against an invoice in RotaFlow's own ledger. It does not
-- call Stripe, issue a Stripe credit note, refund a charge or move any money.
-- Nothing here can cause a payment.
--
-- That is not a limitation to fix later by adding an API call. A credit that
-- adjusts what RotaFlow believes it is owed, and a refund that returns money
-- to a card, are different decisions with different authority and different
-- consequences if wrong. This is the first; the second is not built, and
-- `docs/SAAS.md` says so rather than a comment implying it is nearly done.
--
-- ## The rules, and where each comes from
--
-- Every one is derived from something already in the schema, NOT chosen:
--
--   * **Who.** `platform_owner`, `platform_admin`, `platform_finance` — the
--     same list `PLATFORM_BILLING_ROLES` uses in the client and the same one
--     `invoices_select` admits. Support is excluded: it cannot read the
--     billing console at all.
--   * **Which invoices.** `open`, `past_due` or `paid`. Not `draft` (nothing
--     has been claimed yet), not `void` (the claim was withdrawn) and not
--     `refunded` (the money already went back) — the status CHECK on
--     `invoices` is what enumerates those.
--   * **How much.** Up to the invoice's own gross total, `amount_pence +
--     tax_pence`, less whatever has already been credited. The ceiling is the
--     invoice, so no commercial limit is invented.
--   * **Currency.** Inherited from the invoice and never a parameter, so a
--     credit cannot be recorded in a currency the invoice was not issued in.
--     `0134` had to split billing totals by currency for exactly this reason.
--   * **Why.** A reason of at least ten characters, required. A credit with no
--     stated reason is indistinguishable from a mistake when somebody reads
--     the ledger a year later.
--
-- ## What is NOT decided here, and must be before this is used in anger
--
--   * Whether a credit ever reaches Stripe, and who may authorise that.
--   * Whether crediting a `paid` invoice should trigger a refund, or only
--     offset the next invoice. This records the credit either way; nothing
--     consumes it yet.
--   * Any approval threshold — an amount above which a second person must
--     agree. There is no such concept in this schema and inventing one would
--     be inventing policy.
--
-- ## Idempotency
--
-- `idempotency_key` is unique per invoice. A retried request with the same key
-- returns the credit already recorded instead of adding a second one, which is
-- the same shape `claim_billing_event` (`0125`) uses for Stripe deliveries and
-- for the same reason: the caller cannot tell a lost response from a failure.
--
-- ## Grants
--
-- `authenticated` gets SELECT and nothing else. Every write goes through the
-- RPC, which is the lesson `0145` and `0146` are both records of: a table grant
-- wider than the function meant to own it is a guard waiting to be bypassed.
-- =====================================================================

create table if not exists public.invoice_credits (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  -- Denormalised from the invoice so RLS can scope without a join, the same
  -- shape every other tenant table uses.
  org_id          uuid not null references public.organisations(id) on delete cascade,
  amount_pence    integer not null,
  currency        text not null,
  reason          text not null,
  idempotency_key text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default timezone('utc', now()),

  constraint invoice_credits_amount_positive check (amount_pence > 0),
  constraint invoice_credits_currency_shape check (currency ~ '^[A-Z]{3}$'),
  constraint invoice_credits_reason_stated check (length(btrim(reason)) >= 10)
);

-- One credit per key per invoice. Partial, so an ad-hoc credit with no key is
-- still allowed and two of them do not collide.
create unique index if not exists invoice_credits_idempotency
  on public.invoice_credits (invoice_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists invoice_credits_invoice on public.invoice_credits (invoice_id);
create index if not exists invoice_credits_org on public.invoice_credits (org_id);

alter table public.invoice_credits enable row level security;

-- Readable by exactly who may read the invoice it belongs to.
create policy invoice_credits_select on public.invoice_credits
  for select
  using (
    public.has_platform_role(
      array['platform_owner', 'platform_admin', 'platform_finance'])
    or public.has_org_role(org_id, array['owner'])
  );

revoke all on public.invoice_credits from public, anon;
grant select on public.invoice_credits to authenticated;

comment on table public.invoice_credits is
  'Credits recorded against an invoice in RotaFlow''s own ledger. Written only by credit_invoice (0149). This does NOT call Stripe, issue a credit note or move money — see the migration header for what is deliberately not decided.';

-- ---------- the one writer ---------------------------------------------

create or replace function public.credit_invoice(
  p_invoice         uuid,
  p_amount_pence    integer,
  p_reason          text,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv          public.invoices;
  v_credited   integer;
  v_gross      integer;
  v_existing   uuid;
  v_id         uuid;
begin
  if not public.has_platform_role(
       array['platform_owner', 'platform_admin', 'platform_finance']) then
    raise exception 'Only platform billing staff can credit an invoice'
      using errcode = '42501';
  end if;

  -- Idempotency first: a retry must not be refused for a reason the original
  -- call already passed, and must not depend on the invoice still qualifying.
  if p_idempotency_key is not null then
    select id into v_existing
      from public.invoice_credits
     where invoice_id = p_invoice
       and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  -- `for update`, so two concurrent credits cannot both read the same
  -- remaining headroom and both pass the ceiling. The last-owner race in 0140
  -- was exactly this shape.
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  if inv.status not in ('open', 'past_due', 'paid') then
    raise exception
      'An invoice that is % cannot be credited', inv.status
      using errcode = '22023',
            hint = 'Only an open, past due or paid invoice can be credited.';
  end if;

  if p_amount_pence is null or p_amount_pence <= 0 then
    raise exception 'A credit must be a positive amount' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null
     or length(btrim(p_reason)) < 10 then
    raise exception 'A credit needs a reason saying why it was given'
      using errcode = '22023';
  end if;

  v_gross := inv.amount_pence + coalesce(inv.tax_pence, 0);

  select coalesce(sum(amount_pence), 0) into v_credited
    from public.invoice_credits
   where invoice_id = p_invoice;

  if v_credited + p_amount_pence > v_gross then
    raise exception
      'That would credit % more than the invoice is worth',
      ((v_credited + p_amount_pence) - v_gross)
      using errcode = '22023',
            hint = 'The ceiling is the invoice total less what is already credited.';
  end if;

  insert into public.invoice_credits
    (invoice_id, org_id, amount_pence, currency, reason, idempotency_key, created_by)
  values
    -- Currency from the INVOICE, never from the caller: a credit cannot be
    -- recorded in a currency the invoice was not issued in.
    (p_invoice, inv.org_id, p_amount_pence, inv.currency,
     btrim(p_reason), p_idempotency_key, auth.uid())
  returning id into v_id;

  -- `both`: the customer is entitled to see that their invoice was credited.
  perform public.audit_write(
    inv.org_id,
    'invoice.credited',
    'invoice',
    p_invoice,
    jsonb_build_object(
      'credit_id', v_id,
      'amount_pence', p_amount_pence,
      'currency', inv.currency,
      'invoice_number', inv.number,
      'reason', btrim(p_reason)),
    'warning',
    'both');

  return v_id;
end;
$$;

revoke all on function public.credit_invoice(uuid, integer, text, text) from public, anon;
grant execute on function public.credit_invoice(uuid, integer, text, text) to authenticated;

comment on function public.credit_invoice(uuid, integer, text, text) is
  'Records a credit against an invoice. Platform billing roles only; open, past due or paid invoices only; capped at the invoice gross less what is already credited; currency inherited from the invoice; reason required; idempotent on (invoice, key). Records only — it does not call Stripe or move money (0149).';
