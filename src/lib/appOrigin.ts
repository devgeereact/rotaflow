import { env } from '@/lib/env';

/**
 * The origin to send a user back to after they leave the app and return,
 * OAuth, magic links, email confirmation, password reset, invitations.
 *
 * ## Why this is the browser's origin and not `VITE_APP_URL`
 *
 * Every one of these flows was written as `env.appUrl || window.location.origin`,
 * which reads like "the configured URL, falling back to wherever we are" and
 * behaves like "the configured URL, always". The fallback only fires when
 * `VITE_APP_URL` is *empty*, and it never is, because `.env.example` ships it
 * and every real `.env` copies it.
 *
 * The effect on localhost was that sign-up, sign-in, magic link, Google, GitHub
 * and password reset all pointed back at the production origin. Nothing
 * errored; the session simply landed on production and the dev server was never
 * told anything happened, so all six looked broken in the same way.
 *
 * `window.location.origin` is correct in **every** environment, which is the
 * argument for it: in production it already equals `VITE_APP_URL`, and in dev,
 * on a preview build or behind a tunnel it is the only answer that can work.
 * `VITE_APP_URL` could only ever be wrong here, never more right.
 *
 * It remains the fallback for a non-browser context, and remains the canonical
 * URL for anything *displayed* as "your RotaFlow address".
 *
 * ## Supabase must also allow the origin
 *
 * This is half the fix. Supabase rejects any `redirectTo` outside
 * Authentication → URL Configuration → Redirect URLs, falling back to the Site
 * URL. A dev origin has to be added there or these flows still leave localhost.
 */
export function appOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return env.appUrl.replace(/\/$/, '');
}

/** `appOrigin()` joined to an absolute app path, e.g. `/app/dashboard`. */
export function appUrlFor(path: string): string {
  return `${appOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}
