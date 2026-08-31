#!/usr/bin/env node
/**
 * Auth configuration drift check (docs/SAAS.md GAP-031).
 *
 * ## Why this exists
 *
 * Everything else this repository enforces lives in a migration, an Edge
 * Function or a test. The auth endpoints do not: login, signup, password
 * reset and token refresh are GoTrue's, and their settings live in Supabase's
 * own project config. Nothing in this repository could see them, so nobody
 * had looked — the register's honest answer to "what stops credential
 * stuffing" was "whatever the defaults happen to be".
 *
 * They turned out to be exactly that. Every rate limit on this project is
 * byte-identical to another project in the same organisation, which is what
 * untouched defaults look like.
 *
 * This does not change anything. It reads the live config and compares it to
 * the baseline below, so a setting that drifts — or that somebody tightens
 * and a later dashboard visit loosens — is visible in a run log instead of
 * being invisible forever.
 *
 * ## What the numbers mean
 *
 * The `rate_limit_*` values are REQUESTS PER HOUR. Where the docs say a limit
 * is "limited by IP address", that is per IP: it bounds one attacker on one
 * address and does nothing about a distributed attempt, which is why CAPTCHA
 * rather than a lower number is the real mitigation for credential stuffing.
 * `rate_limit_email_sent` is different — it is project-wide, a sum across
 * signup, recovery and email-change, and it is the one that bites during
 * onboarding rather than under attack.
 *
 * ## Running it
 *
 *   SUPABASE_ACCESS_TOKEN=...  a personal access token, from
 *                              https://supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF=...   defaults to the production project below
 *
 * It fails when the token is absent rather than skipping quietly. A check
 * that passes when it cannot see anything is worse than no check, because it
 * is believed — the same reason `check-migration-safety.mjs` fails closed.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'vwqqbdvlskngrqrejzxi';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

/**
 * What we believe is set, and what we think of it.
 *
 * `expected` is asserted. `note` explains a value rather than judging it.
 * `wanted` records a value we would prefer but have NOT set, because changing
 * live auth settings is the owner's decision, not this script's — every one
 * of them affects real people signing in.
 */
const BASELINE = [
  {
    key: 'rate_limit_verify',
    expected: 30,
    note: 'Sign-in and verification, per hour PER IP. Bounds one address; a distributed attempt is unaffected.',
  },
  {
    key: 'rate_limit_token_refresh',
    expected: 150,
    note: 'Token refresh, per hour per IP. A busy shared connection (one ward, one NAT) is the realistic way to hit this, not an attacker.',
  },
  {
    key: 'rate_limit_email_sent',
    expected: 30,
    note: 'PROJECT-WIDE per hour, summed across signup, recovery and email change. Onboarding thirty-one people in an hour hits it. Invites do NOT count: they go through send-invite and our own SMTP, not GoTrue.',
  },
  { key: 'rate_limit_otp', expected: 30, note: 'Unused — this product has no OTP flow.' },
  {
    key: 'rate_limit_anonymous_users',
    expected: 30,
    note: 'Unused — anonymous sign-in is not enabled, and every table is org-scoped.',
  },
  {
    key: 'password_min_length',
    expected: 12,
    note: 'Raised from 6 on 2026-08-31, with the owner’s agreement. Six characters with upper/lower/digit required is the discredited combination — composition rules over a short minimum. `src/lib/password.ts` mirrors this exact rule, so the on-screen checklist and what GoTrue accepts are the same list.',
  },
  {
    key: 'password_hibp_enabled',
    expected: false,
    wanted: true,
    note: 'Leaked-password protection (HaveIBeenPwned). Off. Supabase’s own security advisor raises this as a WARN. Offered to the owner on 2026-08-31 and not taken; left as a recorded open finding rather than a silent default.',
  },
  {
    key: 'security_captcha_enabled',
    expected: false,
    wanted: true,
    note: 'The actual mitigation for credential stuffing, since the rate limits are per-IP. Enabling it WITHOUT shipping a captcha token in the client breaks every sign-in immediately, so it is a two-part change and not a toggle.',
  },
  {
    key: 'security_update_password_require_reauthentication',
    expected: true,
    note: 'Already correct: a stolen session cannot silently change the password.',
  },
  {
    key: 'refresh_token_rotation_enabled',
    expected: true,
    note: 'Already correct.',
  },
  {
    key: 'mailer_autoconfirm',
    expected: false,
    note: 'Already correct: an address has to be proved before it is a login.',
  },
];

if (!TOKEN) {
  console.error(
    '::error::SUPABASE_ACCESS_TOKEN is not set, so the auth configuration was NOT checked.',
  );
  console.error(
    '::error::See the header of scripts/check-auth-config.mjs. Until this exists, nothing watches the one part of this system that is configured outside the repository.',
  );
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});

if (!res.ok) {
  console.error(`::error::Could not read the auth config: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const config = await res.json();

let drifted = 0;
let wanted = 0;

console.log(`Auth configuration for ${PROJECT_REF}\n`);
for (const item of BASELINE) {
  const actual = config[item.key];
  const matches = actual === item.expected;
  if (!matches) drifted += 1;
  if (item.wanted !== undefined && actual === item.expected) wanted += 1;

  const mark = matches ? '  ' : '!!';
  console.log(`${mark} ${item.key} = ${JSON.stringify(actual)}`);
  if (!matches) console.log(`     expected ${JSON.stringify(item.expected)}`);
  if (item.wanted !== undefined && matches) {
    console.log(`     unhardened — would prefer ${JSON.stringify(item.wanted)}`);
  }
  console.log(`     ${item.note}`);
}

console.log(
  `\n${drifted} setting(s) differ from the recorded baseline; ` +
    `${wanted} known-unhardened setting(s) still at their recorded value.`,
);

if (drifted > 0) {
  console.error(
    '\n::error::The auth configuration no longer matches what docs/SAAS.md records. ' +
      'Somebody changed it in the dashboard, or this baseline is out of date — update the baseline in the same change that decides which.',
  );
  process.exit(1);
}

console.log('\n✅ Auth configuration matches the recorded baseline.');
