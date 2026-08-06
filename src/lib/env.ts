/**
 * Central, validated access to environment variables.
 * Nothing else in the app should read `import.meta.env` directly.
 */

/** OAuth providers the sign-in screen knows how to render. */
export type OAuthProvider = 'google' | 'github';

const SUPPORTED_OAUTH_PROVIDERS: readonly OAuthProvider[] = ['google', 'github'];

interface AppEnv {
  appName: string;
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  imagekitUrlEndpoint: string;
  imagekitPublicKey: string;
  sentryDsn: string;
  inngestEventKey: string;
  /**
   * Which OAuth providers to offer on the sign-in screen.
   *
   * Per-provider, not a single on/off flag: they are enabled independently in
   * the Supabase dashboard (Authentication → Providers), and rendering a button
   * for a provider that is disabled upstream is a dead end for the user. As of
   * 2026-07-29 this project has Google enabled and GitHub disabled, so one flag
   * for both would necessarily be wrong for one of them.
   */
  oauthProviders: readonly OAuthProvider[];
  vapidPublicKey: string;
  isProd: boolean;
  mode: string;
}

function read(key: keyof ImportMetaEnv, fallback = ''): string {
  // vite/client augments ImportMetaEnv with an `any` index signature,
  // so funnel the lookup through `unknown` and narrow it safely.
  const value: unknown = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Warn loudly (once) in dev if a critical key is missing. */
function requireKeys(keys: (keyof ImportMetaEnv)[]): void {
  if (import.meta.env.PROD) return;
  const missing = keys.filter((k) => read(k).length === 0);
  if (missing.length > 0) {
    console.warn(
      `[env] Missing env vars: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.',
    );
  }
}

/**
 * Parse `VITE_ENABLE_OAUTH`, a comma-separated provider list, e.g. "google"
 * or "google,github". Unknown or legacy values ("true"/"false") match nothing
 * and yield an empty list, so a misconfigured value hides the buttons rather
 * than shipping dead ones.
 */
function readOAuthProviders(): readonly OAuthProvider[] {
  return read('VITE_ENABLE_OAUTH')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is OAuthProvider =>
      SUPPORTED_OAUTH_PROVIDERS.includes(part as OAuthProvider),
    );
}

requireKeys(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);

export const env: AppEnv = {
  appName: read('VITE_APP_NAME', 'RotaFlow'),
  appUrl: read('VITE_APP_URL'),
  supabaseUrl: read('VITE_SUPABASE_URL'),
  supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
  imagekitUrlEndpoint: read('VITE_IMAGEKIT_URL_ENDPOINT'),
  imagekitPublicKey: read('VITE_IMAGEKIT_PUBLIC_KEY'),
  sentryDsn: read('VITE_SENTRY_DSN'),
  inngestEventKey: read('VITE_INNGEST_EVENT_KEY'),
  oauthProviders: readOAuthProviders(),
  vapidPublicKey: read('VITE_VAPID_PUBLIC_KEY'),
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
};
