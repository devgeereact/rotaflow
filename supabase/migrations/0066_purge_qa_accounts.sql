-- 0066: remove the QA/smoke accounts and the test organisations they own.
--
-- Every organisation in this database was a QA fixture. Six accounts created by
-- past QA and smoke runs owned or joined them, all on `+alias` addresses of the
-- operator's personal inbox. The owner asked for all six gone, leaving
-- gakinz101@gmail.com as the sole account and sole platform administrator.
--
-- Deleting them by hand fails, and it is worth recording exactly why, because
-- both blockers are invisible until you try:
--
--   1. auth.users -> profiles (cascade) -> memberships (cascade) fires
--      memberships_keep_one_owner, and four of these accounts are the ONLY
--      owner of their organisation. "an organisation must keep at least one
--      owner" (23514).
--   2. profiles -> audit_logs.actor_user_id is ON DELETE SET NULL, which is an
--      UPDATE on an append-only table. audit_logs_immutable exempts exactly one
--      shape of update -- org_id going null during an organisation delete -- and
--      an actor going null is not it. "audit_logs is append-only" (42501).
--
-- So the organisations go first (under the rotaflow.org_deleting flag the
-- guards already respect, added in 0063), and the trigger's carve-out is
-- widened to cover the actor case before the accounts are removed.

-- ---------------------------------------------------------------------------
-- 1. Let an audit row survive its actor being deleted.
-- ---------------------------------------------------------------------------
-- Generalises the existing exemption rather than adding a second branch: an
-- update is allowed when every column other than org_id and actor_user_id is
-- untouched, and each of those two is either unchanged or going from a value to
-- null. That is the FK's own behaviour and nothing else -- a row still cannot be
-- edited, re-pointed at a different actor, or deleted.
--
-- This is what makes account deletion possible at all, which GDPR erasure needs
-- independently of this cleanup. The audit row stays; only the link to a person
-- who no longer exists is severed. actor_email and actor_name are deliberately
-- still frozen: this widens who can be unlinked, not what can be rewritten.
create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE'
     and (new.org_id        is not distinct from old.org_id
          or (old.org_id        is not null and new.org_id        is null))
     and (new.actor_user_id is not distinct from old.actor_user_id
          or (old.actor_user_id is not null and new.actor_user_id is null))
     and (new.org_id is distinct from old.org_id
          or new.actor_user_id is distinct from old.actor_user_id)
     and new.id            is not distinct from old.id
     and new.org_name      is not distinct from old.org_name
     and new.actor_email   is not distinct from old.actor_email
     and new.actor_name    is not distinct from old.actor_name
     and new.action        is not distinct from old.action
     and new.entity_type   is not distinct from old.entity_type
     and new.entity_id     is not distinct from old.entity_id
     and new.metadata      is not distinct from old.metadata
     and new.severity      is not distinct from old.severity
     and new.scope         is not distinct from old.scope
     and new.visibility    is not distinct from old.visibility
     and new.created_at    is not distinct from old.created_at then
    return new;
  end if;

  raise exception 'audit_logs is append-only (attempted %)', tg_op
    using errcode = '42501';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Delete the QA organisations.
-- ---------------------------------------------------------------------------
-- Matched on the `QA RotaFlow Test Organisation %` name prefix rather than on
-- hardcoded ids. public.delete_organisation is deliberately NOT called: it gates
-- on has_org_role/is_platform_admin, and auth.uid() is null inside a migration,
-- so it would raise 42501. Its flag protocol is reproduced instead.
do $$
declare
  v_org record;
begin
  for v_org in
    select id, name from public.organisations
     where name like 'QA RotaFlow Test Organisation %'
  loop
    perform set_config('rotaflow.org_deleting', v_org.id::text, true);
    delete from public.organisations where id = v_org.id;
    perform set_config('rotaflow.org_deleting', '', true);
    raise notice 'deleted organisation %', v_org.name;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Delete the QA accounts.
-- ---------------------------------------------------------------------------
-- Listed explicitly rather than "everything except the owner": an inverted match
-- would delete any account added between this being written and applied.
-- platform_admins.user_id is ON DELETE CASCADE, so removing dev@rotaflow.space
-- also drops its administrator grant, leaving gakinz101@gmail.com as the only
-- one -- which is the stated intent, not a side effect.
delete from auth.users
 where email in (
   'scriptural.os+rfqa20260823174723@gmail.com',
   'scriptural.os+rfqastaff2b20260823174723@gmail.com',
   'scriptural.os+rfqb20260823191939@gmail.com',
   'scriptural.os+rfsmoke20260820112426@gmail.com',
   'scriptural.os+rfsmokestaff20260820112426@gmail.com',
   'dev@rotaflow.space'
 );
