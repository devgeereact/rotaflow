-- =====================================================================
-- 0163_a_person_keeps_their_own_time_and_week_preferences.sql: three
-- personal preferences on My account, Preferences (docs/UX-SPEC.md,
-- profile-prefs)
--
-- ## What was wrong
--
-- The Preferences reference shows a clock format, a first day of the week
-- and a digest frequency. None was stored anywhere, so the screen could not
-- offer them honestly and stayed "not matched" (GAP-088). The owner decided
-- on 2026-10-22 to store these three and no more.
--
-- ## What this does
--
-- Adds three columns to `app_settings` (0001), the table that is already
-- one row per user and already guarded by `app_settings_all_own`
-- (`auth.uid() = user_id`). No new table, no new policy and no grant change:
-- the table-level grants from 0056 cover added columns, `anon` holds nothing
-- here since 0075, and the row is deleted with the profile.
--
--   * `time_format`: '24h' (default, the product's en-GB convention) or '12h'.
--     `src/lib/format.ts` reads it.
--   * `week_start`: 'monday' (default, matching the rota builder) or 'sunday'.
--     Read by the personal schedule (My rota) only. Rota weeks themselves stay
--     Monday-keyed: a rota is stored per Monday, and a per-person week start
--     there would change which rota a week belongs to.
--   * `digest_frequency`: 'immediate' (default), 'daily' or 'weekly'. Stored
--     and shown, read by nothing yet: notifications are sent one by one and no
--     digest job exists. docs/NOTIFICATIONS-SPEC.md says so.
--
-- Every default is today's behaviour, so an existing row changes nothing.
-- =====================================================================

alter table public.app_settings
  add column if not exists time_format text not null default '24h',
  add column if not exists week_start text not null default 'monday',
  add column if not exists digest_frequency text not null default 'immediate';

alter table public.app_settings
  drop constraint if exists app_settings_time_format_check,
  add constraint app_settings_time_format_check
    check (time_format in ('24h', '12h')),
  drop constraint if exists app_settings_week_start_check,
  add constraint app_settings_week_start_check
    check (week_start in ('monday', 'sunday')),
  drop constraint if exists app_settings_digest_frequency_check,
  add constraint app_settings_digest_frequency_check
    check (digest_frequency in ('immediate', 'daily', 'weekly'));

comment on column public.app_settings.time_format is
  'Clock format for this person, 24h or 12h (0163). Read by src/lib/format.ts.';
comment on column public.app_settings.week_start is
  'First day of the week on this person''s own schedule, monday or sunday (0163). Rota weeks stay Monday-keyed.';
comment on column public.app_settings.digest_frequency is
  'immediate, daily or weekly (0163). Stored only: no digest job exists yet.';
