-- =====================================================================
-- 0098_subscription_grace_window.sql — a failed payment has a deadline
-- somebody can see (docs/SAAS.md CAP-041)
--
-- When Stripe reports a failed payment the webhook sets
-- `subscriptions.status = 'past_due'`, and that is the whole of it. The
-- row says a payment failed; nothing says when it failed, how long the
-- organisation has, or what happens at the end.
--
-- That gap has two costs, and the second is the expensive one:
--
--   * an owner cannot be told anything useful. "Your subscription is
--     past due" with no date is an alarm without an action, and the
--     screens can only repeat the status back.
--   * nobody can tell a first failed attempt from a fortnight of them.
--     Stripe's Smart Retries run for days before giving up, and the
--     product has no way to distinguish "the card bounced this morning"
--     from "this is the last retry before cancellation".
--
-- ## What this adds, and what it deliberately does not
--
-- Two timestamps: when the dunning window opened, and when it closes.
-- `grace_until` is a RECORDED DEADLINE, not an enforcement point —
-- nothing here suspends anything. Stripe's own dunning decides when a
-- subscription is cancelled, and `set_org_status` (`0051`) is the one
-- path allowed to suspend an organisation, called by the webhook when
-- Stripe says the retries are exhausted.
--
-- Putting a second, independent expiry in this database would be a
-- second opinion about somebody's money, held by the system that does
-- not take the payments. When the two disagreed — and they would, over
-- a retry Stripe scheduled and this did not know about — the customer
-- would be locked out while Stripe was still trying to charge them.
--
-- So this is for TELLING somebody. Fourteen days matches Stripe's
-- default retry schedule closing out, so the date shown is the date the
-- subscription is actually at risk rather than an invented one.
--
-- ## Cleared on recovery
--
-- `invoice.paid` clears both columns. A stale `grace_until` on a
-- healthy subscription would keep a warning on screen after the money
-- arrived, which is the same class of lie as the status itself.
-- =====================================================================

alter table public.subscriptions
  add column if not exists past_due_since timestamptz,
  add column if not exists grace_until    timestamptz;

comment on column public.subscriptions.past_due_since is
  'When the first failed payment in the current dunning run was recorded. Null whenever the subscription is not past due.';

comment on column public.subscriptions.grace_until is
  'The date this subscription is at risk of cancellation, for TELLING an owner. Not an enforcement point: Stripe''s dunning decides, and set_org_status is the only path that suspends an organisation (CAP-041).';

-- ── keeping the two columns honest ────────────────────────────────────
--
-- A trigger rather than trusting the webhook to set three fields in step.
-- The webhook already sets `status`; deriving the window from that means a
-- future caller — a support tool, a manual correction, a replayed event —
-- cannot leave the columns disagreeing with the status.
create or replace function public.subscriptions_track_grace_window()
returns trigger
language plpgsql
as $$
declare
  v_since timestamptz;
  v_until timestamptz;
begin
  -- OLD is unassigned on INSERT, and referencing it there is an error in
  -- plpgsql rather than a null — the same trap 0061's guards branch around.
  if tg_op = 'UPDATE' then
    v_since := old.past_due_since;
    v_until := old.grace_until;
  end if;

  if new.status = 'past_due' then
    -- `coalesce` on the existing value: a second failed payment inside one
    -- dunning run must not restart the clock, or a customer whose card is
    -- retried weekly is never actually at risk and the date on screen is
    -- always a fortnight away.
    new.past_due_since := coalesce(v_since, new.past_due_since,
                                   timezone('utc', now()));
    new.grace_until    := coalesce(v_until, new.grace_until,
                                   timezone('utc', now()) + interval '14 days');
  else
    -- Any recovery — paid, cancelled, back to trialing — ends the window.
    -- Leaving it set would keep a warning on screen after the money arrived.
    new.past_due_since := null;
    new.grace_until    := null;
  end if;
  return new;
end;
$$;

comment on function public.subscriptions_track_grace_window() is
  'Derives past_due_since and grace_until from status, so the three cannot disagree whatever writes the row.';

drop trigger if exists subscriptions_grace_window on public.subscriptions;
create trigger subscriptions_grace_window
  before insert or update of status on public.subscriptions
  for each row execute function public.subscriptions_track_grace_window();
