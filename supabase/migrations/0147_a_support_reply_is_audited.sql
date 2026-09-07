-- =====================================================================
-- 0147_a_support_reply_is_audited.sql
--
-- `reply_to_support_case` wrote a message row and nothing else. Every other
-- write on a case audits: `open_support_case` (`0024`),
-- `set_support_case_status` (`0024`) and `assign_support_case` (`0034`). This
-- one never has, so what a customer was told by platform staff, and every
-- internal note written about a tenant, left no trace in the audit log.
--
-- That is the half of the support trail that matters most in a complaint: the
-- record shows a case was opened, moved and closed, and says nothing about what
-- anybody actually said.
--
-- Visibility follows the message rather than being fixed. A public reply is
-- part of the customer's own record (`both`); an internal note is
-- `platform_only`, which is the same line `support_case_messages_select`
-- already draws.
--
-- ## Not in this migration
--
-- Nothing notifies the requester of a reply. The tenant-visible thread on
-- `/app/help` is the only delivery, and the console's toast says "Reply sent."
-- The toast is corrected in this commit; the delivery is NOT built here and is
-- recorded as a gap. It is reachable without deploying an Edge Function —
-- `notification_outbox` is drained every minute by an existing `pg_cron` job,
-- so an insert here would ride the same path `0132` uses for announcements —
-- but a delivery whose last mile cannot be watched from this machine is a
-- capability to build deliberately, not a line to slip into an audit fix.
--
-- ## Rollback
--
-- Re-issue the function from `0139`, which is the last migration to rewrite it.
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
  -- written about a tenant, left no trace at all (0147).
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

  return v_msg;
end;
$$;

revoke all on function public.reply_to_support_case(uuid, text, boolean) from public, anon;
grant execute on function public.reply_to_support_case(uuid, text, boolean) to authenticated;

comment on function public.reply_to_support_case(uuid, text, boolean) is
  'Posts a reply or an internal note onto a case, and audits it (0147). Operational platform staff write as the platform side; the requester and the organisation owner write as the customer (0138).';
