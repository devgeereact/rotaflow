/**
 * Central, validated access to environment variables.
 * Nothing else in the app should read `import.meta.env` directly.
 */

interface AppEnv {
  appName: string;
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  imagekitUrlEndpoint: string;
  imagekitPublicKey: string;
  sentryDsn: string;
  inngestEventKey: string;
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
    // eslint-disable-next-line no-console
    console.warn(
      `[env] Missing env vars: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.',
    );
  }
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
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
};
