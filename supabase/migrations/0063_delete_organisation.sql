-- =====================================================================
-- 0063_delete_organisation.sql — an organisation can be deleted.
--
-- BUG-009: nothing in RotaFlow could delete a tenant. No UI, no admin
-- console action, no RPC. That is not a missing button — it makes GDPR
-- erasure impossible, and it means every QA run's throwaway organisation
-- stays in production for good.
--
-- The reason it was impossible is worth stating, because the obvious fix
-- is the wrong one. `delete from organisations` cascades into 32 tables,
-- and four of those cascades fire audit triggers that INSERT an
-- `audit_logs` row referencing the organisation being deleted — which
-- fails on `audit_logs_org_id_fkey`. A fifth, `memberships_keep_one_owner`
-- (0047), refuses to remove the last owner and has no exemption for "the
-- organisation is going away too". Confirmed against production on
-- 2026-08-14 and 2026-08-23; the second failure only surfaced once the
-- first was worked around.
--
-- The workaround people reach for is `alter table … disable trigger`
-- around the delete. This migration deliberately does not do that, for
-- two reasons: disabling a trigger is global, so for the length of the
-- statement every OTHER tenant's audit trail is unprotected too; and it
-- has already been got wrong here once — a script disabled
-- `audit_logs_no_update` and never re-enabled it, leaving the append-only
-- guard off on the live table until an independent check caught it.
--
-- Instead the guards learn about deletion. `delete_organisation` sets a
-- transaction-local `rotaflow.org_deleting` to the id it is removing;
-- `audit_write` and `memberships_keep_one_owner` stand down for THAT
-- organisation only, for the length of that transaction, and remain fully
-- armed for every other tenant and every other statement.
--
-- What survives, on purpose:
--   * `audit_logs`   — org_id is ON DELETE SET NULL (0016) and the row
--                      carries an `org_name` snapshot, because an audit
--                      trail a tenant deletion erases is not an audit
--                      trail. The deletion event itself is written before
--                      the delete so it survives the same way.
--   * `gdpr_requests`, `support_cases` — same treatment, same reason.
-- Everything else org-scoped goes.
-- =====================================================================

-- ── 1. Teach audit_write about deletion ──────────────────────────────
-- Every one of the four cascade-triggered audit writes goes through this
-- function, so exempting it here covers all of them at once and leaves
-- their trigger bodies untouched. Identical to 0016's version but for the
-- guard clause.
create or replace function public.audit_write(
  p_org         uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb,
  p_severity    text,
  p_visibility  text default 'org'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email    text;
  v_name     text;
  v_org_name text;
begin
  -- The organisation this event belongs to is being deleted in this very
  -- transaction. Writing the row would violate audit_logs_org_id_fkey the
  -- moment the parent goes, and the event has nowhere meaningful to live:
  -- "a rota was deleted" as part of deleting the whole tenant is noise.
  -- The single event that matters, `org.deleted`, is written by
  -- delete_organisation() before the flag is set.
  if p_org is not null
     and p_org::text = coalesce(current_setting('rotaflow.org_deleting', true), '')
  then
    return;
  end if;

  select p.email, p.full_name into v_email, v_name
    from public.profiles p where p.id = auth.uid();
  select o.name into v_org_name
    from public.organisations o where o.id = p_org;

  insert into public.audit_logs (
    org_id, org_name, actor_user_id, actor_email, actor_name,
    action, entity_type, entity_id, metadata, severity, scope, visibility)
  values (
    p_org, v_org_name, auth.uid(), v_email, v_name,
    p_action, p_entity_type, p_entity_id,
    -- A trigger fired by an Edge Function running as service_role has no
    -- auth.uid(). An event with no actor must say why rather than looking
    -- like an anonymous user action.
    coalesce(p_metadata, '{}'::jsonb)
      || case when auth.uid() is null
              then jsonb_build_object('via', 'service_role')
              else '{}'::jsonb end,
    p_severity,
    case when p_org is null then 'platform' else 'org' end,
    p_visibility);
end;
$$;

revoke all on function public.audit_write(uuid, text, text, uuid, jsonb, text, text)
  from public, anon, authenticated;

-- ── 2. Teach the last-owner guard about deletion ─────────────────────
-- 0047 exists so an organisation cannot be left ownerless by a mistaken
-- click. Deleting the organisation is not that mistake: there is no
-- organisation left to be ownerless.
create or replace function public.memberships_keep_one_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  remaining_owners integer;
  v_org            uuid;
begin
  -- OLD is present for both operations this trigger fires on; NEW is not
  -- readable at all in a DELETE, so it is never touched here.
  v_org := old.org_id;

  if v_org::text = coalesce(current_setting('rotaflow.org_deleting', true), '') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
    select count(*) into remaining_owners
      from public.memberships
      where org_id = old.org_id and role = 'owner' and id <> old.id;
  else -- UPDATE
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
    select count(*) into remaining_owners
      from public.memberships
      where org_id = old.org_id and role = 'owner' and id <> old.id;
  end if;

  if remaining_owners = 0 then
    raise exception 'an organisation must keep at least one owner'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

-- ── 3. What a deletion removes, countable beforehand ─────────────────
-- Shown in the confirmation dialog. A tenant deletion is irreversible and
-- there are no backups on this project, so the owner is told the size of
-- what they are about to destroy in the same breath as being asked to
-- confirm it.
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
) language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.staff_profiles where org_id = p_org),
    (select count(*) from public.locations      where org_id = p_org),
    (select count(*) from public.rotas          where org_id = p_org),
    (select count(*) from public.shifts         where org_id = p_org),
    (select count(*) from public.clock_events   where org_id = p_org),
    (select count(*) from public.leave_requests where org_id = p_org),
    (select count(*) from public.documents      where org_id = p_org),
    (select count(*) from public.memberships    where org_id = p_org)
  where public.has_org_role(p_org, array['owner']) or public.is_platform_admin();
$$;

-- ── 4. The deletion itself ───────────────────────────────────────────
create or replace function public.delete_organisation(
  p_org          uuid,
  p_confirm_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    public.organisations;
  v_counts record;
begin
  select * into v_org from public.organisations where id = p_org;
  if not found then
    raise exception using errcode = 'ORG01', message = 'Organisation not found.';
  end if;

  -- An owner of this organisation, or a platform administrator. Deliberately
  -- not a manager: this is the one action in the product with no undo.
  if not (public.has_org_role(p_org, array['owner']) or public.is_platform_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Only an owner of this organisation, or a platform administrator, can delete it.';
  end if;

  -- Typing the name is the confirmation. Compared exactly rather than
  -- case-insensitively: the point is that the person has read what they are
  -- deleting, and "close enough" defeats it.
  if p_confirm_name is distinct from v_org.name then
    raise exception using
      errcode = 'ORG02',
      message = 'The name you typed does not match this organisation.';
  end if;

  select * into v_counts from public.organisation_deletion_preview(p_org);

  -- Written BEFORE the delete, so it is a real row by the time the cascade
  -- sets its org_id to null and leaves it standing with the org_name
  -- snapshot. Written before the flag is set, or audit_write would skip it
  -- along with the cascade noise. platform_only: the organisation it
  -- concerns no longer exists to read it.
  perform public.audit_write(
    p_org, 'org.deleted', 'organisation', p_org,
    jsonb_build_object(
      'name',           v_org.name,
      'slug',           v_org.slug,
      'plan',           v_org.plan,
      'status',         v_org.status,
      'created_at',     v_org.created_at,
      'by_platform_admin', not public.has_org_role(p_org, array['owner']),
      'removed',        to_jsonb(v_counts)),
    'critical', 'platform_only');

  perform set_config('rotaflow.org_deleting', p_org::text, true);
  delete from public.organisations where id = p_org;
  perform set_config('rotaflow.org_deleting', '', true);
end;
$$;

revoke all on function public.organisation_deletion_preview(uuid) from public, anon;
revoke all on function public.delete_organisation(uuid, text)     from public, anon;
grant execute on function public.organisation_deletion_preview(uuid) to authenticated;
grant execute on function public.delete_organisation(uuid, text)     to authenticated;
