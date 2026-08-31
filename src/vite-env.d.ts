/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected by Vite's `define` from package.json. See vite.config.ts. */
declare const __APP_VERSION__: string;
/** Injected by Vite's `define`, the short commit SHA this was built from. See vite.config.ts. */
declare const __SENTRY_RELEASE__: string;

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_IMAGEKIT_URL_ENDPOINT: string;
  readonly VITE_IMAGEKIT_PUBLIC_KEY: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_ENABLE_OAUTH: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
