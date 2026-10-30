/**
 * Central, validated access to environment variables.
 * Nothing else in the app should read `import.meta.env` directly.
 */

interface AppEnv {
  appName: string;
  appUrl: string;
  sentryDsn: string;
  /** Clerk's publishable key (pk_..., public by design). Empty means sign-in is not available in this build. */
  clerkPublishableKey: string;
  vapidPublicKey: string;
  /**
   * Cloudflare Turnstile's public site key for the contact form. Empty means
   * no widget is rendered. It only works alongside `TURNSTILE_SECRET_KEY` on
   * the API's private config (`turnstile_secret`): set both, or neither (docs/API-SPEC.md).
   */
  turnstileSiteKey: string;
  isProd: boolean;
  mode: string;
}

/**
 * Every environment variable this application reads, each named statically.
 *
 * The names matter more than the shape. Vite replaces `import.meta.env.NAME`
 * at build time by matching that exact text, so a *dynamic* lookup —
 * `import.meta.env[key]`, which this file used until 2026-09-04 — cannot be
 * matched and makes Vite emit the whole env object instead. The bundle then
 * carries every `VITE_*` in whoever's `.env` ran the build, read or not: that
 * is how a live Stripe publishable key reached production while appearing in
 * no source file, and `.env.example` recorded it as "deliberately not a
 * variable" the whole time.
 *
 * Deleting the offending line from `.env` fixes one instance. Naming the keys
 * here fixes the class, and `scripts/check-bundle-size.mjs` fails the build if
 * a name outside this list ever appears in `dist/`.
 */
const RAW = {
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
  VITE_APP_URL: import.meta.env.VITE_APP_URL,
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  VITE_VAPID_PUBLIC_KEY: import.meta.env.VITE_VAPID_PUBLIC_KEY,
  VITE_TURNSTILE_SITE_KEY: import.meta.env.VITE_TURNSTILE_SITE_KEY,
};

type EnvKey = keyof typeof RAW;

function read(key: EnvKey, fallback = ''): string {
  // vite/client augments ImportMetaEnv with an `any` index signature,
  // so funnel the lookup through `unknown` and narrow it safely.
  const value: unknown = RAW[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Warn loudly (once) in dev if a critical key is missing. */
function requireKeys(keys: EnvKey[]): void {
  if (import.meta.env.PROD) return;
  const missing = keys.filter((k) => read(k).length === 0);
  if (missing.length > 0) {
    console.warn(
      `[env] Missing env vars: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.',
    );
  }
}

requireKeys(['VITE_CLERK_PUBLISHABLE_KEY']);

export const env: AppEnv = {
  appName: read('VITE_APP_NAME', 'RotaFlow'),
  appUrl: read('VITE_APP_URL'),
  sentryDsn: read('VITE_SENTRY_DSN'),
  clerkPublishableKey: read('VITE_CLERK_PUBLISHABLE_KEY'),
  vapidPublicKey: read('VITE_VAPID_PUBLIC_KEY'),
  turnstileSiteKey: read('VITE_TURNSTILE_SITE_KEY'),
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
};
