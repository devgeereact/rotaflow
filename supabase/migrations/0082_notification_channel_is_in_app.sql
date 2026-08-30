-- =====================================================================
-- 0082_notification_channel_is_in_app.sql — the notifications table can
-- finally say what kind of record it holds (docs/SAAS.md BUG-049)
--
-- `send-notification` inserts one `notifications` row per recipient and
-- sets `channel = 'push'` on every one of them. Its own comment, three
-- lines above, says what the row actually is:
--
--     "Row per recipient. Skipped entirely when the org has switched the
--      IN-APP channel off for this event."
--
-- So the row is the in-app notification — the bell — and it has always
-- been labelled a push. Two things were wrong, not one:
--
--   1. the value is a constant, so the column records nothing; and
--   2. the CHECK was `('push','email','sms')`, so there was no value it
--      COULD have been set to. The column could not express the only
--      kind of row that has ever been written to this table.
--
-- ## What this column means now
--
-- What KIND of record this is, not how it was delivered. Per-channel
-- delivery outcomes already have a home: `notification_deliveries`
-- (0067) writes one row per recipient per channel and records why a send
-- was skipped. `notifications` is the inbox. Asking it "how was this
-- delivered" was a category error, which is why the answer was a
-- constant.
--
-- 'sms' stays in the CHECK. 0002 reserved it deliberately and nothing
-- has changed about that.
--
-- ## The backfill IS right here, which is not always true
--
-- 0079 deliberately did NOT rewrite historical health samples, because
-- those were observations and editing them to look better is a habit not
-- to start. This is the opposite case: every existing row came from the
-- single writer above, which wrote a constant, and every one is an
-- in-app row. Correcting a known-wrong constant is not rewriting
-- history — leaving it would assert these were pushes, which is false
-- and would mislead the first person who ever queries this column.
--
-- Scoped `where channel = 'push'` rather than blanket, so it touches
-- only the mislabelled rows and could not affect a genuine future push.
-- Production holds zero notifications rows today, so this is a no-op
-- there and matters for every other environment.
--
-- MIGRATION RISK. One CHECK widened — strictly more permissive, nothing
-- valid becomes invalid — and a scoped UPDATE. No client reads this
-- column (`notificationService` selects rows and writes `read_at`;
-- nothing filters on channel), so no screen changes.
-- =====================================================================

alter table public.notifications
  drop constraint if exists notifications_channel_check;

alter table public.notifications
  add constraint notifications_channel_check
  check (channel in ('in_app', 'push', 'email', 'sms'));

comment on column public.notifications.channel is
  'What kind of record this is. Always in_app today: this table IS the bell, and a row exists only when the organisation permits the in-app channel for the event. How a notification fared on push or email lives in notification_deliveries (0067), one row per recipient per channel. push/email/sms remain valid so a future writer can use this table for something else without a migration.';

-- Every existing row is an in-app notification mislabelled by a constant.
update public.notifications
   set channel = 'in_app'
 where channel = 'push';
