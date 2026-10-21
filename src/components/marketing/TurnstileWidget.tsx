import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Cloudflare Turnstile, rendered explicitly, for the contact form.
 *
 * Only mounted when `VITE_TURNSTILE_SITE_KEY` is set, so the script is never
 * fetched on a deployment that has not opted in. Explicit rendering per
 * Cloudflare's client-side documentation
 * (developers.cloudflare.com/turnstile/get-started/client-side-rendering,
 * read 2026-10-12): load `api.js?render=explicit`, call `turnstile.render`
 * with a `callback` for the token, and `turnstile.reset` after a token has
 * been spent, because each token is single use.
 */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'timeout-callback': () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not initialise'));
    script.onerror = () => {
      loading = null;
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Clears the spent token and asks for a new one. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** A fresh token, or null when the last one expired or failed. */
  onToken: (token: string | null) => void;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, onToken }, ref): JSX.Element {
    const container = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(ref, () => ({
      reset: () => {
        onTokenRef.current(null);
        if (widgetId.current && window.turnstile)
          window.turnstile.reset(widgetId.current);
      },
    }));

    useEffect(() => {
      let cancelled = false;
      loadTurnstile()
        .then((api) => {
          if (cancelled || !container.current) return;
          widgetId.current = api.render(container.current, {
            sitekey: siteKey,
            theme: 'auto',
            callback: (token) => onTokenRef.current(token),
            'expired-callback': () => onTokenRef.current(null),
            'error-callback': () => onTokenRef.current(null),
            'timeout-callback': () => onTokenRef.current(null),
          });
        })
        .catch(() => {
          // No token is the outcome either way; the form explains that the
          // check did not load and offers the email address instead.
          onTokenRef.current(null);
        });
      return () => {
        cancelled = true;
        if (widgetId.current && window.turnstile)
          window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      };
    }, [siteKey]);

    return <div ref={container} className="mt-5 min-h-[65px]" />;
  },
);
