-- =====================================================================
-- 0146_a_reply_reaches_the_person_who_asked.sql
--
-- Two of the three gaps the 7 September audits recorded rather than closed.
-- GAP-106, stale tenant data left on screen after a session ends, is a client
-- change and is in the same commit.
--
-- ## GAP-104 — a support reply notified nobody
--
-- The tenant-visible thread on `/app/help` was the only delivery. No Edge
-- Function handles a support message and no trigger enqueued one, so a
-- customer learned that platform staff had answered by happening to open the
-- case again. The console said "Reply sent."
--
-- It needs no deploy. `notification_outbox` has been drained every minute by a
-- pg_cron job since `0069`, and `0132` already put platform announcements on
-- that path. An insert here rides the same one.
--
-- Narrow on purpose: a public reply only, from the platform side only, and
-- only where the case belongs to an organisation and has a signed-in
-- requester. An internal note is not addressed to anybody outside; a customer
-- replying to their own case does not need telling; and `notification_outbox`
-- requires `org_id`, which a prospect's case does not have — that case has no
-- in-app recipient either way, so it is skipped rather than forced.
--
-- The `type` is `support`, which `send-notification` has no mapping for. That
-- is deliberate and safe: its own comment says an unmapped type falls through
-- to everything-allowed rather than being dropped, because "refusing to send
-- something an owner never had the chance to configure would be a worse
-- failure than sending it".
--
-- **What this does NOT prove.** That the last mile works. Nothing here has
-- been watched arriving in an inbox, and it cannot be from this machine. It
-- proves the reply joins the queue that drains — the same claim, and the same
-- limit, `0132` records for announcements (❓-007).
--
-- ## GAP-105 — a support session could create an organisation owner
--
-- `memberships_write` is `has_org_role(org_id, array['owner'])` for ALL
-- commands, and since `0028` `has_org_role` ends with
-- `or has_support_access(p_org, true)`. So a platform administrator holding a
-- `read_write` support session could write `role = 'owner'` onto any row in
-- that tenant directly, bypassing `transfer_ownership` and its
-- promote-and-demote in one transaction — and leaving the organisation with
-- two owners, which that function exists to prevent.
--
-- The audit called this "defensible if intended". Taking the decision: a
-- support session may act as an owner, and may NOT create one. Acting on
-- somebody's behalf is a different thing from granting somebody else the
-- authority you are borrowing, and the second is what an ownership transfer
-- is for. The check reads `memberships` directly, so it cannot be satisfied by
-- the support session that is being constrained.
--
-- `transfer_ownership` and `accept_invite` are both SECURITY DEFINER
-- (confirmed: `prosecdef = t`), so they bypass RLS and are unaffected. The
-- legitimate ways to become an owner all still work; only the direct write
-- goes.
--
-- ## Rollback
--
-- Re-issue `reply_to_support_case` from `0145` and `memberships_write` from
-- its original migration.
-- =====================================================================

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

  -- Audited, like every other write on a case. `open_support_case`,
  -- `set_support_case_status` and `assign_support_case` all call `audit_write`;
  -- this one never did, so what a customer was told, and every internal note
  -- written about a tenant, left no trace at all (0145).
  --
  -- Visibility follows the message: a public reply is part of the customer's
  -- own record and is visible to both sides, an internal note is platform-only.
  perform public.audit_write(
    c.org_id,
    case when p_internal then 'support_case.note' else 'support_case.replied' end,
    'support_case',
    p_case,
    jsonb_build_object('reference', c.reference, 'internal', p_internal),
    'info',
    case when p_internal then 'platform_only' else 'both' end);

  -- Tell the requester there is something to read (0146, GAP-104).
  --
  -- Through `notification_outbox`, which a pg_cron job has drained every
  -- minute since 0069 — so this needs no Edge Function deployed and no new
  -- secret, the same path 0132 put platform announcements on.
  --
  -- Only a PUBLIC reply, and only from the platform side: an internal note is
  -- not addressed to anybody outside, and a customer replying to their own
  -- case does not need telling about it. `org_id` is NOT NULL on the outbox
  -- and a case raised by a prospect has none, so that case is skipped rather
  -- than forced — it has no in-app recipient either way.
  if not p_internal
     and v_side = 'platform'
     and c.org_id is not null
     and c.requester_id is not null then
    insert into public.notification_outbox (org_id, event_name, payload)
    values (
      c.org_id,
      'support/replied',
      jsonb_build_object(
        'orgId',   c.org_id,
        'userIds', to_jsonb(array[c.requester_id]),
        -- `send-notification` has no mapping for this type, and its own
        -- comment says an unmapped type falls through to everything-allowed
        -- rather than being dropped: "refusing to send something an owner
        -- never had the chance to configure would be a worse failure".
        'type',    'support',
        'title',   'Reply on ' || c.reference,
        'body',    left(btrim(p_body), 240)
      )
    );
  end if;

  return v_msg;
end;
$$;

revoke all on function public.reply_to_support_case(uuid, text, boolean) from public, anon;
grant execute on function public.reply_to_support_case(uuid, text, boolean) to authenticated;

-- ---------- GAP-105: act as an owner, do not create one ----------------

-- The check must read `memberships` without re-entering `memberships`'s own
-- policy. Writing the subquery inline raises
-- `42P17 infinite recursion detected in policy for relation "memberships"`,
-- which is a broken policy rather than a refusal — it was written that way
-- first and the repro caught it. A SECURITY DEFINER function reads past RLS
-- and breaks the cycle, which is the same reason `is_org_member` and
-- `has_org_role` are definers.
create or replace function public.is_direct_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role = 'owner'
  );
$$;

revoke all on function public.is_direct_org_owner(uuid) from public, anon;
grant execute on function public.is_direct_org_owner(uuid) to authenticated;

comment on function public.is_direct_org_owner(uuid) is
  'Owner by real membership, deliberately WITHOUT has_org_role''s support-access branch. Used where a support session must not be able to satisfy the guard that constrains it (0146).';

drop policy if exists memberships_write on public.memberships;

create policy memberships_write on public.memberships
  for all
  using (public.has_org_role(org_id, array['owner']))
  with check (
    public.has_org_role(org_id, array['owner'])
    and (role <> 'owner' or public.is_direct_org_owner(org_id))
  );

comment on policy memberships_write on public.memberships is
  'An organisation owner manages memberships. Creating another OWNER additionally requires being a real owner by membership, not one by support access — a support session may act as an owner and may not create one, which is what transfer_ownership is for (0146).';
