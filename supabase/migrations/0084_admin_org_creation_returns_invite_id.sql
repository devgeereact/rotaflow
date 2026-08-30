-- =====================================================================
-- 0084_admin_org_creation_returns_invite_id.sql — the sales-led signup
-- can email its owner invite (docs/SAAS.md GAP-005)
--
-- `send-invite` shipped in 0058 and two of the three invite paths were
-- wired to it. The two that were not are both the SALES-LED ones, which
-- is the worst place to leave a manual step:
--
--   * `/admin/organisations` → Create organisation, which calls
--     `admin_create_organisation_with_invite` for a brand-new customer;
--   * the same screen's owner re-invite.
--
-- In both, an administrator was told to copy a link and send it by hand
-- to somebody who has never seen the product and is waiting on us.
--
-- The re-invite needed no migration — it already had the invite id. This
-- one did not: the function returns `(org_id, invite_token,
-- invite_expires_at)`, and `send-invite` needs the invite's ID. That is
-- deliberate on its part, and worth keeping: it looks the invite up by
-- id and org, then verifies the raw token against the stored sha256, so
-- a caller can neither redirect an invitation nor email a token that
-- does not open a live one. Relaxing that to a hash lookup would trade a
-- real guarantee for a column.
--
-- ## DROP and CREATE, not CREATE OR REPLACE
--
-- Adding a column to a `returns table` changes the return type, and
-- `create or replace function` cannot do that — it fails with
-- "cannot change return type of existing function". Same shape as the
-- mistake 0076 made with a view, caught there by CI.
--
-- Dropping a function drops its grants, so they are re-issued below.
--
-- MIGRATION RISK. The body is unchanged apart from the extra returned
-- column. Every existing caller selects by name from the result — the
-- generated client reads `org_id`, `invite_token`, `invite_expires_at`
-- — so an additional column is additive for them. The function is
-- platform-admin-only and is called from one screen.
-- =====================================================================

drop function if exists public.admin_create_organisation_with_invite(
  text, text, text, text, integer);

create function public.admin_create_organisation_with_invite(
  p_name          text,
  p_slug          text,
  p_plan          text,
  p_owner_email   text,
  p_price_pence   integer default null  -- null = use the plan's list price
) returns table (
  org_id            uuid,
  invite_id         uuid,
  invite_token      text,
  invite_expires_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_invite record;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can create an organisation this way'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.plans where code = p_plan) then
    raise exception 'Unknown plan: %', p_plan using errcode = '22023';
  end if;

  -- created_by is deliberately left null: on_org_created (0002) only fires
  -- `when (new.created_by is not null)`, so the trigger never runs and no
  -- membership row is inserted for this platform admin, not even transiently.
  -- Stronger than insert-then-delete, which would also collide with
  -- memberships_keep_one_owner (0047).
  insert into public.organisations (name, slug, plan, contact_email)
  values (p_name, p_slug, p_plan, p_owner_email)
  returning id into v_org_id;

  insert into public.subscriptions (org_id, plan, status, price_pence, started_at)
  values (v_org_id, p_plan, 'active', p_price_pence, timezone('utc', now()));

  perform public.audit_write(
    v_org_id,
    'organisation.created_by_admin',
    'organisation', v_org_id,
    jsonb_build_object('plan', p_plan, 'price_pence', p_price_pence, 'owner_email', p_owner_email),
    'notice',
    'platform_only');

  select * into v_invite from public.create_invite(v_org_id, p_owner_email, 'owner');

  -- `invite_id` is the only addition. It exists so the caller can hand the
  -- invitation to `send-invite` instead of asking a human to copy a link.
  return query select v_org_id, v_invite.invite_id, v_invite.token, v_invite.expires_at;
end;
$$;

comment on function public.admin_create_organisation_with_invite(text, text, text, text, integer) is
  'Sales-led signup: creates an organisation with created_by = null, its subscription at the negotiated price, and the owner invite. Returns the invite id as well as the raw token (0084) so the caller can email it through send-invite rather than a person copying a link.';

revoke all on function public.admin_create_organisation_with_invite(text, text, text, text, integer)
  from public, anon;
grant execute on function public.admin_create_organisation_with_invite(text, text, text, text, integer)
  to authenticated;
