-- =====================================================================
-- 0155_enquiries_are_received.sql — a website enquiry is stored, not
-- handed to the visitor's mail client (Plans 2026, 06 §5 and 09 F2)
--
-- ## What was wrong
--
-- `/contact` validated a form and then opened a `mailto:` link. A visitor
-- with no mail client configured (most work laptops in a browser, most
-- shared phones) pressed Send, saw "Your message is ready to send", and
-- nothing reached anybody. The page was honest about it, but an honest
-- dead end still loses the enquiry.
--
-- ## What this adds
--
--   * `enquiries`, one row per message from the public contact form.
--   * `receive_enquiry(...)`, the only way a row is written. It applies
--     two rate limits through the existing `consume_rate_limit` (`0085`)
--     and inserts, in one transaction. Executable by `service_role` alone:
--     the caller is the `public-enquiry` Edge Function, which validates
--     the body, checks the honeypot and the optional Turnstile token, and
--     hashes the client IP before calling it.
--   * A retention rule: 24 months, enforced by the nightly job.
--
-- ## A platform-wide table, deliberately (CLAUDE.md, multi-tenancy)
--
-- `enquiries` has NO `org_id`. That is the documented exception, not an
-- oversight: an enquiry comes from somebody who is not yet a customer, so
-- there is no tenant to scope it to, and inventing one (a "prospects"
-- organisation) would put prospect personal data inside a tenant boundary
-- that tenant owners can read. It is platform data, like `support_cases`
-- raised by a prospect and like `platform_announcements`, and it is
-- guarded the way those are:
--
--   * RLS on.
--   * `anon` holds NOTHING. There is no anon INSERT policy and no anon
--     grant. The public form reaches the table only through the Edge
--     Function, which holds `service_role` server-side. This is the
--     reason the function exists: an anon INSERT policy would let any
--     script write unlimited rows straight through PostgREST, with no
--     rate limit, no honeypot and no bot check.
--   * `authenticated` may SELECT and UPDATE `status` only, and RLS limits
--     both to `is_platform_operational()` (owner, admin or support,
--     inheriting the `0102` MFA gate). Finance is excluded: an enquiry is
--     personal data about a prospect, not billing state.
--   * `ip_hash` and `user_agent` are withheld from `authenticated` by
--     column grant. They exist for abuse handling, and the console has no
--     reason to show them.
--
-- ## Why the IP is a hash
--
-- The function stores an HMAC-SHA256 of the client address keyed by a
-- server secret (`ENQUIRY_IP_SALT`), never the address. The rate limiter
-- needs a stable subject per address; nothing needs the address itself.
-- The `rate_limit_events` rows this writes are pruned by the retention
-- branch below after a day, because `consume_rate_limit` only prunes a
-- subject when that same subject calls again, and a one-off visitor
-- never does.
--
-- ## The limits
--
--   enquiry_ip    5 per hour per hashed address. A person sending a
--                 second message with a correction is well inside it.
--   enquiry_all  100 per hour across everybody. The backstop for a
--                 script rotating addresses. When it trips, the form
--                 shows the support email address, so the cost of an
--                 attack is a degraded form, not a lost enquiry and not
--                 a flooded inbox.
--
-- ## Notification
--
-- `notification_outbox.org_id` is NOT NULL and `send-notification` drops
-- every recipient who is not a member of that organisation, so the outbox
-- cannot address platform staff about something that has no organisation
-- (`0148` hit the same wall for a prospect's support case and skipped it).
-- Rather than widen the outbox and the delivery function, the Edge
-- Function sends one short email to a configured platform inbox
-- (`ENQUIRY_NOTIFY_EMAIL`) after the row is committed, carrying no
-- free text from the visitor. The row is the record; the email is a
-- nudge, and the console inbox shows the enquiry whether or not it
-- arrived. See docs/NOTIFICATIONS-SPEC.md.
--
-- ## Rollback
--
-- `drop function public.receive_enquiry(...)`, re-issue
-- `enforce_retention` from `0092`, delete the `enquiries` retention
-- policy row, then drop the table. All of it is additive: no existing
-- row or policy is rewritten.
-- =====================================================================

-- ── the table ─────────────────────────────────────────────────────────
create table if not exists public.enquiries (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  work_email        text not null check (
                      char_length(work_email) between 3 and 254
                      and work_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
                    ),
  organisation      text not null check (char_length(btrim(organisation)) between 1 and 160),
  team_size         text check (team_size in ('1-25', '26-100', '101-500', '500+')),
  sector            text check (sector is null or char_length(sector) between 1 and 80),
  message           text not null check (char_length(btrim(message)) between 10 and 5000),
  wants_demo        boolean not null default false,
  marketing_consent boolean not null default false,
  status            text not null default 'new'
                      check (status in ('new', 'replied', 'demo_booked', 'closed')),
  ip_hash           text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent        text check (user_agent is null or char_length(user_agent) <= 400),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

comment on table public.enquiries is
  'Messages from the public contact form. Platform-wide by design (no org_id): the sender is not yet a customer. Written only by receive_enquiry() through the public-enquiry Edge Function; read and triaged by operational platform roles. Kept 24 months. See 0155.';
comment on column public.enquiries.ip_hash is
  'HMAC-SHA256 of the client address, keyed by a server secret. Never the address. Withheld from authenticated.';
comment on column public.enquiries.marketing_consent is
  'The visitor ticked the unticked-by-default marketing box. False unless they did.';

create index if not exists enquiries_status_created_idx
  on public.enquiries (status, created_at desc);
create index if not exists enquiries_created_idx
  on public.enquiries (created_at);

drop trigger if exists enquiries_set_updated_at on public.enquiries;
create trigger enquiries_set_updated_at
  before update on public.enquiries
  for each row execute function public.set_updated_at();

alter table public.enquiries enable row level security;

-- Nothing to anon, and nothing by default to authenticated: the grants
-- below are the whole of what a browser can do.
revoke all on public.enquiries from anon, authenticated;

grant select (
  id, name, work_email, organisation, team_size, sector, message,
  wants_demo, marketing_consent, status, created_at, updated_at
) on public.enquiries to authenticated;
grant update (status) on public.enquiries to authenticated;

drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select
  on public.enquiries for select
  using (public.is_platform_operational());

drop policy if exists enquiries_update on public.enquiries;
create policy enquiries_update
  on public.enquiries for update
  using (public.is_platform_operational())
  with check (public.is_platform_operational());

-- ── the only writer ───────────────────────────────────────────────────
create or replace function public.receive_enquiry(
  p_name              text,
  p_work_email        text,
  p_organisation      text,
  p_team_size         text,
  p_sector            text,
  p_message           text,
  p_wants_demo        boolean,
  p_marketing_consent boolean,
  p_ip_hash           text,
  p_user_agent        text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'An enquiry needs a hashed client address' using errcode = '22023';
  end if;

  -- Per address first, then the global backstop. Both raise P0001 when
  -- over, which rolls back the other's row with the transaction.
  perform public.consume_rate_limit('enquiry_ip', p_ip_hash, 5, interval '1 hour');
  perform public.consume_rate_limit('enquiry_all', 'all', 100, interval '1 hour');

  insert into public.enquiries (
    name, work_email, organisation, team_size, sector, message,
    wants_demo, marketing_consent, ip_hash, user_agent
  ) values (
    btrim(p_name), btrim(p_work_email), btrim(p_organisation),
    nullif(btrim(coalesce(p_team_size, '')), ''),
    nullif(btrim(coalesce(p_sector, '')), ''),
    btrim(p_message),
    coalesce(p_wants_demo, false), coalesce(p_marketing_consent, false),
    p_ip_hash, left(p_user_agent, 400)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.receive_enquiry(text, text, text, text, text, text, boolean, boolean, text, text) is
  'Rate-limits and stores one contact-form enquiry. service_role only: the public-enquiry Edge Function is the caller. Raises P0001 when a limit is reached. See 0155.';

revoke all on function public.receive_enquiry(text, text, text, text, text, text, boolean, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.receive_enquiry(text, text, text, text, text, text, boolean, boolean, text, text)
  to service_role;

-- ── retention ─────────────────────────────────────────────────────────
-- Twenty-four months. An enquiry that became a customer has moved into
-- that customer's own records by then; one that did not has no reason to
-- be kept longer. Every status is removed, not only `closed`: an enquiry
-- nobody ever triaged is still personal data about somebody who wrote to
-- us once.
insert into public.retention_policies (data_type, label, retain_months, enforced, note)
values (
  'enquiries',
  'Website enquiries',
  24,
  true,
  'Contact-form messages from prospects (0155). Removed 24 months after they arrived, whatever their status. The hashed-address rate-limit rows the form writes are removed after a day.'
)
on conflict (data_type) do nothing;

-- Re-issued from 0092 with one new branch, `enquiries`. Everything else
-- is unchanged.
create or replace function public.enforce_retention(p_dry_run boolean default false)
returns table (data_type text, rows_removed bigint, cutoff date)
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_row public.retention_policies;
  v_cutoff   date;
  v_count    bigint;
  v_outbox   bigint;
begin
  for policy_row in
    select * from public.retention_policies rp
     where rp.retain_months is not null
       and rp.data_type <> 'deleted_tenant'
     order by rp.data_type
  loop
    v_cutoff := (timezone('utc', now()) - (policy_row.retain_months || ' months')::interval)::date;
    v_count := 0;

    if policy_row.data_type = 'rota_history' then
      if p_dry_run then
        select count(*) into v_count from public.shifts where starts_at::date < v_cutoff;
      else
        delete from public.shifts where starts_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        delete from public.rotas
         where period_end < v_cutoff
           and not exists (select 1 from public.shifts s where s.rota_id = rotas.id);
      end if;

    elsif policy_row.data_type = 'attendance' then
      if p_dry_run then
        select count(*) into v_count from public.clock_events where event_at::date < v_cutoff;
      else
        delete from public.clock_events where event_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        delete from public.timesheets where period_end < v_cutoff;
      end if;

    elsif policy_row.data_type = 'leave' then
      if p_dry_run then
        select count(*) into v_count from public.leave_requests where end_date < v_cutoff;
      else
        delete from public.leave_requests where end_date < v_cutoff;
        get diagnostics v_count = row_count;
      end if;

    elsif policy_row.data_type = 'support_cases' then
      if p_dry_run then
        select count(*) into v_count from public.support_cases
         where resolved_at is not null and resolved_at::date < v_cutoff;
      else
        delete from public.support_cases
         where resolved_at is not null and resolved_at::date < v_cutoff;
        get diagnostics v_count = row_count;
      end if;

    elsif policy_row.data_type = 'notifications' then
      if p_dry_run then
        select (select count(*) from public.notification_deliveries d
                 where d.created_at::date < v_cutoff)
             + (select count(*) from public.notification_outbox o
                 where o.created_at::date < v_cutoff
                   and o.status <> 'pending')
          into v_count;
      else
        delete from public.notification_deliveries d
         where d.created_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        delete from public.notification_outbox o
         where o.created_at::date < v_cutoff
           and o.status <> 'pending';
        get diagnostics v_outbox = row_count;
        v_count := v_count + v_outbox;
      end if;

    -- New in 0155.
    elsif policy_row.data_type = 'enquiries' then
      if p_dry_run then
        select count(*) into v_count from public.enquiries e
         where e.created_at::date < v_cutoff;
      else
        delete from public.enquiries e
         where e.created_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        -- The limiter's own rows for the form. A day is far longer than
        -- either window, and they are keyed on a hashed address, so they
        -- are not kept a moment longer than the limit needs. Not counted
        -- in the figure: the policy is about enquiries.
        delete from public.rate_limit_events r
         where r.bucket in ('enquiry_ip', 'enquiry_all')
           and r.created_at < timezone('utc', now()) - interval '1 day';
      end if;

    else
      insert into public.retention_runs (dry_run, data_type, rows_removed, cutoff, error)
      values (p_dry_run, policy_row.data_type, 0, v_cutoff,
              'no rule implemented for this data type');
      continue;
    end if;

    insert into public.retention_runs (dry_run, data_type, rows_removed, cutoff)
    values (p_dry_run, policy_row.data_type, v_count, v_cutoff);

    data_type := policy_row.data_type;
    rows_removed := v_count;
    cutoff := v_cutoff;
    return next;
  end loop;
end;
$$;

-- `create or replace` keeps the existing ACL, but say it in the file that
-- touched it: the nightly job and service_role, never a browser.
revoke all on function public.enforce_retention(boolean) from public, anon, authenticated;
grant execute on function public.enforce_retention(boolean) to service_role;
