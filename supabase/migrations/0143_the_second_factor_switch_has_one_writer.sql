-- =====================================================================
-- 0143_the_second_factor_switch_has_one_writer.sql
--
-- ## The defect
--
-- `set_platform_mfa_required` (`0102`) is careful. It is `platform_owner` only,
-- it reads `platform_admins` directly rather than calling `is_platform_admin()`
-- — deliberately, because "a switch whose own guard depends on the setting it
-- writes is how an off switch becomes unreachable" — and it refuses to turn the
-- requirement ON unless the caller already holds an `aal2` session, so nobody
-- can lock themselves out.
--
-- None of that mattered, because `require_mfa` also carried a plain UPDATE
-- grant to `authenticated`, and `updatePlatformSettings` sends whatever patch
-- it is given straight to the table. Reproduced as a `platform_admin` — not
-- even an owner — on an `aal1` session:
--
--   RPC at aal1 refused: 42501 / Only a platform owner may change the
--                                second-factor requirement
--   DIRECT UPDATE at aal1 by platform_admin: SUCCEEDED -> require_mfa = t
--   is_platform_admin() now: false
--
-- One request, from the ordinary settings screen, and every platform
-- administrator including the person who did it loses the console — because
-- `is_platform_admin()` folds the requirement in, and the sign-in form has no
-- MFA challenge, so no session in this product can currently reach `aal2` to
-- satisfy it.
--
-- Recovery exists and is narrow: `set_platform_mfa_required(false)` needs
-- `platform_owner` and does NOT need `aal2` (only turning it ON does), so an
-- owner can undo it — verified. What they could not do is REACH it, because the
-- console gate refuses them first. The client half of that is fixed alongside
-- this migration, by putting the switch on the refusal screen itself.
--
-- ## The fix
--
-- Revoke UPDATE on this one column, so the RPC is the only writer and its
-- guards actually guard. Every other column keeps its grant: the settings page
-- patches them directly and none of them can lock anybody out.
--
-- This is the `0023` lesson in the other direction. That row is remembered for
-- a column grant that was too NARROW — onboarding step 2 was 403 for every new
-- customer because a later column was not added to the list. Here the list was
-- too WIDE, and the cost is not a broken screen but a bypassed guard. A column
-- grant is a security boundary in both directions, and the way to find these is
-- to compare what an RPC protects against what the table lets through:
--
--   select column_name from information_schema.column_privileges
--    where table_name = 'platform_settings' and grantee = 'authenticated'
--      and privilege_type = 'UPDATE';
--
-- ## Rollback
--
-- `grant update on public.platform_settings to authenticated;` restores the
-- table grant and with it the bypass, so do it only alongside a decision about
-- how the switch should be reachable instead.
-- =====================================================================

-- A column-level revoke alone does NOTHING here, and the first attempt at this
-- migration was exactly that. `authenticated` holds a TABLE-level UPDATE grant
-- on `platform_settings`, which implies every column including ones added
-- later, so the column revoke was silently a no-op and the bypass still
-- succeeded when re-tested. The table grant has to go first, and then every
-- column except this one gets its grant back explicitly.
revoke update on public.platform_settings from authenticated;

grant update (
  platform_name,
  support_email,
  platform_url,
  default_timezone,
  registration_enabled,
  maintenance_mode,
  maintenance_message,
  logo_url,
  favicon_url,
  primary_colour,
  support_branding,
  admin_session_minutes,
  max_concurrent_sessions,
  signin_alerts,
  reauth_for_critical,
  email_sender_name,
  email_sender_address,
  email_provider,
  max_upload_mb,
  permitted_file_types,
  public_api_enabled,
  api_rate_limit_per_min,
  webhook_max_attempts,
  updated_by,
  updated_at
) on public.platform_settings to authenticated;

-- ⚠️ A COLUMN ADDED TO THIS TABLE LATER IS NOT UPDATABLE UNTIL IT IS ADDED
-- ABOVE. That is the `0023` failure in the other direction: onboarding step 2
-- returned 403 for every new customer because a later column was missing from a
-- grant list exactly like this one, and the error names the TABLE rather than
-- the column, so it reads as a policy problem. The trade is deliberate — a
-- forgotten column here breaks a settings field loudly, where leaving the table
-- grant in place leaves a security guard bypassable silently — but whoever adds
-- the next column needs to know.

comment on column public.platform_settings.require_mfa is
  'Whether platform administrators must hold an aal2 session. Writable ONLY through set_platform_mfa_required (0102), which is platform-owner-only and refuses to turn it on from a session that is not itself aal2. The direct UPDATE grant was revoked by 0143 because it bypassed both guards: a platform_admin on aal1 could set it and lock every administrator out in one request.';
