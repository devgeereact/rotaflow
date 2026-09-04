-- 0116_platform_writes_name_their_roles.sql
--
-- Three functions decided "may this person act at platform level?" with
-- `is_platform_admin()`, which is role-blind: it is true for all four platform
-- roles, including `platform_finance`, documented in src/lib/platformRoles.ts
-- as "Subscriptions and billing state only. No operational tenant data."
--
-- Everywhere else the pattern is `has_platform_role(array[...])` with the roles
-- written out — `set_org_status`, `grant_platform_role`, `set_gdpr_request_status`,
-- `request_support_access` all name them. These three did not, and two of them
-- change a tenant's state:
--
--   * delete_organisation        — destroys a tenant. It is granted to
--                                  `authenticated`, so the console's hidden
--                                  button is not the control; this check is.
--                                  With pitr_enabled false and an empty backup
--                                  list, the effect is permanent.
--   * connect_integration        — connects a payroll or rota connector on a
--                                  customer's behalf.
--   * set_org_integration_status — disconnects one.
--
-- One of the three is worse than the other two, and it is worth being precise
-- rather than alarming about it. `0073` set `available = false` on all eight
-- seeded connectors, so `connect_integration` currently refuses every call on
-- availability grounds before the role check is reached — and with no
-- `org_integrations` row ever created, `set_org_integration_status` has nothing
-- to act on either. Those two are latent: wrong, and unreachable until somebody
-- makes a connector available. **`delete_organisation` is not latent.** It is
-- reachable today by any of the four platform roles.
--
-- Support staff keep every read they had, and the tenant's own owner is
-- unaffected. What changes is that a finance- or support-role platform account
-- can no longer delete somebody's organisation or rewire their integrations.
--
-- Deliberately NOT changed here: `organisation_deletion_preview`, which is a
-- read. Support seeing how much data a deletion would remove is the whole point
-- of a preview, and the read posture across the platform console is a separate,
-- larger question — recorded as GAP-053 rather than half-answered in a
-- migration about writes.
--
-- No SAFETY declaration is needed: nothing is dropped, truncated or granted to
-- anon. Each function is replaced with an identical body and a narrower guard,
-- so the worst case of getting this wrong is a platform admin being refused,
-- not an unauthorised deletion.

-- ── delete_organisation ──────────────────────────────────────────────
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
  if not (public.has_org_role(p_org, array['owner'])
          or public.has_platform_role(array['platform_owner','platform_admin'])) then
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

-- ── connect_integration ──────────────────────────────────────────────
create or replace function public.connect_integration(
  p_org       uuid,
  p_connector text,
  p_ref       text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  c public.integration_connectors;
begin
  -- The tenant's own owner connects it. Platform staff can too, because
  -- setting a payroll connector up for a customer is a real support task.
  if not (public.has_org_role(p_org, array['owner'])
          or public.has_platform_role(array['platform_owner','platform_admin'])) then
    raise exception 'Only an organisation owner can connect an integration'
      using errcode = '42501';
  end if;

  select * into c from public.integration_connectors where key = p_connector;
  if not found then
    raise exception 'No connector called %', p_connector using errcode = 'P0002';
  end if;
  if not c.available then
    raise exception 'The % connector is not available for new connections', c.name
      using errcode = '22023';
  end if;

  insert into public.org_integrations (org_id, connector_key, credentials_ref, connected_by)
  values (p_org, p_connector, nullif(btrim(coalesce(p_ref,'')),''), auth.uid())
  on conflict (org_id, connector_key)
    do update set status = 'connected',
                  credentials_ref = coalesce(excluded.credentials_ref, org_integrations.credentials_ref),
                  last_error = null
  returning id into v_id;

  perform public.audit_write(
    p_org, 'integration.connected', 'org_integration', v_id,
    jsonb_build_object('connector', p_connector, 'after', 'connected'),
    'info', 'both');

  return v_id;
end;
$$;

-- ── set_org_integration_status ───────────────────────────────────────
create or replace function public.set_org_integration_status(
  p_org       uuid,
  p_connector text,
  p_status    text
) returns void language plpgsql security definer set search_path = public as $$
declare
  before_status text;
begin
  if not (public.has_org_role(p_org, array['owner'])
          or public.has_platform_role(array['platform_owner','platform_admin'])) then
    raise exception 'Only an organisation owner can change an integration'
      using errcode = '42501';
  end if;

  select status into before_status from public.org_integrations
   where org_id = p_org and connector_key = p_connector;
  if before_status is null then
    raise exception 'That organisation has no % connection', p_connector
      using errcode = 'P0002';
  end if;

  update public.org_integrations
     set status = p_status
   where org_id = p_org and connector_key = p_connector;

  perform public.audit_write(
    p_org, 'integration.' || p_status, 'org_integration', null,
    jsonb_build_object('connector', p_connector, 'before', before_status, 'after', p_status),
    case when p_status = 'error' then 'warning' else 'info' end,
    'both');
end;
$$;

-- Grants are unchanged and restated so a database rebuilt from this history
-- does not depend on the image's default ACL (GAP-038, migration 0113).
revoke all on function public.delete_organisation(uuid, text) from public, anon;
revoke all on function public.connect_integration(uuid, text, text) from public, anon;
revoke all on function public.set_org_integration_status(uuid, text, text) from public, anon;
grant execute on function public.delete_organisation(uuid, text) to authenticated;
grant execute on function public.connect_integration(uuid, text, text) to authenticated;
grant execute on function public.set_org_integration_status(uuid, text, text) to authenticated;
