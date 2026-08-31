-- =====================================================================
-- notification_templates.test.sql — CAP-033
--
-- Every email this product sends is `subject: title, text: body ?? title`,
-- so an inbox gets "Your leave request was approved" with a body of
-- "Your leave request was approved" — no organisation name, no
-- explanation, nothing to click, indistinguishable from spam.
--
--   1. a platform default renders;
--   2. placeholders are substituted;
--   3. an organisation's own wording BEATS the default. That fallback
--      order is the whole design;
--   4. an unknown key returns nothing, so the caller keeps the behaviour
--      it has today rather than sending an empty message;
--   5. an unknown placeholder is left standing rather than blanked — a
--      visible {{staff_name}} is a bug somebody fixes, an empty gap is
--      one nobody notices;
--   6. a value containing `{{…}}` is NOT re-substituted. Substitution
--      that recursed would let a leave note rewrite the email around it;
--   7. an organisation sees its own templates and the defaults;
--   8. and NOT another organisation's;
--   9. a staff member cannot write one — wording that goes to the whole
--      team is a managerial act;
--  10. nobody can edit the platform defaults from inside a tenant.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d5111111-1111-1111-1111-111111111111'::uuid, 'owner-tpl@example.test'),
  ('d5222222-2222-2222-2222-222222222222'::uuid, 'staff-tpl@example.test'),
  ('d5333333-3333-3333-3333-333333333333'::uuid, 'other-tpl@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('d5000000-0000-0000-0000-000000000001', 'Ward Trust', 'ward-trust',
   'd5111111-1111-1111-1111-111111111111', 'enterprise'),
  ('d5000000-0000-0000-0000-000000000002', 'Other Trust', 'other-trust',
   'd5333333-3333-3333-3333-333333333333', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('d5000000-0000-0000-0000-000000000001', 'd5222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

-- ── rendering ─────────────────────────────────────────────────────────

select is(
  (select subject from public.render_notification(
     'd5000000-0000-0000-0000-000000000001',
     'leave',
     jsonb_build_object('org_name', 'Ward Trust', 'title', 'Your leave was approved'))),
  'Ward Trust: Your leave was approved',
  'a platform default renders, with its placeholders substituted'
);

insert into public.notification_templates (org_id, key, channel, subject, body) values
  ('d5000000-0000-0000-0000-000000000001', 'leave', 'email',
   'Rota update from {{org_name}}', 'Hi {{staff_name}} — {{title}}');

select is(
  (select subject from public.render_notification(
     'd5000000-0000-0000-0000-000000000001',
     'leave',
     jsonb_build_object('org_name', 'Ward Trust'))),
  'Rota update from Ward Trust',
  'an organisation''s own wording beats the platform default'
);

select is(
  (select body from public.render_notification(
     'd5000000-0000-0000-0000-000000000001',
     'leave',
     jsonb_build_object('staff_name', 'Ada', 'title', 'approved'))),
  'Hi Ada — approved',
  'every placeholder given a value is substituted'
);

select is(
  (select count(*)::int from public.render_notification(
     'd5000000-0000-0000-0000-000000000001', 'no_such_key', '{}'::jsonb)),
  0,
  'an unknown key renders nothing, so the caller keeps its current behaviour'
);

select is(
  (select body from public.render_notification(
     'd5000000-0000-0000-0000-000000000001', 'leave', jsonb_build_object('title', 'x'))),
  'Hi {{staff_name}} — x',
  'an unknown placeholder is left standing rather than silently blanked'
);

-- A value that itself looks like a placeholder. Substitution that recursed
-- would let a leave note rewrite the email around it.
select is(
  (select body from public.render_notification(
     'd5000000-0000-0000-0000-000000000001',
     'leave',
     jsonb_build_object('staff_name', '{{title}}', 'title', 'approved'))),
  'Hi {{title}} — approved',
  'a value containing a placeholder is not re-substituted'
);

-- ── who sees and writes what ──────────────────────────────────────────

insert into public.notification_templates (org_id, key, channel, subject, body) values
  ('d5000000-0000-0000-0000-000000000002', 'leave', 'email',
   'Somebody else''s wording', 'Not for this tenant');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select ok(
  (select count(*) from public.notification_templates where org_id is null) > 0,
  'an organisation sees the platform defaults it inherits'
);

select is(
  (select count(*)::int from public.notification_templates
    where org_id = 'd5000000-0000-0000-0000-000000000002'),
  0,
  'and not another organisation''s wording'
);

select throws_ok(
  $$ insert into public.notification_templates (org_id, key, channel, subject, body)
     values ('d5000000-0000-0000-0000-000000000001', 'swap', 'email', 'x', 'y') $$,
  '42501',
  null,
  'a staff member cannot write wording that goes to the whole team'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- RLS makes this a silent no-op rather than an error, which is the correct
-- shape: the row is simply not visible to the write policy. So the assertion
-- is that nothing changed, not that something raised.
update public.notification_templates set subject = 'hijacked' where org_id is null;

select is(
  (select count(*)::int from public.notification_templates where subject = 'hijacked'),
  0,
  'and nobody edits the platform defaults from inside a tenant'
);

select * from finish();
rollback;
