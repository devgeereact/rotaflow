-- =====================================================================
-- 0108_notification_templates.sql — an email that reads like a message
-- rather than a database row (docs/SAAS.md CAP-033)
--
-- Every email this product sends is `subject: title, text: body ?? title`.
-- So a staff member's inbox gets "Rota published" with a body of "Rota
-- published", from an address they have never seen, with no organisation
-- name, no explanation and nothing to click. It is indistinguishable
-- from spam, and the one channel that reaches somebody who is not
-- currently in the app is the one that reads worst.
--
-- ## Templates in the database, not in the Edge Function
--
-- `supabase/functions/**` does not deploy on merge — it is a manual step
-- that this repository has repeatedly recorded as its most common source
-- of drift. Copy sitting in a function is copy nobody can fix without a
-- deploy. Here, an organisation's own wording is a row: it changes
-- without shipping anything, and the function stays a delivery mechanism
-- rather than a content one.
--
-- ## Absence means today's behaviour, exactly
--
-- `render_notification` returns NULL when no template matches, and the
-- function falls back to the subject-equals-title behaviour it has now.
-- That is deliberate: the notification path was silently broken for a
-- month (`0091`), and a change to it that could fail closed would be a
-- poor trade for nicer wording.
--
-- ## Placeholders are substituted, never evaluated
--
-- `{{org_name}}` is replaced by a value from a jsonb argument, with
-- `replace()`. There is no expression language, because a template
-- language inside an email that anybody in an organisation can edit is a
-- server-side injection surface for the sake of formatting a date.
-- Unknown placeholders are left standing rather than blanked: a visible
-- `{{staff_name}}` in a test send is a bug somebody fixes, and an empty
-- gap is one nobody notices.
-- =====================================================================

create table if not exists public.notification_templates (
  id         uuid primary key default gen_random_uuid(),
  -- NULL is the platform default, which every organisation inherits until
  -- it writes its own. One table rather than two, because a lookup that
  -- falls back has to see both in one query.
  org_id     uuid references public.organisations(id) on delete cascade,
  -- Matches the `type` in a `notification_outbox` payload, which is what
  -- reaches the Edge Function: 'leave', 'swap', 'announcement',
  -- 'attendance', 'document' (0087, 0093). Checked against the live values
  -- rather than invented — an earlier draft of this file guessed
  -- 'rota_published' and would have matched nothing at all.
  key        text not null,
  channel    text not null default 'email' check (channel in ('email', 'push')),
  subject    text not null,
  body       text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.notification_templates is
  'What a notification says, per organisation, with a platform default. A row rather than code, because Edge Functions do not deploy on merge (CAP-033).';

create unique index if not exists notification_templates_org_key_idx
  on public.notification_templates (org_id, key, channel);

-- One platform default per key/channel. A partial unique index rather than a
-- constraint, because NULL org_id is not unique to Postgres otherwise, and two
-- competing defaults would make the fallback arbitrary.
create unique index if not exists notification_templates_default_key_idx
  on public.notification_templates (key, channel) where org_id is null;

alter table public.notification_templates enable row level security;

-- An organisation reads its own and the platform defaults it inherits.
drop policy if exists notification_templates_select on public.notification_templates;
create policy notification_templates_select
  on public.notification_templates for select
  using (org_id is null or public.is_org_member(org_id));

-- Only an owner or manager writes, and only their own organisation's — the
-- `org_id is null` defaults are the platform's and are not editable from a
-- tenant.
drop policy if exists notification_templates_write on public.notification_templates;
create policy notification_templates_write
  on public.notification_templates for all
  using (org_id is not null and public.has_org_role(org_id, array['owner', 'manager']))
  with check (org_id is not null and public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.notification_templates from anon, authenticated;
grant select, insert, update, delete on public.notification_templates to authenticated;

drop trigger if exists notification_templates_set_updated_at on public.notification_templates;
create trigger notification_templates_set_updated_at
  before update on public.notification_templates
  for each row execute function public.set_updated_at();

-- ── the platform defaults ─────────────────────────────────────────────
--
-- Written as prose somebody would actually send. Each says which
-- organisation it is from in the subject, because a person may work for two
-- and an inbox sorts by subject.
insert into public.notification_templates (org_id, key, channel, subject, body)
values
  (null, 'leave', 'email',
   '{{org_name}}: {{title}}',
   'Hello {{staff_name}},

{{title}}{{body_line}}

See your rota and leave in RotaFlow: {{app_url}}

This message was sent automatically. Replying to it will not reach your manager.'),
  (null, 'swap', 'email',
   '{{org_name}}: {{title}}',
   'Hello {{staff_name}},

{{title}}{{body_line}}

Your rota in RotaFlow shows what you are working now: {{app_url}}

This message was sent automatically. Replying to it will not reach your manager.'),
  (null, 'announcement', 'email',
   '{{org_name}}: {{title}}',
   'Hello {{staff_name}},

{{body}}

{{app_url}}

This message was sent automatically. Replying to it will not reach whoever wrote it.'),
  (null, 'attendance', 'email',
   '{{org_name}}: {{title}}',
   'Hello {{staff_name}},

{{title}}{{body_line}}

If you did work that shift, tell your manager so the record can be corrected: {{app_url}}'),
  (null, 'document', 'email',
   '{{org_name}}: {{title}}',
   'Hello {{staff_name}},

{{title}}{{body_line}}

You can see what is expiring in RotaFlow: {{app_url}}')
on conflict do nothing;

-- ── rendering ─────────────────────────────────────────────────────────
--
-- Returns NULL when there is no template, so the caller keeps the behaviour
-- it has today rather than sending an empty message.
create or replace function public.render_notification(
  p_org  uuid,
  p_key  text,
  p_vars jsonb default '{}'::jsonb,
  p_channel text default 'email'
)
returns table (subject text, body text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body    text;
  v_key     text;
  v_value   text;
begin
  -- The organisation's own wording wins; the platform default is the
  -- fallback. `order by org_id nulls last` is the whole of that rule.
  select t.subject, t.body into v_subject, v_body
    from public.notification_templates t
   where t.key = p_key
     and t.channel = p_channel
     and (t.org_id = p_org or t.org_id is null)
   order by t.org_id nulls last
   limit 1;

  if v_subject is null then
    return;
  end if;

  -- Substitution, not evaluation, and done in TWO passes.
  --
  -- One pass is not enough: substituting key by key over an accumulating
  -- string means a value that itself contains `{{title}}` gets expanded by a
  -- later iteration, so a leave note could rewrite the email around it. Which
  -- keys that affects would depend on `jsonb_each`'s ordering, which is not
  -- something a security property should rest on.
  --
  -- So every placeholder is first swapped for a sentinel, and only then are
  -- the sentinels swapped for values. Nothing inserted in the second pass is
  -- ever looked at again.
  for v_key in select key from jsonb_each(coalesce(p_vars, '{}'::jsonb))
  loop
    v_subject := replace(v_subject, '{{' || v_key || '}}', chr(1) || v_key || chr(2));
    v_body    := replace(v_body,    '{{' || v_key || '}}', chr(1) || v_key || chr(2));
  end loop;

  for v_key, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_vars, '{}'::jsonb))
  loop
    v_subject := replace(v_subject, chr(1) || v_key || chr(2), coalesce(v_value, ''));
    v_body    := replace(v_body,    chr(1) || v_key || chr(2), coalesce(v_value, ''));
  end loop;

  -- An unknown placeholder is left standing: a visible {{staff_name}} in a
  -- test send is a bug somebody fixes, an empty gap is one nobody notices.

  return query select v_subject, v_body;
end;
$$;

comment on function public.render_notification(uuid, text, jsonb, text) is
  'An organisation''s wording for a notification, falling back to the platform default, with {{placeholders}} substituted. NULL when there is no template, so the caller keeps its current behaviour (CAP-033).';

revoke all on function public.render_notification(uuid, text, jsonb, text) from public, anon;
grant execute on function public.render_notification(uuid, text, jsonb, text) to authenticated, service_role;
