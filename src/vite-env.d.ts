/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected by Vite's `define` from package.json — see vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_IMAGEKIT_URL_ENDPOINT: string;
  readonly VITE_IMAGEKIT_PUBLIC_KEY: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_INNGEST_EVENT_KEY: string;
  readonly VITE_ENABLE_OAUTH: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
