-- =====================================================================
-- 0129 · An invitation records whether the email actually went
--
-- `sendInviteEmail` returns `{ sent, reason }` and the screen turns it
-- into a toast. That is the entire record. Reload the page and the
-- product can no longer tell an invitation whose email was delivered from
-- one whose SMTP server refused it — both are simply "pending", which is
-- what `listPendingInvites` calls anything unaccepted and unexpired.
--
-- That matters because the two need opposite actions. An invitation that
-- was delivered is waiting on the person; one that was never delivered is
-- waiting on the manager, who has no way of knowing. The setup checklist
-- this migration exists for cannot say "three invitations sent, one never
-- left the building" unless the building keeps a note.
--
-- ## Why the outcome is written by a function, not by the client
--
-- `0118` narrowed the client's UPDATE on `invites` to the `revoked_at`
-- column alone, deliberately, so that a manager cannot edit an
-- invitation's role or its expiry. A new column is therefore NOT covered
-- by that grant — writing to it from the client would fail with 42501 at
-- the screen that writes it, which is GAP-061 exactly. Rather than widen
-- the column grant (and hand a manager two more columns for one fact),
-- the outcome goes through a definer function that writes only these two.
--
-- ## Why "resend" is still revoke-and-reissue
--
-- Only a sha256 of the token is stored, so the link cannot be rebuilt.
-- Re-sending is minting a new invitation and revoking the old one, which
-- `create_invite` and the partial unique index already support. Nothing
-- here changes that, and nothing here can create a second membership: a
-- revoked invitation is not acceptable, and `accept_invite` is the only
-- thing that writes a membership.
--
-- SAFETY(create_function): two nullable columns and one SECURITY DEFINER
-- function that writes only those two, gated on the same owner/manager
-- check `create_invite` applies. No existing row changes, no privilege is
-- widened, and EXECUTE is revoked from `public` and `anon` per 0112.
-- =====================================================================

alter table public.invites
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_error text;

comment on column public.invites.last_sent_at is
  'When the join email was last accepted by the mail endpoint. Null means it has never been sent — which is a different state from "sent and unanswered" and needs the opposite action.';
comment on column public.invites.send_error is
  'Why the last send failed, in words a manager can act on ("no mailbox configured", "SMTP refused"). Null once a send succeeds. Written only by record_invite_send.';

create or replace function public.record_invite_send(
  p_invite uuid,
  p_sent   boolean,
  p_error  text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select org_id into v_org from public.invites where id = p_invite;
  if v_org is null then
    raise exception 'Invitation not found' using errcode = 'INV01';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the membership check is explicit —
  -- the same roles `create_invite` admits.
  if not public.has_org_role(v_org, array['owner','manager']) then
    raise exception 'Only owners and managers can send invitations'
      using errcode = '42501';
  end if;

  update public.invites
     set last_sent_at = case when p_sent then timezone('utc', now()) else last_sent_at end,
         -- Cleared on success. A stale failure sitting beside a delivered
         -- invitation would send a manager chasing a problem that is over.
         send_error   = case when p_sent then null else left(btrim(coalesce(p_error, 'The mail server did not accept it.')), 300) end
   where id = p_invite;
end;
$$;

comment on function public.record_invite_send(uuid, boolean, text) is
  'Record the outcome of an invitation email. The only writer of invites.last_sent_at and invites.send_error — 0118 narrowed the client UPDATE grant to revoked_at, so a direct write would 42501 at the screen.';

revoke all on function public.record_invite_send(uuid, boolean, text) from public, anon;
grant execute on function public.record_invite_send(uuid, boolean, text) to authenticated;
