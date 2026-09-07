-- =====================================================================
-- 0138_a_finance_role_reads_billing_not_people.sql — what `0122` missed
-- (docs/SAAS.md GAP-053, reopened)
--
-- ## The gap
--
-- `0122` closed role-blindness on eight tables and declared GAP-053 done.
-- It was not. `is_platform_admin()` reads one boolean on `profiles` and is
-- true for all four platform roles, and it was still the whole platform-side
-- guard on a further set of functions and one policy. Every one of them
-- returns operational tenant data or personal data to a role documented in
-- `src/lib/platformRoles.ts` as
--
--   "Subscriptions and billing state only. No operational tenant data."
--
-- Found by enumerating the schema rather than by re-reading the row:
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prosrc ilike '%is_platform_admin()%'
--      and p.prosrc not ilike '%has_platform_role%';
--
-- That is the query `0122` needed and did not run. Two of its own statements
-- are wrong because of it: its header says `platform_user_auth_facts`
-- "does not exist in this schema; nothing was done about it because there is
-- nothing to do". It has existed since `0027`, it reads `auth.users`, and it
-- was readable by finance for every account on the platform.
--
-- ## What this closes
--
-- | Object                          | Was                     | Now                        |
-- | ------------------------------- | ----------------------- | -------------------------- |
-- | `gdpr_requests_select`          | four roles by name      | `is_platform_operational()` |
-- | `platform_user_auth_facts`      | `is_platform_admin()`   | `is_platform_operational()` |
-- | `platform_auth_facts_summary`   | `is_platform_admin()`   | `is_platform_operational()` |
-- | `platform_tenant_counts`        | `is_platform_admin()`   | `is_platform_operational()` |
-- | `support_sla_state`             | `is_platform_admin()`   | `is_platform_operational()` |
-- | `reply_to_support_case`         | `is_platform_admin()`   | `is_platform_operational()` |
-- | `open_support_case`             | `is_platform_admin()`   | `is_platform_operational()` |
-- | `platform_totals`               | `is_platform_admin()`   | `is_platform_operational()` |
-- | `organisation_deletion_preview` | `is_platform_admin()`   | owner + admin, as the delete |
--
-- `gdpr_requests` is the worst of them and the reason this is not deferred:
-- the DSAR register carries a data subject's name, their email, the
-- organisation they belong to, the reason a deadline was extended and the
-- outcome note. `0122` enumerated tables by hand and this one was not on the
-- list. `src/App.tsx` also carried no `RequirePlatformRole` on `/admin/gdpr`,
-- and `src/lib/adminNav.ts` recorded that omission as something to change
-- "together with the policy". This is that change; the route and nav gates
-- move in the same commit.
--
-- `reply_to_support_case` is the only WRITE in the set, and it is worse than
-- a read. `0122` removed finance's read of `support_cases` and of
-- `support_case_messages`, so a finance account cannot open a case — but it
-- could still post into one with a known id, rendering to the customer as
-- **Platform**, and could write a message flagged `is_internal`. `0116` named
-- roles for three write paths and missed this one.
--
-- ## What this deliberately leaves alone
--
-- `platform_staff_counts`, `platform_location_counts`, `platform_growth`,
-- `platform_organisation_facets` and `organisations_select` all stay readable
-- by finance. Seat usage IS billing state — the
-- subscriptions console reads `platform_staff_counts` to show seats against
-- plan, and that console is the one this role exists to use. `0122` made the
-- same call about `organisations` for the same reason, and it was right.
--
-- `set_platform_mfa_required` matched the enumeration query only because
-- `is_platform_admin()` appears in one of its comments. Its actual guard reads
-- `platform_admins` directly for `platform_owner`, deliberately, so that the
-- off switch cannot be locked out by the setting it writes. Untouched.
--
-- ## A second, smaller correction, in the same function
--
-- `support_sla_state` guarded on `is_platform_admin() or requester_id =
-- auth.uid()`. An organisation owner can read a case raised by one of their
-- staff (`support_cases_select`, `0122`) and could not read that case's SLA
-- state — the promise made to their own organisation. The rewrite below adds
-- the owner, so the function's readership matches the table's.
--
-- ## Rollback
--
-- Restore the eight bodies from `0020`, `0024`, `0027`, `0028`, `0110` and
-- `0116`. Every statement here is `create or replace` or a policy swap; no
-- table is rewritten, no grant is widened, and nothing is dropped.
-- =====================================================================

-- ---------- The DSAR register ----------------------------------------
--
-- Was: has_platform_role(owner, admin, support, finance) or org owner.
-- The customer-facing half is reproduced exactly.

drop policy if exists gdpr_requests_select on public.gdpr_requests;

create policy gdpr_requests_select on public.gdpr_requests
  for select
  using (
    public.is_platform_operational()
    or (org_id is not null and public.has_org_role(org_id, array['owner']))
  );

comment on policy gdpr_requests_select on public.gdpr_requests is
  'Operational platform staff, or the owner of the organisation a request names. Finance is excluded: a DSAR register is the data subject''s name, email and outcome note, which is not billing state (0138).';

-- ---------- Account security facts -----------------------------------
--
-- Both read `auth.users`, which no client may select from. The narrow shape
-- is the point of the functions; the guard is what was wrong.

create or replace function public.platform_user_auth_facts(p_user uuid)
returns table (
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  mfa_enrolled       boolean,
  banned_until       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operational() then
    raise exception 'Only operational platform staff can read account security facts'
      using errcode = '42501';
  end if;

  return query
    select u.email_confirmed_at,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = u.id and f.status = 'verified'),
           u.banned_until
      from auth.users u
     where u.id = p_user;
end;
$$;

create or replace function public.platform_auth_facts_summary()
returns table (
  total_accounts bigint,
  unverified     bigint,
  active_30d     bigint,
  inactive_90d   bigint,
  mfa_enrolled   bigint,
  banned         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operational() then
    raise exception 'Only operational platform staff can read account security facts'
      using errcode = '42501';
  end if;

  return query
    select
      count(*),
      count(*) filter (where u.email_confirmed_at is null),
      count(*) filter (where u.last_sign_in_at > timezone('utc', now()) - interval '30 days'),
      -- Never signed in counts as inactive: an account created a year ago and
      -- never used is exactly what this tile is for.
      count(*) filter (where u.last_sign_in_at is null
                          or u.last_sign_in_at < timezone('utc', now()) - interval '90 days'),
      count(*) filter (where exists (select 1 from auth.mfa_factors f
                                      where f.user_id = u.id and f.status = 'verified')),
      count(*) filter (where u.banned_until is not null
                          and u.banned_until > timezone('utc', now()))
    from auth.users u;
end;
$$;

-- ---------- Tenant operational counts --------------------------------
--
-- Staff, locations, departments, published rotas and this month's shifts.
-- None of that is billing state; seats are, and `platform_staff_counts` is
-- the function that answers seats.

create or replace function public.platform_tenant_counts(p_org uuid)
returns table (
  staff_total     bigint,
  staff_active    bigint,
  locations       bigint,
  departments     bigint,
  published_rotas bigint,
  shifts_month    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operational() then
    raise exception 'Only operational platform staff can read tenant counts'
      using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.staff_profiles where org_id = p_org),
      (select count(*) from public.staff_profiles where org_id = p_org and active),
      (select count(*) from public.locations where org_id = p_org),
      (select count(*) from public.departments where org_id = p_org),
      (select count(*) from public.rotas where org_id = p_org and status = 'published'),
      (select count(*) from public.shifts
        where org_id = p_org
          and starts_at >= date_trunc('month', timezone('utc', now())));
end;
$$;

-- ---------- Estate-wide operational totals ----------------------------
--
-- Six numbers, and only the first two are billing state. `profiles`,
-- `staff_profiles`, published rotas and this month's shifts are the size of
-- the workforce the platform carries, which is the thing finance is documented
-- not to see. `0133` already made the same call for
-- `platform_operations_summary`, which raises for finance in exactly these
-- words; this is that decision applied to the function beside it.
--
-- The overview loads its eleven sources through `Promise.allSettled` and names
-- each one, so a finance session now reads "tenant and account totals" as
-- unavailable and every other panel still renders. That is the intended
-- outcome: a refusal that says so beats a tile quietly reporting the estate's
-- headcount to a role that should not have it.

create or replace function public.platform_totals()
returns table (
  organisations   bigint,
  active_orgs     bigint,
  profiles        bigint,
  staff_profiles  bigint,
  published_rotas bigint,
  shifts_month    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operational() then
    raise exception 'Only an operational platform role can read platform totals'
      using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.organisations),
      (select count(*) from public.organisations where status = 'active'),
      (select count(*) from public.profiles),
      (select count(*) from public.staff_profiles),
      (select count(*) from public.rotas where status = 'published'),
      (select count(*) from public.shifts
        where starts_at >= date_trunc('month', timezone('utc', now())));
end;
$$;

-- ---------- The promise on a case ------------------------------------
--
-- Guard widened for the organisation owner and narrowed for finance, in the
-- same statement. Body otherwise reproduced from `0110`.

create or replace function public.support_sla_state(p_case uuid)
returns table (
  first_response_state text,
  resolution_state     text,
  minutes_to_respond   integer,
  minutes_to_resolve   integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when c.first_response_at is not null and c.first_response_at <= c.first_response_due_at
        then 'met'
      when c.first_response_at is not null then 'breached'
      when timezone('utc', now()) > c.first_response_due_at then 'breached'
      when timezone('utc', now()) > c.first_response_due_at - interval '30 minutes'
        then 'due_soon'
      else 'on_track'
    end,
    case
      when c.resolved_at is not null and c.resolved_at <= c.resolution_due_at then 'met'
      when c.resolved_at is not null then 'breached'
      when c.status in ('resolved', 'closed') then 'met'
      when timezone('utc', now()) > c.resolution_due_at then 'breached'
      else 'on_track'
    end,
    (extract(epoch from (c.first_response_due_at - timezone('utc', now()))) / 60)::integer,
    (extract(epoch from (c.resolution_due_at - timezone('utc', now()))) / 60)::integer
    from public.support_cases c
   where c.id = p_case
     and (
       public.is_platform_operational()
       or c.requester_id = auth.uid()
       or (c.org_id is not null and public.has_org_role(c.org_id, array['owner']))
     );
$$;

-- ---------- Writing into a case --------------------------------------
--
-- The side a message is attributed to decided who may write an internal note.
-- A finance account failing `is_platform_operational()` now falls through to
-- the customer branch, which refuses it: it is neither the requester nor an
-- owner of the organisation. That is the correct refusal and it needs no
-- separate raise.

create or replace function public.reply_to_support_case(
  p_case     uuid,
  p_body     text,
  p_internal boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        public.support_cases;
  v_msg    uuid;
  v_name   text;
  v_side   text;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  v_side := case when public.is_platform_operational() then 'platform' else 'customer' end;

  if v_side = 'customer' then
    if c.requester_id is distinct from auth.uid()
       and not (c.org_id is not null and public.has_org_role(c.org_id, array['owner'])) then
      raise exception 'You cannot reply to that case' using errcode = '42501';
    end if;
    if p_internal then
      raise exception 'Only platform staff can write an internal note'
        using errcode = '42501';
    end if;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.support_case_messages
    (case_id, author_id, author_name, author_side, body, is_internal)
  values (p_case, auth.uid(), v_name, v_side, btrim(p_body), p_internal)
  returning id into v_msg;

  -- The first public reply from platform staff is the first response, and it
  -- is stamped exactly once. An internal note is not a response to anyone.
  if v_side = 'platform' and not p_internal and c.first_response_at is null then
    update public.support_cases
       set first_response_at = timezone('utc', now()),
           status = case when status = 'open' then 'pending' else status end
     where id = p_case;
  end if;

  return v_msg;
end;
$$;

-- ---------- Opening a case on a tenant's behalf ----------------------
--
-- Same substitution, same consequence: finance falls to the customer branch
-- and is refused on an organisation it is not a member of.

create or replace function public.open_support_case(
  p_subject         text,
  p_body            text,
  p_category        text default 'other',
  p_priority        text default 'normal',
  p_org             uuid default null,
  p_requester_email text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_ref   text;
  v_email text;
  v_name  text;
  v_org   uuid := p_org;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open a support case' using errcode = '42501';
  end if;

  select p.email, p.full_name into v_email, v_name
    from public.profiles p where p.id = auth.uid();

  -- Operational platform staff may raise a case on a tenant's behalf and name
  -- the address it came from. A customer may not: they are the requester.
  if public.is_platform_operational() then
    v_email := coalesce(nullif(btrim(coalesce(p_requester_email,'')),''), v_email);
  elsif v_org is not null and not public.is_org_member(v_org) then
    raise exception 'You are not a member of that organisation' using errcode = '42501';
  end if;

  v_ref := 'CASE-' || lpad(nextval('public.support_case_reference_seq')::text, 4, '0');

  insert into public.support_cases
    (reference, org_id, requester_id, requester_name, requester_email,
     subject, category, priority)
  values
    (v_ref, v_org, auth.uid(), v_name, v_email,
     btrim(p_subject), p_category, p_priority)
  returning id into v_id;

  insert into public.support_case_messages
    (case_id, author_id, author_name, author_side, body)
  values
    (v_id, auth.uid(), v_name,
     case when public.is_platform_operational() then 'platform' else 'customer' end,
     btrim(p_body));

  perform public.audit_write(
    v_org, 'support_case.opened', 'support_case', v_id,
    jsonb_build_object('reference', v_ref, 'after', p_priority),
    case when p_priority = 'urgent' then 'warning' else 'info' end,
    'both');

  return v_id;
end;
$$;

-- ---------- What deletion would destroy -------------------------------
--
-- The preview is read by the same modal that calls `delete_organisation`, and
-- that function admits an org owner or `platform_owner`/`platform_admin`. The
-- preview admitted any platform role, so finance could count a tenant's staff,
-- clock events, leave requests and documents through the one function whose
-- whole purpose is to enumerate them.

create or replace function public.organisation_deletion_preview(p_org uuid)
returns table (
  staff_profiles bigint,
  locations      bigint,
  rotas          bigint,
  shifts         bigint,
  clock_events   bigint,
  leave_requests bigint,
  documents      bigint,
  members        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.staff_profiles where org_id = p_org),
    (select count(*) from public.locations      where org_id = p_org),
    (select count(*) from public.rotas          where org_id = p_org),
    (select count(*) from public.shifts         where org_id = p_org),
    (select count(*) from public.clock_events   where org_id = p_org),
    (select count(*) from public.leave_requests where org_id = p_org),
    (select count(*) from public.documents      where org_id = p_org),
    (select count(*) from public.memberships    where org_id = p_org)
  where public.has_org_role(p_org, array['owner'])
     or public.has_platform_role(array['platform_owner','platform_admin']);
$$;

-- ---------- Grants ----------------------------------------------------
--
-- Restated because `create or replace` on a function that already existed
-- keeps its ACL, but a rebuilt database replays this file against a function
-- that does not — the `0113` lesson. `anon` is named in the revoke and gets
-- nothing.

revoke all on function public.platform_user_auth_facts(uuid) from public, anon;
grant execute on function public.platform_user_auth_facts(uuid) to authenticated;

revoke all on function public.platform_auth_facts_summary() from public, anon;
grant execute on function public.platform_auth_facts_summary() to authenticated;

revoke all on function public.platform_tenant_counts(uuid) from public, anon;
grant execute on function public.platform_tenant_counts(uuid) to authenticated;

revoke all on function public.platform_totals() from public, anon;
grant execute on function public.platform_totals() to authenticated;

revoke all on function public.support_sla_state(uuid) from public, anon;
grant execute on function public.support_sla_state(uuid) to authenticated;

revoke all on function public.reply_to_support_case(uuid, text, boolean) from public, anon;
grant execute on function public.reply_to_support_case(uuid, text, boolean) to authenticated;

revoke all on function public.open_support_case(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.open_support_case(text, text, text, text, uuid, text) to authenticated;

revoke all on function public.organisation_deletion_preview(uuid) from public, anon;
grant execute on function public.organisation_deletion_preview(uuid) to authenticated;

comment on function public.platform_user_auth_facts(uuid) is
  'Four account security facts for one user, read from auth.users. Operational platform staff only (0138).';
comment on function public.platform_auth_facts_summary() is
  'Estate-wide account security counts. Operational platform staff only (0138).';
comment on function public.platform_tenant_counts(uuid) is
  'Operational counts for one tenant, past RLS. Operational platform staff only — seats are billing state and live in platform_staff_counts (0138).';
comment on function public.organisation_deletion_preview(uuid) is
  'What deleting this organisation would destroy. Readable by exactly the roles delete_organisation admits (0138).';
