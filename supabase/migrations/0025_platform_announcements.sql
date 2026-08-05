-- =====================================================================
-- 0025 — Platform announcements
--
-- `notifications` addresses one user inside one organisation, and `announcements`
-- (0002) is a tenant's own noticeboard. Neither can express "tell every
-- organisation on Business and above about Tuesday's maintenance window", which
-- is what the Notifications console screen has been showing with invented rows.
--
-- ## Why deliveries are rows
--
-- Sent and Read are the two numbers this screen exists for, and both are counts
-- over recipients. A counter column on the announcement would drift the first
-- time a fan-out half-failed, and could never answer "which organisations have
-- not seen it", which is the question that follows the number.
--
-- ## Why nothing here sends email
--
-- Fan-out writes delivery rows; turning those into email or push is an Edge
-- Function's job, because it needs the service role and a provider. The
-- `channel` column records what was intended, and `sent_at` on the delivery is
-- stamped by whatever actually sent it — so an unsent row is visibly unsent
-- rather than assumed delivered.
-- =====================================================================

create table if not exists public.platform_announcements (
  id            uuid primary key default gen_random_uuid(),

  title         text not null check (length(btrim(title)) > 0),
  body          text not null check (length(btrim(body)) > 0),

  kind          text not null default 'product'
                  check (kind in ('maintenance','incident','product','billing','policy')),

  -- Who it goes to, resolved into delivery rows at publish time. Kept as a
  -- description as well as rows so the register can say "Business, Enterprise"
  -- rather than "312 organisations".
  audience      text not null default 'all'
                  check (audience in ('all','plans','organisations')),
  audience_plans text[] not null default '{}',

  channel       text not null default 'in_app'
                  check (channel in ('in_app','email','both')),

  status        text not null default 'draft'
                  check (status in ('draft','scheduled','sent','cancelled')),

  scheduled_for timestamptz,
  sent_at       timestamptz,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now()),

  constraint announcement_scheduled_has_time
    check (status <> 'scheduled' or scheduled_for is not null),
  constraint announcement_sent_has_time
    check (status <> 'sent' or sent_at is not null),
  constraint announcement_plans_when_targeted
    check (audience <> 'plans' or array_length(audience_plans, 1) > 0)
);

comment on table public.platform_announcements is
  'Messages from the platform to its tenants. Sent and read counts are sums over platform_announcement_deliveries.';

create index if not exists platform_announcements_recent_idx
  on public.platform_announcements (coalesce(sent_at, scheduled_for, created_at) desc);

-- One row per recipient organisation. Not per user: a maintenance window is
-- addressed to a customer, and fanning it to every member would make "read"
-- mean "one of 248 people opened it".
create table if not exists public.platform_announcement_deliveries (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.platform_announcements(id) on delete cascade,
  org_id          uuid not null references public.organisations(id) on delete cascade,

  -- Stamped by whatever actually delivered it. Null means queued, and the
  -- console counts it as such rather than as sent.
  sent_at         timestamptz,
  read_at         timestamptz,
  read_by         uuid references public.profiles(id) on delete set null,

  -- Set when a provider rejected it. The Failed tile counts these.
  failed_at       timestamptz,
  failure_reason  text,

  created_at      timestamptz not null default timezone('utc', now()),

  unique (announcement_id, org_id)
);

comment on table public.platform_announcement_deliveries is
  'One recipient organisation. Unsent, read and failed are all visible states rather than assumptions.';

create index if not exists announcement_deliveries_org_idx
  on public.platform_announcement_deliveries (org_id, created_at desc);

create index if not exists announcement_deliveries_unread_idx
  on public.platform_announcement_deliveries (announcement_id)
  where read_at is null;

-- Organisations that have opted out of non-essential platform mail. Counted by
-- the Opt-outs tile, and honoured by the fan-out for everything except
-- maintenance and incident notices, which are operational rather than optional.
create table if not exists public.platform_announcement_optouts (
  org_id     uuid primary key references public.organisations(id) on delete cascade,
  opted_out_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists platform_announcements_set_updated_at on public.platform_announcements;
create trigger platform_announcements_set_updated_at
  before update on public.platform_announcements
  for each row execute function public.set_updated_at();

-- ---------- Compose -----------------------------------------------------
create or replace function public.create_platform_announcement(
  p_title    text,
  p_body     text,
  p_kind     text default 'product',
  p_audience text default 'all',
  p_plans    text[] default '{}',
  p_channel  text default 'in_app',
  p_scheduled_for timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can announce'
      using errcode = '42501';
  end if;

  insert into public.platform_announcements
    (title, body, kind, audience, audience_plans, channel, status, scheduled_for, created_by)
  values
    (btrim(p_title), btrim(p_body), p_kind, p_audience, coalesce(p_plans, '{}'), p_channel,
     case when p_scheduled_for is null then 'draft' else 'scheduled' end,
     p_scheduled_for, auth.uid())
  returning id into v_id;

  perform public.audit_write(
    null, 'announcement.created', 'platform_announcement', v_id,
    jsonb_build_object('title', btrim(p_title), 'after', p_audience),
    'info', 'platform_only');

  return v_id;
end;
$$;

revoke all on function public.create_platform_announcement(text, text, text, text, text[], text, timestamptz)
  from public, anon;
grant execute on function public.create_platform_announcement(text, text, text, text, text[], text, timestamptz)
  to authenticated;

-- ---------- Publish -----------------------------------------------------
-- Resolves the audience into delivery rows. Returns how many, so the caller
-- can say "sent to 96 organisations" from a count the database made rather
-- than one the client guessed.
create or replace function public.publish_platform_announcement(p_announcement uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a public.platform_announcements;
  v_count integer;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can publish an announcement'
      using errcode = '42501';
  end if;

  select * into a from public.platform_announcements where id = p_announcement;
  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  if a.status = 'sent' then
    raise exception 'That announcement has already been sent' using errcode = '22023';
  end if;

  insert into public.platform_announcement_deliveries (announcement_id, org_id, sent_at)
  select p_announcement, o.id, timezone('utc', now())
    from public.organisations o
   where o.status = 'active'
     and (a.audience = 'all' or (a.audience = 'plans' and o.plan = any (a.audience_plans)))
     -- An opt-out silences product and policy mail. It does not silence a
     -- maintenance window or an incident: those are things a customer needs
     -- whether or not they asked for marketing.
     and (a.kind in ('maintenance','incident')
          or not exists (select 1 from public.platform_announcement_optouts x
                          where x.org_id = o.id))
  on conflict (announcement_id, org_id) do nothing;

  get diagnostics v_count = row_count;

  update public.platform_announcements
     set status = 'sent', sent_at = timezone('utc', now())
   where id = p_announcement;

  perform public.audit_write(
    null, 'announcement.sent', 'platform_announcement', p_announcement,
    jsonb_build_object('title', a.title, 'before', a.status, 'after', v_count || ' organisations'),
    'notice', 'platform_only');

  return v_count;
end;
$$;

revoke all on function public.publish_platform_announcement(uuid) from public, anon;
grant execute on function public.publish_platform_announcement(uuid) to authenticated;

-- ---------- Mark read ----------------------------------------------------
create or replace function public.mark_announcement_read(p_announcement uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.platform_announcement_deliveries d
     set read_at = coalesce(read_at, timezone('utc', now())),
         read_by = coalesce(read_by, auth.uid())
   where d.announcement_id = p_announcement
     and public.is_org_member(d.org_id);
end;
$$;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.platform_announcements            enable row level security;
alter table public.platform_announcement_deliveries  enable row level security;
alter table public.platform_announcement_optouts     enable row level security;

-- A tenant reads an announcement once it has been sent to them, and never
-- reads a draft. Platform staff read everything, including the drafts.
drop policy if exists platform_announcements_select on public.platform_announcements;
create policy platform_announcements_select
  on public.platform_announcements for select
  using (
    public.is_platform_admin()
    or (status = 'sent' and exists (
          select 1 from public.platform_announcement_deliveries d
           where d.announcement_id = id and public.is_org_member(d.org_id)))
  );

drop policy if exists announcement_deliveries_select on public.platform_announcement_deliveries;
create policy announcement_deliveries_select
  on public.platform_announcement_deliveries for select
  using (public.is_platform_admin() or public.is_org_member(org_id));

drop policy if exists announcement_optouts_select on public.platform_announcement_optouts;
create policy announcement_optouts_select
  on public.platform_announcement_optouts for select
  using (public.is_platform_admin() or public.is_org_member(org_id));

-- An owner switches their own organisation's opt-out. This is the one write in
-- this migration a customer performs, so it is a policy rather than a function.
drop policy if exists announcement_optouts_insert on public.platform_announcement_optouts;
create policy announcement_optouts_insert
  on public.platform_announcement_optouts for insert
  with check (public.has_org_role(org_id, array['owner']));

drop policy if exists announcement_optouts_delete on public.platform_announcement_optouts;
create policy announcement_optouts_delete
  on public.platform_announcement_optouts for delete
  using (public.has_org_role(org_id, array['owner']));

revoke insert, update, delete on public.platform_announcements           from anon, authenticated;
revoke insert, update, delete on public.platform_announcement_deliveries from anon, authenticated;
revoke update on public.platform_announcement_optouts                    from anon, authenticated;
